//! Verifier worker for the agent demo. Two modes:
//!   agent_verify commitment                      -> prints the policy commitment (for the buyer)
//!   agent_verify submit <jobId> <deliverable>    -> scores the deliverable, signs + submits a verdict
//!
//! Reuses the verifier core: the fixed ground-truth policy, run_verification, and chain submission.

use std::error::Error;
use std::time::{SystemTime, UNIX_EPOCH};

use alloy::network::EthereumWallet;
use alloy::primitives::{Address, B256, U256};
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use serde_json::{json, Value};

use verifier::chain::submit_verdict;
use verifier::evidence::LocalCas;
use verifier::policy::{GroundTruthItem, GroundTruthPolicy, Policy};
use verifier::run_verification;
use verifier::verdict::latch_domain;

fn policy() -> GroundTruthPolicy {
    GroundTruthPolicy::new(
        vec![
            GroundTruthItem { id: "q1".into(), expected: json!("cat") },
            GroundTruthItem { id: "q2".into(), expected: json!("dog") },
            GroundTruthItem { id: "q3".into(), expected: json!("bird") },
        ],
        80,
        B256::ZERO,
    )
    .unwrap()
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    dotenvy::dotenv().ok();
    let p = policy();
    let mode = std::env::args().nth(1).unwrap_or_default();

    if mode == "commitment" {
        println!("{:#x}", p.commitment());
        return Ok(());
    }

    if mode == "submit" {
        let job_id: u64 = std::env::args().nth(2).ok_or("missing jobId")?.parse()?;
        let path = std::env::args().nth(3).ok_or("missing deliverable path")?;
        let deliverable: Value = serde_json::from_str(&std::fs::read_to_string(path)?)?;

        let chain_id: u64 = std::env::var("CHAIN_ID")?.parse()?;
        let rpc = std::env::var("FUJI_RPC_URL")?;
        let latch: Address = std::env::var("LATCHJOB_ADDRESS")?.parse()?;
        let relayer: PrivateKeySigner = std::env::var("DEPLOYER_PRIVATE_KEY")?.parse()?;
        let verifier: PrivateKeySigner = std::env::var("VERIFIER_PRIVATE_KEY")?.parse()?;

        let conn = ProviderBuilder::new().wallet(EthereumWallet::from(relayer)).connect(&rpc).await?;
        let store = LocalCas::new(std::env::temp_dir().join("latch-agent-cas"));
        let domain = latch_domain(chain_id, latch);

        let signed = run_verification(
            &p,
            &deliverable,
            p.commitment(),
            U256::from(job_id),
            U256::from(now() + 3600),
            &store,
            &verifier,
            &domain,
        )?;
        let tx = submit_verdict(&conn, latch, &signed.verdict, &[signed.signature.clone()]).await?;

        // single JSON line for the orchestrator to parse
        println!(
            "{{\"pass\":{},\"score\":\"{}\",\"reasonHash\":\"{:#x}\",\"evidenceURI\":\"{}\",\"tx\":\"{:#x}\"}}",
            signed.verdict.pass, signed.verdict.score, signed.verdict.reasonHash, signed.verdict.evidenceURI, tx
        );
        return Ok(());
    }

    eprintln!("usage: agent_verify commitment | submit <jobId> <deliverable.json>");
    std::process::exit(1);
}
