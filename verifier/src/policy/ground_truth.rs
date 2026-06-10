use super::{Policy, PolicyOutcome};
use crate::canonical::canonical_json;
use crate::error::VerifierError;
use alloy::primitives::{keccak256, B256};
use serde_json::{json, Value};

/// One labeled item in the held-out ground-truth sample.
#[derive(Debug, Clone)]
pub struct GroundTruthItem {
    pub id: String,
    pub expected: Value,
}

/// GROUND_TRUTH_SAMPLE policy — the anti-garbage core.
///
/// At job creation the buyer commits `hash(sample, threshold, salt)` on-chain; the provider
/// never sees the sample. After submission the verifier reveals the sample and scores the
/// deliverable's answers against the known labels, passing iff accuracy >= threshold. A
/// provider returning well-formed-but-wrong answers passes a JSON_SCHEMA check yet fails here.
///
/// Deliverable shape: a JSON object mapping item id -> answer value.
pub struct GroundTruthPolicy {
    sample: Vec<GroundTruthItem>,
    /// Pass threshold on a 0..=100 scale (percent of items that must match).
    threshold: u64,
    /// Commit-reveal salt so the commitment doesn't leak the labels via brute force.
    salt: B256,
}

impl GroundTruthPolicy {
    pub fn new(sample: Vec<GroundTruthItem>, threshold: u64, salt: B256) -> Result<Self, VerifierError> {
        if sample.is_empty() {
            return Err(VerifierError::InvalidPolicy("empty ground-truth sample".into()));
        }
        if threshold > 100 {
            return Err(VerifierError::InvalidPolicy("threshold must be 0..=100".into()));
        }
        Ok(Self { sample, threshold, salt })
    }

    fn definition(&self) -> Value {
        let items: Vec<Value> = self
            .sample
            .iter()
            .map(|it| json!({ "id": it.id, "expected": it.expected }))
            .collect();
        json!({
            "type": self.policy_type(),
            "threshold": self.threshold,
            "salt": format!("{:#x}", self.salt),
            "sample": items,
        })
    }
}

impl Policy for GroundTruthPolicy {
    fn policy_type(&self) -> &'static str {
        "ground_truth_sample"
    }

    fn commitment(&self) -> B256 {
        keccak256(canonical_json(&self.definition()).as_bytes())
    }

    fn evaluate(&self, deliverable: &Value) -> Result<PolicyOutcome, VerifierError> {
        let answers = deliverable
            .as_object()
            .ok_or_else(|| VerifierError::MalformedDeliverable("expected a JSON object of id -> answer".into()))?;

        let total = self.sample.len() as u64;
        let mut correct: u64 = 0;
        let mut items = Vec::with_capacity(self.sample.len());

        for item in &self.sample {
            let got = answers.get(&item.id);
            let is_correct = got == Some(&item.expected);
            if is_correct {
                correct += 1;
            }
            items.push(json!({
                "id": item.id,
                "expected": item.expected,
                "got": got.cloned().unwrap_or(Value::Null),
                "correct": is_correct,
            }));
        }

        // Integer-percent score, rounded down — never overstates correctness.
        let score = (correct * 100) / total;
        let pass = score >= self.threshold;

        let evidence = json!({
            "policy": self.policy_type(),
            "threshold": self.threshold,
            "total": total,
            "correct": correct,
            "score": score,
            "pass": pass,
            "items": items,
        });

        Ok(PolicyOutcome { pass, score, evidence })
    }
}
