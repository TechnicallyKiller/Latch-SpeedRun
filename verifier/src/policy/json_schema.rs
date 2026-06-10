use super::{Policy, PolicyOutcome};
use crate::canonical::canonical_json;
use crate::error::VerifierError;
use alloy::primitives::{keccak256, B256};
use serde_json::{json, Value};

/// JSON_SCHEMA policy — the structural floor. A deliverable passes iff it validates against the
/// provided JSON Schema. This catches malformed output but NOT well-formed-but-wrong output;
/// that is what GROUND_TRUTH_SAMPLE is for.
pub struct JsonSchemaPolicy {
    schema: Value,
}

impl JsonSchemaPolicy {
    pub fn new(schema: Value) -> Result<Self, VerifierError> {
        // Reject schemas that don't even compile, so a bad policy fails loudly at construction.
        jsonschema::validator_for(&schema)
            .map_err(|e| VerifierError::InvalidPolicy(format!("invalid JSON schema: {e}")))?;
        Ok(Self { schema })
    }
}

impl Policy for JsonSchemaPolicy {
    fn policy_type(&self) -> &'static str {
        "json_schema"
    }

    fn commitment(&self) -> B256 {
        let def = json!({ "type": self.policy_type(), "schema": self.schema });
        keccak256(canonical_json(&def).as_bytes())
    }

    fn evaluate(&self, deliverable: &Value) -> Result<PolicyOutcome, VerifierError> {
        let validator = jsonschema::validator_for(&self.schema)
            .map_err(|e| VerifierError::InvalidPolicy(format!("invalid JSON schema: {e}")))?;

        let errors: Vec<String> = validator.iter_errors(deliverable).map(|e| e.to_string()).collect();
        let pass = errors.is_empty();

        let evidence = json!({
            "policy": self.policy_type(),
            "valid": pass,
            "errors": errors,
        });

        Ok(PolicyOutcome {
            pass,
            score: if pass { 100 } else { 0 },
            evidence,
        })
    }
}
