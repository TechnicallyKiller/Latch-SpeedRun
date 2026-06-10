use alloy::primitives::{address, b256, Signature, B256, U256};
use alloy::signers::local::PrivateKeySigner;
use alloy::sol_types::SolStruct;
use serde_json::json;
use std::str::FromStr;

use verifier::evidence::LocalCas;
use verifier::policy::{GroundTruthItem, GroundTruthPolicy, JsonSchemaPolicy, Policy};
use verifier::run_verification;
use verifier::verdict::{latch_domain, sign_verdict, Verdict};

fn schema_policy() -> JsonSchemaPolicy {
    // Structural floor: an object mapping string ids to string answers, at least 3 of them.
    let schema = json!({
        "type": "object",
        "additionalProperties": { "type": "string" },
        "minProperties": 3
    });
    JsonSchemaPolicy::new(schema).unwrap()
}

fn ground_truth_policy() -> GroundTruthPolicy {
    let sample = vec![
        GroundTruthItem { id: "q1".into(), expected: json!("cat") },
        GroundTruthItem { id: "q2".into(), expected: json!("dog") },
        GroundTruthItem { id: "q3".into(), expected: json!("bird") },
    ];
    GroundTruthPolicy::new(sample, 80, B256::ZERO).unwrap()
}

/// The headline property: well-formed garbage passes the shape check but fails substance.
#[test]
fn ground_truth_catches_wellformed_garbage_that_schema_passes() {
    let schema = schema_policy();
    let gt = ground_truth_policy();

    // Correct shape, wrong values — exactly what a scammer returns.
    let garbage = json!({ "q1": "wrong", "q2": "wrong", "q3": "wrong" });
    assert!(schema.evaluate(&garbage).unwrap().pass, "schema must pass valid shape");
    let g = gt.evaluate(&garbage).unwrap();
    assert!(!g.pass, "ground truth must FAIL well-formed garbage");
    assert_eq!(g.score, 0);

    // Honest, correct answers pass both.
    let honest = json!({ "q1": "cat", "q2": "dog", "q3": "bird" });
    assert!(schema.evaluate(&honest).unwrap().pass);
    let h = gt.evaluate(&honest).unwrap();
    assert!(h.pass);
    assert_eq!(h.score, 100);
}

/// Partial correctness scores proportionally and respects the threshold.
#[test]
fn ground_truth_scores_proportionally() {
    let gt = ground_truth_policy();
    let two_of_three = json!({ "q1": "cat", "q2": "dog", "q3": "wrong" });
    let outcome = gt.evaluate(&two_of_three).unwrap();
    assert_eq!(outcome.score, 66); // floor(2/3 * 100)
    assert!(!outcome.pass, "66 < 80 threshold");
}

/// The recomputed commitment is stable and detects tampering.
#[test]
fn commitment_round_trips_and_detects_mismatch() {
    let gt = ground_truth_policy();
    let c = gt.commitment();
    assert!(gt.check_commitment(c).is_ok());
    assert!(gt.check_commitment(B256::ZERO).is_err());
}

/// Cross-language proof: the Rust EIP-712 digest equals the on-chain `LatchJob.verdictDigest`
/// for the same (chainId, contract, inputs). Golden values come from the Foundry test
/// `VerdictDigestTest.test_emit_golden_digest`. Together with the recovery test below, this
/// means Solidity's `ECDSA.recover(digest, rustSig)` yields the verifier — so `submitVerdict`
/// accepts a verdict signed by this crate.
#[test]
fn verdict_digest_matches_solidity_golden_vector() {
    let domain = latch_domain(31337, address!("2e234DAe75C793f67A35089C9d99245E1C58470b"));
    let verdict = Verdict {
        jobId: U256::from(1),
        pass: true,
        score: U256::from(95),
        reasonHash: b256!("0000000000000000000000000000000000000000000000000000000000abcdef"),
        evidenceURI: "cas://abc".to_string(),
        deadline: U256::from(1_000_000u64),
    };
    let digest = verdict.eip712_signing_hash(&domain);
    assert_eq!(
        digest,
        b256!("0ec89d3bfab6006c63567e0295cdbbab9434f7fdb0c3b486fc7cd36e2b4a170c"),
        "Rust digest must equal Solidity verdictDigest"
    );
}

/// A signed verdict yields a 65-byte signature that recovers to the verifier's address.
#[test]
fn verdict_signature_recovers_to_signer() {
    // anvil account #0 private key (well-known test key).
    let signer =
        PrivateKeySigner::from_str("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80").unwrap();
    let domain = latch_domain(43113, address!("00000000000000000000000000000000000000aB"));

    let verdict = Verdict {
        jobId: U256::from(1),
        pass: true,
        score: U256::from(95),
        reasonHash: B256::ZERO,
        evidenceURI: "cas://abc".to_string(),
        deadline: U256::from(1_000_000u64),
    };

    let signed = sign_verdict(&signer, &domain, verdict).unwrap();
    assert_eq!(signed.signature.len(), 65, "r||s||v");

    let sig = Signature::try_from(signed.signature.as_slice()).unwrap();
    let recovered = sig.recover_address_from_prehash(&signed.digest).unwrap();
    assert_eq!(recovered, signer.address());
}

/// End-to-end: run a FAIL verification, publish evidence, and sign the verdict.
#[test]
fn run_verification_produces_signed_failing_verdict() {
    let dir = std::env::temp_dir().join("latch-cas-test");
    let store = LocalCas::new(&dir);
    let signer =
        PrivateKeySigner::from_str("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80").unwrap();
    let domain = latch_domain(43113, address!("00000000000000000000000000000000000000aB"));

    let gt = ground_truth_policy();
    let garbage = json!({ "q1": "x", "q2": "y", "q3": "z" });
    let commitment = gt.commitment();

    let signed = run_verification(
        &gt,
        &garbage,
        commitment,
        U256::from(7),
        U256::from(2_000_000u64),
        &store,
        &signer,
        &domain,
    )
    .unwrap();

    assert!(!signed.verdict.pass);
    assert_eq!(signed.verdict.score, U256::from(0));
    assert_ne!(signed.verdict.reasonHash, B256::ZERO, "evidence hash recorded");

    // evidence file was written under the content-addressed name.
    let hex = format!("{:x}", signed.verdict.reasonHash);
    assert!(dir.join(format!("{hex}.json")).exists());
}

/// The verifier refuses to sign when the revealed policy doesn't match the on-chain commitment.
#[test]
fn run_verification_rejects_commitment_mismatch() {
    let dir = std::env::temp_dir().join("latch-cas-mismatch");
    let store = LocalCas::new(&dir);
    let signer =
        PrivateKeySigner::from_str("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80").unwrap();
    let domain = latch_domain(43113, address!("00000000000000000000000000000000000000aB"));

    let gt = ground_truth_policy();
    let honest = json!({ "q1": "cat", "q2": "dog", "q3": "bird" });

    // wrong commitment -> must error before signing anything.
    let err = run_verification(&gt, &honest, B256::ZERO, U256::from(1), U256::from(1000), &store, &signer, &domain)
        .unwrap_err();
    assert!(matches!(err, verifier::error::VerifierError::CommitmentMismatch { .. }));
}
