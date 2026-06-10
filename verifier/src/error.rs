use thiserror::Error;

/// Errors surfaced by the verifier service and policy engine.
#[derive(Debug, Error)]
pub enum VerifierError {
    #[error("invalid policy definition: {0}")]
    InvalidPolicy(String),

    #[error("deliverable does not match the expected shape: {0}")]
    MalformedDeliverable(String),

    #[error("policy commitment mismatch: expected {expected}, recomputed {actual}")]
    CommitmentMismatch { expected: String, actual: String },

    #[error("evidence store error: {0}")]
    Evidence(String),

    #[error("signing error: {0}")]
    Signing(String),

    #[error("chain error: {0}")]
    Chain(String),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),
}
