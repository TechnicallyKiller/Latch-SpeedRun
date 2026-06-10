//! Live Fuji demo runner. Drives the full verify-then-settle loop against the deployed LatchJob
//! on Avalanche Fuji, using real USDC, pinning evidence to IPFS via Pinata, and printing a
//! Snowtrace link for every transaction.
//!
//! Usage (from repo root or verifier/, with a populated .env):
//!   cargo run --bin fuji_demo -- pass    # honest deliverable -> provider paid
//!   cargo run --bin fuji_demo -- fail    # well-formed garbage -> buyer refunded, bond slashed

use std::error::Error;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use alloy::network::EthereumWallet;
use alloy::primitives::{keccak256, Address, B256, U256};
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::SignerSync;
use alloy::sol;
use alloy::sol_types::{Eip712Domain, SolStruct};
use serde_json::json;

use verifier::canonical::canonical_json;
use verifier::chain::submit_verdict;
use verifier::policy::{GroundTruthItem, GroundTruthPolicy, Policy};
use verifier::verdict::{latch_domain, sign_verdict, Verdict};

sol!(
    #[sol(rpc)]
    LatchJob,
    "../contracts/out/LatchJob.sol/LatchJob.json"
);

sol! {
    #[sol(rpc)]
    interface IERC20 {
        function balanceOf(address account) external view returns (uint256);
        function approve(address spender, uint256 amount) external returns (bool);
    }

    struct ReceiveWithAuthorization {
        address from;
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
    }
}

type Res<T> = Result<T, Box<dyn Error>>;

fn env(key: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| panic!("missing env var {key}"))
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

fn tx_link(label: &str, hash: B256) {
    println!("  {label:<16} https://testnet.snowtrace.io/tx/{hash:#x}");
}

fn sign_receive(
    signer: &PrivateKeySigner,
    usdc: Address,
    chain_id: u64,
    from: Address,
    to: Address,
    value: U256,
    valid_before: U256,
    nonce: B256,
) -> (u8, B256, B256) {
    let domain = Eip712Domain::new(
        Some("USD Coin".into()),
        Some("2".into()),
        Some(U256::from(chain_id)),
        Some(usdc),
        None,
    );
    let auth = ReceiveWithAuthorization { from, to, value, validAfter: U256::ZERO, validBefore: valid_before, nonce };
    let sig = signer.sign_hash_sync(&auth.eip712_signing_hash(&domain)).unwrap();
    let b = sig.as_bytes();
    (b[64], B256::from_slice(&b[0..32]), B256::from_slice(&b[32..64]))
}

/// Pin the evidence JSON to IPFS via Pinata; return (keccak fingerprint, ipfs:// URI).
async fn pin_evidence(jwt: &str, evidence: &serde_json::Value) -> Res<(B256, String)> {
    let reason = keccak256(canonical_json(evidence).as_bytes());
    let body = json!({ "pinataContent": evidence, "pinataMetadata": { "name": "latch-evidence" } });
    let resp: serde_json::Value = reqwest::Client::new()
        .post("https://api.pinata.cloud/pinning/pinJSONToIPFS")
        .bearer_auth(jwt)
        .json(&body)
        .send()
        .await?
        .json()
        .await?;
    let cid = resp["IpfsHash"].as_str().ok_or_else(|| format!("pinata response missing IpfsHash: {resp}"))?;
    Ok((reason, format!("ipfs://{cid}")))
}

