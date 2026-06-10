//! On-chain verdict submission. Sends a signed verdict to `LatchJob.submitVerdict`, which the
//! contract verifies against the job's registered verifier key and uses to open the challenge
//! window. Only the `submitVerdict` selector is bound here so the production path stays
//! independent of the Foundry build artifacts.

use crate::error::VerifierError;
use crate::verdict::SignedVerdict;
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
            bytes verifierSig
        ) external;
    }
}

/// Submit a signed verdict to the LatchJob contract at `latch`, returning the transaction hash.
pub async fn submit_verdict<P: Provider>(
    provider: P,
    latch: Address,
    signed: &SignedVerdict,
) -> Result<B256, VerifierError> {
    let contract = ILatchJob::new(latch, provider);
    let v = &signed.verdict;

    let pending = contract
        .submitVerdict(
            v.jobId,
            v.pass,
            v.score,
            v.reasonHash,
            v.evidenceURI.clone(),
            v.deadline,
            Bytes::from(signed.signature.clone()),
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
