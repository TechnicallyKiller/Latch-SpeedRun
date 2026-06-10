//! Verification policies. Each policy turns a deliverable into a pass/fail verdict, a score,
//! and structured evidence. Policies are deterministic and programmatic — no LLM is the sole
//! basis for releasing funds.

mod ground_truth;
mod json_schema;

pub use ground_truth::{GroundTruthItem, GroundTruthPolicy};
pub use json_schema::JsonSchemaPolicy;

use crate::error::VerifierError;
use alloy::primitives::B256;
use serde_json::Value;

/// The result of evaluating a deliverable against a policy.
#[derive(Debug, Clone)]
pub struct PolicyOutcome {
    /// Whether the deliverable passed.
    pub pass: bool,
    /// Score on a 0..=100 scale (e.g. accuracy percentage).
    pub score: u64,
    /// Structured, publishable evidence backing the verdict.
    pub evidence: Value,
}

/// A verification policy. The `commitment` is what the buyer publishes on-chain at job
/// creation; the verifier recomputes it from the revealed definition to prove they match.
pub trait Policy {
    /// Stable identifier for the policy kind (also mixed into the commitment).
    fn policy_type(&self) -> &'static str;

    /// keccak256 over the policy's canonical definition. Matches the on-chain `policyCommitment`.
    fn commitment(&self) -> B256;

    /// Evaluate a deliverable.
    fn evaluate(&self, deliverable: &Value) -> Result<PolicyOutcome, VerifierError>;

    /// Verify the policy matches a commitment the buyer made on-chain.
    fn check_commitment(&self, expected: B256) -> Result<(), VerifierError> {
        let actual = self.commitment();
        if actual == expected {
            Ok(())
        } else {
            Err(VerifierError::CommitmentMismatch {
                expected: expected.to_string(),
                actual: actual.to_string(),
            })
        }
    }
}
