//! On-chain verdict submission. Sends a verdict co-signed by a quorum of the staked verifier set
//! to `LatchJob.submitVerdict`, which verifies each signature against the active verifiers and
//! opens the challenge window. Only the `submitVerdict` selector is bound here so the production
//! path stays independent of the Foundry build artifacts.

use crate::error::VerifierError;
use crate::verdict::Verdict;
use alloy::primitives::{Address, Bytes, B256};
use alloy::providers::Provider;
use alloy::sol;

sol! {
    #[sol(rpc)]
    contract ILatchJob {
        function submitVerdict(
            uint256 jobId,
            bool pass,
            uint256 score,
            bytes32 reasonHash,
            string evidenceURI,
            uint256 deadline,
            bytes[] verifierSigs
        ) external;
    }
}

/// Submit a verdict and its quorum of signatures (all over the same EIP-712 digest) to the
/// LatchJob contract at `latch`, returning the transaction hash.
pub async fn submit_verdict<P: Provider>(
    provider: P,
    latch: Address,
    verdict: &Verdict,
    signatures: &[Vec<u8>],
) -> Result<B256, VerifierError> {
    let contract = ILatchJob::new(latch, provider);
    let sigs: Vec<Bytes> = signatures.iter().map(|s| Bytes::from(s.clone())).collect();

    let pending = contract
        .submitVerdict(
            verdict.jobId,
            verdict.pass,
            verdict.score,
            verdict.reasonHash,
            verdict.evidenceURI.clone(),
            verdict.deadline,
            sigs,
        )
        .send()
        .await
        .map_err(|e| VerifierError::Chain(e.to_string()))?;

    let receipt = pending
        .get_receipt()
        .await
        .map_err(|e| VerifierError::Chain(e.to_string()))?;

    // A mined-but-reverted submitVerdict is a failure, not a success.
    if !receipt.status() {
        return Err(VerifierError::Chain(format!(
            "submitVerdict reverted in tx {}",
            receipt.transaction_hash
        )));
    }

    Ok(receipt.transaction_hash)
}