#[tokio::main]
async fn main() -> Res<()> {
    dotenvy::dotenv().ok();
    let honest = std::env::args().nth(1).map(|a| a != "fail").unwrap_or(true);

    let chain_id: u64 = env("CHAIN_ID").parse()?;
    let rpc = env("FUJI_RPC_URL");
    let usdc: Address = env("USDC_ADDRESS").parse()?;
    let latch_addr: Address = env("LATCHJOB_ADDRESS").parse()?;
    let amount = U256::from(env("JOB_AMOUNT").parse::<u128>()?);
    let bond = U256::from(env("PROVIDER_BOND").parse::<u128>()?);
    let window: u32 = env("CHALLENGE_WINDOW").parse()?;
    let pinata_jwt = env("PINATA_JWT");

    let deployer: PrivateKeySigner = env("DEPLOYER_PRIVATE_KEY").parse()?;
    let buyer: PrivateKeySigner = env("BUYER_PRIVATE_KEY").parse()?;
    let provider_signer: PrivateKeySigner = env("PROVIDER_PRIVATE_KEY").parse()?;
    let verifier: PrivateKeySigner = env("VERIFIER_PRIVATE_KEY").parse()?;
    let (buyer_addr, provider_addr, verifier_addr) = (buyer.address(), provider_signer.address(), verifier.address());

    let mut wallet = EthereumWallet::from(deployer.clone()); // default sender = deployer (relays)
    wallet.register_signer(buyer.clone());
    wallet.register_signer(provider_signer.clone());
    wallet.register_signer(verifier.clone());

    let conn = ProviderBuilder::new().wallet(wallet).connect(&rpc).await?;
    let latch = LatchJob::new(latch_addr, &conn);
    let token = IERC20::new(usdc, &conn);

    println!("\n=== Latch Fuji demo: {} ===", if honest { "HONEST (expect PASS)" } else { "ADVERSARIAL (expect FAIL)" });
    println!("LatchJob: https://testnet.snowtrace.io/address/{latch_addr:#x}\n");

    // Ensure the verifier is an active (staked) member of the set (stake once; reused after).
    if !latch.isActiveVerifier(verifier_addr).call().await? {
        let min = latch.minVerifierStake().call().await?;
        token.approve(latch_addr, min).from(verifier_addr).send().await?.get_receipt().await?;
        let r = latch.stakeVerifier(min).from(verifier_addr).send().await?.get_receipt().await?;
        tx_link("stakeVerifier", r.transaction_hash);
    }

    // Policy: same answer key; the deliverable is correct (honest) or well-formed-but-wrong (garbage).
    let sample = vec![
        GroundTruthItem { id: "q1".into(), expected: json!("cat") },
        GroundTruthItem { id: "q2".into(), expected: json!("dog") },
        GroundTruthItem { id: "q3".into(), expected: json!("bird") },
    ];
    let policy = GroundTruthPolicy::new(sample, 80, B256::ZERO)?;
    let commitment = policy.commitment();
    let deliverable = if honest {
        json!({ "q1": "cat", "q2": "dog", "q3": "bird" })
    } else {
        json!({ "q1": "lion", "q2": "fish", "q3": "snake" })
    };

    let now = now_secs();
    let valid_before = U256::from(now + 3600);

    // 1) createJob (buyer)
    let r = latch
        .createJob(provider_addr, amount, bond, commitment, U256::ZERO, now + 86_400, window)
        .from(buyer_addr)
        .send()
        .await?
        .get_receipt()
        .await?;
    tx_link("createJob", r.transaction_hash);
    let job_id = latch.jobCount().call().await?;
    println!("  jobId: {job_id}");

    // 2) fundJob (buyer, EIP-3009)
    let nonce = latch.escrowNonce(job_id).call().await?;
    let (v, rr, s) = sign_receive(&buyer, usdc, chain_id, buyer_addr, latch_addr, amount, valid_before, nonce);
    let r = latch.fundJob(job_id, U256::ZERO, valid_before, v, rr, s).from(buyer_addr).send().await?.get_receipt().await?;
    tx_link("fundJob", r.transaction_hash);

    // 3) acceptJob (provider posts bond, EIP-3009)
    let nonce = latch.bondNonce(job_id).call().await?;
    let (v, rr, s) = sign_receive(&provider_signer, usdc, chain_id, provider_addr, latch_addr, bond, valid_before, nonce);
    let r = latch.acceptJob(job_id, U256::ZERO, valid_before, v, rr, s).from(provider_addr).send().await?.get_receipt().await?;
    tx_link("acceptJob", r.transaction_hash);

    // 4) submitDeliverable (provider)
    let r = latch
        .submitDeliverable(job_id, keccak256(serde_json::to_vec(&deliverable)?))
        .from(provider_addr)
        .send()
        .await?
        .get_receipt()
        .await?;
    tx_link("submit", r.transaction_hash);

    // 5) verify -> pin evidence -> sign -> submit verdict on-chain
    let outcome = policy.evaluate(&deliverable)?;
    println!("  verdict: pass={} score={}", outcome.pass, outcome.score);
    let (reason, uri) = pin_evidence(&pinata_jwt, &outcome.evidence).await?;
    println!("  evidence: {uri}");
    let verdict = Verdict {
        jobId: job_id,
        pass: outcome.pass,
        score: U256::from(outcome.score),
        reasonHash: reason,
        evidenceURI: uri,
        deadline: U256::from(now + 3600),
    };
    let signed = sign_verdict(&verifier, &latch_domain(chain_id, latch_addr), verdict)?;
    let vh = submit_verdict(&conn, latch_addr, &signed.verdict, &[signed.signature.clone()]).await?;
    tx_link("submitVerdict", vh);

    // 6) wait out the challenge window, then finalize (relayed by deployer)
    println!("  waiting {}s for the challenge window...", window + 5);
    tokio::time::sleep(Duration::from_secs((window + 5) as u64)).await;
    let r = latch.finalize(job_id).send().await?.get_receipt().await?;
    tx_link("finalize", r.transaction_hash);

    // Settle: who gets paid and how much.
    let (payee, label) = if honest { (provider_addr, "provider") } else { (buyer_addr, "buyer") };
    let owed = latch.withdrawable(payee).call().await?;
    println!("  {label} owed: {owed}");
    let before = token.balanceOf(payee).call().await?;
    let r = latch.withdraw().from(payee).send().await?.get_receipt().await?;
    tx_link("withdraw", r.transaction_hash);
    let after = token.balanceOf(payee).call().await?;
    println!("  {label} USDC received: {}", after - before);

    println!("\n=== done: {} ===\n", if honest { "provider paid" } else { "buyer refunded, provider bond slashed" });
    Ok(())
}
