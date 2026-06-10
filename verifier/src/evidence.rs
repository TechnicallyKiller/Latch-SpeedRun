use crate::error::VerifierError;
use alloy::primitives::{keccak256, B256};
use serde_json::Value;
use std::path::PathBuf;

/// A content-addressed reference to published verdict evidence.
#[derive(Debug, Clone)]
pub struct EvidenceRef {
    /// keccak256 of the canonical evidence bytes — written on-chain as the verdict `reasonHash`.
    pub reason_hash: B256,
    /// Resolvable location of the evidence (e.g. `cas://<hash>` locally, `ipfs://<cid>` in prod).
    pub uri: String,
}

/// Where verdict evidence is published so challenges are adjudicable.
pub trait EvidenceStore {
    fn put(&self, evidence: &Value) -> Result<EvidenceRef, VerifierError>;
}

/// Deterministic local content-addressed store for tests/CI (no network). The production store
/// (IPFS via a pinning service) implements the same trait so the verdict path is unchanged.
pub struct LocalCas {
    dir: PathBuf,
}

impl LocalCas {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }
}

impl EvidenceStore for LocalCas {
    fn put(&self, evidence: &Value) -> Result<EvidenceRef, VerifierError> {
        // Canonicalize so the same evidence always yields the same hash and file.
        let bytes = crate::canonical::canonical_json(evidence).into_bytes();
        let reason_hash = keccak256(&bytes);
        let hex = format!("{:x}", reason_hash);

        std::fs::create_dir_all(&self.dir)?;
        let path = self.dir.join(format!("{hex}.json"));
        std::fs::write(&path, &bytes)?;

        Ok(EvidenceRef { reason_hash, uri: format!("cas://{hex}") })
    }
}
