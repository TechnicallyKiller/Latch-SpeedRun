//! Live end-to-end test on a local anvil fork: deploy MockUSDC + LatchJob, drive the full job
//! lifecycle (with Rust-signed EIP-3009 funding), have the Rust verifier sign and submit the
//! verdict on-chain via `chain::submit_verdict`, finalize after the challenge window, and assert
//! the provider is paid. Run with: `anvil` on PATH, then `cargo test --test e2e_anvil -- --ignored`.

use alloy::network::EthereumWallet;
use alloy::primitives::{Address, B256, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::SignerSync;
use alloy::sol;
use alloy::sol_types::{Eip712Domain, SolStruct};
use serde_json::json;
use std::process::{Child, Command};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use verifier::chain::submit_verdict;
use verifier::evidence::LocalCas;
use verifier::policy::{GroundTruthItem, GroundTruthPolicy, Policy};
use verifier::run_verification;
use verifier::verdict::latch_domain;

// Contract bindings generated from the Foundry build artifacts (require `forge build` first).
sol!(
    #[sol(rpc)]
    MockUSDC,
    "../contracts/out/MockUSDC.sol/MockUSDC.json"
);
sol!(
    #[sol(rpc)]
    LatchJob,
    "../contracts/out/LatchJob.sol/LatchJob.json"
);

// USDC's EIP-3009 receive authorization (matches MockUSDC / FiatTokenV2).
sol! {
    struct ReceiveWithAuthorization {
        address from;
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
    }
}

const CHAIN_ID: u64 = 31337;
const AMOUNT: u128 = 1_000_000_000; // 1000 USDC
const BOND: u128 = 100_000_000; // 100 USDC
const CHALLENGE_BOND: u128 = 50_000_000;
const FEE_BPS: u16 = 100; // 1%
const WINDOW: u32 = 60;
const VERIFIER_STAKE: u128 = 1_000;

// Standard anvil/hardhat deterministic test keys (public; local only).
const KEY_OWNER: &str = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KEY_BUYER: &str = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const KEY_PROVIDER: &str = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const KEY_VERIFIER: &str = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";

/// Kills the spawned anvil when dropped (even on panic).
struct AnvilGuard(Child);
impl Drop for AnvilGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn sign_receive(
    signer: &PrivateKeySigner,
    usdc: Address,
    from: Address,
    to: Address,
    value: U256,
    valid_before: U256,
    nonce: B256,
) -> (u8, B256, B256) {
    let domain = Eip712Domain::new(
        Some("USD Coin".into()),
        Some("2".into()),
        Some(U256::from(CHAIN_ID)),
        Some(usdc),
        None,
    );
    let auth = ReceiveWithAuthorization {
        from,
        to,
        value,
        validAfter: U256::ZERO,
        validBefore: valid_before,
        nonce,
    };
    let sig = signer.sign_hash_sync(&auth.eip712_signing_hash(&domain)).unwrap();
    let b = sig.as_bytes();
    (b[64], B256::from_slice(&b[0..32]), B256::from_slice(&b[32..64]))
}

/// The honest path: a correct deliverable is PASSed and the provider is paid.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires anvil on PATH; run with --ignored"]
async fn full_loop_pass_pays_provider() {
    run_full_loop(8547, true).await;
}

/// The headline path: well-formed-but-wrong output is caught, the buyer is refunded, and the
/// provider's bond is slashed — the scammer scenario every shape-only escrow pays out on.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires anvil on PATH; run with --ignored"]
async fn full_loop_fail_refunds_and_slashes() {
    run_full_loop(8548, false).await;
}

async fn run_full_loop(port: u16, honest: bool) {
    let owner: PrivateKeySigner = KEY_OWNER.parse().unwrap();
    let buyer: PrivateKeySigner = KEY_BUYER.parse().unwrap();
    let provider_signer: PrivateKeySigner = KEY_PROVIDER.parse().unwrap();
    let verifier: PrivateKeySigner = KEY_VERIFIER.parse().unwrap();

    let buyer_addr = buyer.address();
    let provider_addr = provider_signer.address();
    let verifier_addr = verifier.address();

    let mut wallet = EthereumWallet::from(owner.clone());
    wallet.register_signer(buyer.clone());
    wallet.register_signer(provider_signer.clone());
    wallet.register_signer(verifier.clone());

    // Spawn anvil and wait until it answers.
    let _anvil = AnvilGuard(
        Command::new("anvil")
            .args(["--port", &port.to_string(), "--chain-id", &CHAIN_ID.to_string(), "--silent"])
            .spawn()
            .expect("anvil must be on PATH"),
    );
    let rpc = format!("http://127.0.0.1:{port}");
    let provider = {
        let mut ready = None;
        for _ in 0..40 {
            if let Ok(p) = ProviderBuilder::new().wallet(wallet.clone()).connect(&rpc).await {
                if p.get_chain_id().await.is_ok() {
                    ready = Some(p);
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        ready.expect("anvil did not become ready")
    };

    // Deploy contracts.
    let usdc = MockUSDC::deploy(&provider).await.unwrap();
    let usdc_addr = *usdc.address();
    let latch = LatchJob::deploy(
        &provider,
        usdc_addr,
        owner.address(),
        owner.address(), // feeRecipient
        owner.address(), // disputeResolver (unused on the happy path)
        FEE_BPS,
        U256::from(CHALLENGE_BOND),
        86_400u64,
    )
    .await
    .unwrap();
    let latch_addr = *latch.address();

    // Fund actors and register the verifier.
    usdc.mint(buyer_addr, U256::from(AMOUNT)).send().await.unwrap().get_receipt().await.unwrap();
    usdc.mint(provider_addr, U256::from(BOND)).send().await.unwrap().get_receipt().await.unwrap();
    latch
        .setVerifierParams(U256::from(VERIFIER_STAKE), U256::from(VERIFIER_STAKE), U256::from(1))
        .from(owner.address())
        .send()
        .await
        .unwrap()
        .get_receipt()
        .await
        .unwrap();
    // verifier stakes to become active
    usdc.mint(verifier_addr, U256::from(VERIFIER_STAKE)).send().await.unwrap().get_receipt().await.unwrap();
    usdc.approve(latch_addr, U256::from(VERIFIER_STAKE)).from(verifier_addr).send().await.unwrap().get_receipt().await.unwrap();
    latch.stakeVerifier(U256::from(VERIFIER_STAKE)).from(verifier_addr).send().await.unwrap().get_receipt().await.unwrap();

    // Policy: ground truth with an honest deliverable (PASS path).
    let sample = vec![
        GroundTruthItem { id: "q1".into(), expected: json!("cat") },
        GroundTruthItem { id: "q2".into(), expected: json!("dog") },
        GroundTruthItem { id: "q3".into(), expected: json!("bird") },
    ];
    let policy = GroundTruthPolicy::new(sample, 80, B256::ZERO).unwrap();
    let commitment = policy.commitment();
    let deliverable = if honest {
        json!({ "q1": "cat", "q2": "dog", "q3": "bird" }) // correct -> PASS
    } else {
        json!({ "q1": "wrong", "q2": "wrong", "q3": "wrong" }) // well-formed garbage -> FAIL
    };

    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    let valid_before = U256::from(now + 3600);

    // 1) createJob (buyer). First job id is 1.
    latch
        .createJob(provider_addr, U256::from(AMOUNT), U256::from(BOND), commitment, U256::ZERO, now + 86_400, WINDOW)
        .from(buyer_addr)
        .send()
        .await
        .unwrap()
        .get_receipt()
        .await
        .unwrap();
    let job_id = U256::from(1);

    // 2) fundJob (buyer signs EIP-3009 over the job-bound escrow nonce).
    let escrow_nonce = latch.escrowNonce(job_id).call().await.unwrap();
    let (v, r, s) = sign_receive(&buyer, usdc_addr, buyer_addr, latch_addr, U256::from(AMOUNT), valid_before, escrow_nonce);
    latch.fundJob(job_id, U256::ZERO, valid_before, v, r, s).from(buyer_addr).send().await.unwrap().get_receipt().await.unwrap();

    // 3) acceptJob (provider posts bond via EIP-3009).
    let bond_nonce = latch.bondNonce(job_id).call().await.unwrap();
    let (v, r, s) = sign_receive(&provider_signer, usdc_addr, provider_addr, latch_addr, U256::from(BOND), valid_before, bond_nonce);
    latch.acceptJob(job_id, U256::ZERO, valid_before, v, r, s).from(provider_addr).send().await.unwrap().get_receipt().await.unwrap();

    // 4) submitDeliverable (provider).
    latch
        .submitDeliverable(job_id, B256::from(alloy::primitives::keccak256(b"deliverable")))
        .from(provider_addr)
        .send()
        .await
        .unwrap()
        .get_receipt()
        .await
        .unwrap();

    // 5) Verifier signs and submits the verdict on-chain (the chain.rs path, live).
    let store = LocalCas::new(std::env::temp_dir().join("latch-e2e"));
    let domain = latch_domain(CHAIN_ID, latch_addr);
    let signed = run_verification(&policy, &deliverable, commitment, job_id, U256::from(now + 3600), &store, &verifier, &domain).unwrap();
    submit_verdict(&provider, latch_addr, &signed.verdict, &[signed.signature.clone()]).await.unwrap();

    assert_eq!(latch.getJob(job_id).call().await.unwrap().state, 5, "UnderVerification");

    // 6) Advance past the challenge window and finalize.
    let _: serde_json::Value = provider.raw_request("evm_increaseTime".into(), (WINDOW + 5,)).await.unwrap();
    let _: serde_json::Value = provider.raw_request("evm_mine".into(), ()).await.unwrap();
    latch.finalize(job_id).send().await.unwrap().get_receipt().await.unwrap();

    // Settlement: PASS pays the provider (amount - fee + bond); FAIL refunds the buyer the
    // amount plus the slashed provider bond. Pull the credited funds and confirm the balance.
    let (expected_state, payee, expected) = if honest {
        let fee = AMOUNT * FEE_BPS as u128 / 10_000;
        (6u8, provider_addr, U256::from(AMOUNT - fee + BOND)) // Released
    } else {
        (7u8, buyer_addr, U256::from(AMOUNT + BOND)) // Refunded: refund + slashed bond
    };

    assert_eq!(latch.getJob(job_id).call().await.unwrap().state, expected_state);
    assert_eq!(latch.withdrawable(payee).call().await.unwrap(), expected);
    if !honest {
        assert_eq!(latch.withdrawable(provider_addr).call().await.unwrap(), U256::ZERO, "scammer paid nothing");
    }

    let before = usdc.balanceOf(payee).call().await.unwrap();
    latch.withdraw().from(payee).send().await.unwrap().get_receipt().await.unwrap();
    let after = usdc.balanceOf(payee).call().await.unwrap();
    assert_eq!(after - before, expected, "settled funds received");
}
