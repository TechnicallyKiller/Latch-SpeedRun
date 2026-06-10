//! Latch verifier — the core IP.
//!
//! Given a submitted deliverable and the job's verification policy, the verifier computes a
//! deterministic correctness verdict, assembles publishable evidence, and signs the verdict with
//! EIP-712 typed data byte-for-byte compatible with the on-chain `LatchJob`. On-chain submission
//! (`submitVerdict`) is wired in a later step; this crate produces the signed verdict and evidence.

pub mod canonical;
pub mod chain;
pub mod error;
pub mod evidence;
pub mod policy;
pub mod verdict;

use alloy::primitives::{B256, U256};
use alloy::signers::local::PrivateKeySigner;
use alloy::sol_types::Eip712Domain;
use serde_json::Value;

use crate::error::VerifierError;
use crate::evidence::EvidenceStore;
use crate::policy::Policy;
use crate::verdict::{sign_verdict, SignedVerdict, Verdict};

/// Run the full verification path for one job: confirm the revealed policy matches the buyer's
/// on-chain commitment, evaluate the policy, publish the evidence, then build and sign the
/// verdict. The result is ready to submit on-chain.
///
/// `expected_commitment` is the job's on-chain `policyCommitment`. Enforcing it here is what
/// makes the commit-reveal real: the verifier refuses to sign a verdict for a policy that
/// differs from what the buyer committed at job creation.
#[allow(clippy::too_many_arguments)]
pub fn run_verification(
    policy: &dyn Policy,
    deliverable: &Value,
    expected_commitment: B256,
    job_id: U256,
    deadline: U256,
    store: &dyn EvidenceStore,
    signer: &PrivateKeySigner,
    domain: &Eip712Domain,
) -> Result<SignedVerdict, VerifierError> {
    policy.check_commitment(expected_commitment)?;

    let outcome = policy.evaluate(deliverable)?;
    let evidence = store.put(&outcome.evidence)?;

    let verdict = Verdict {
        jobId: job_id,
        pass: outcome.pass,
        score: U256::from(outcome.score),
        reasonHash: evidence.reason_hash,
        evidenceURI: evidence.uri,
        deadline,
    };

    sign_verdict(signer, domain, verdict)
}
