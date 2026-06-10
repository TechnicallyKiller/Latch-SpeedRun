//! Verdict typed data and EIP-712 signing, byte-for-byte compatible with
//! `LatchJob`'s `Verdict` typehash and the "Latch"/"1" signing domain.

use crate::error::VerifierError;
use alloy::primitives::{Address, B256, U256};
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::SignerSync;
use alloy::sol;
use alloy::sol_types::{Eip712Domain, SolStruct};

sol! {
    /// Mirrors LatchJob's:
    /// Verdict(uint256 jobId,bool pass,uint256 score,bytes32 reasonHash,string evidenceURI,uint256 deadline)
    #[derive(Debug)]
    struct Verdict {
        uint256 jobId;
        bool pass;
        uint256 score;
        bytes32 reasonHash;
        string evidenceURI;
        uint256 deadline;
    }
}

/// The EIP-712 domain LatchJob uses (name "Latch", version "1").
pub fn latch_domain(chain_id: u64, verifying_contract: Address) -> Eip712Domain {
    Eip712Domain::new(
        Some("Latch".into()),
        Some("1".into()),
        Some(U256::from(chain_id)),
        Some(verifying_contract),
        None,
    )
}

/// A verdict plus its digest and signature, ready to submit on-chain.
#[derive(Debug, Clone)]
pub struct SignedVerdict {
    pub verdict: Verdict,
    /// The EIP-712 digest the verifier signed (equals `LatchJob.verdictDigest(...)`).
    pub digest: B256,
    /// 65-byte signature (r ‖ s ‖ v) as expected by OpenZeppelin's `ECDSA.recover`.
    pub signature: Vec<u8>,
    pub signer: Address,
}

/// Sign a verdict for the given domain.
pub fn sign_verdict(
    signer: &PrivateKeySigner,
    domain: &Eip712Domain,
    verdict: Verdict,
) -> Result<SignedVerdict, VerifierError> {
    let digest = verdict.eip712_signing_hash(domain);
    let sig = signer
        .sign_hash_sync(&digest)
        .map_err(|e| VerifierError::Signing(e.to_string()))?;
    Ok(SignedVerdict {
        verdict,
        digest,
        signature: sig.as_bytes().to_vec(),
        signer: signer.address(),
    })
}
