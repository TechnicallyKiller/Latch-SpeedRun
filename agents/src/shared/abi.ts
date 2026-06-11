import { parseAbi } from "viem";

/** LatchJob — only the surface the agents and facilitator touch. */
export const latchAbi = parseAbi([
  "function createJob(address provider, uint256 amount, uint256 providerBond, bytes32 policyCommitment, uint256 providerAgentId, uint64 submissionDeadline, uint32 challengeWindow) returns (uint256)",
  "function fundJob(uint256 jobId, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)",
  "function acceptJob(uint256 jobId, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)",
  "function submitDeliverable(uint256 jobId, bytes32 submissionHash)",
  "function finalize(uint256 jobId)",
  "function withdraw() returns (uint256)",
  "function jobCount() view returns (uint256)",
  "function escrowNonce(uint256 jobId) view returns (bytes32)",
  "function bondNonce(uint256 jobId) view returns (bytes32)",
  "function withdrawable(address account) view returns (uint256)",
  "function isActiveVerifier(address verifier) view returns (bool)",
  "function minVerifierStake() view returns (uint256)",
  "event JobCreated(uint256 indexed jobId, address indexed buyer, address indexed provider, uint256 amount, uint256 providerBond, bytes32 policyCommitment)",
  "event JobFunded(uint256 indexed jobId, address indexed buyer, uint256 amount)",
  "event JobAccepted(uint256 indexed jobId, address indexed provider, uint256 providerBond)",
  "event DeliverableSubmitted(uint256 indexed jobId, address indexed provider, bytes32 submissionHash)",
  "event VerdictSubmitted(uint256 indexed jobId, bool pass, uint256 score, bytes32 reasonHash, string evidenceURI, uint256 signerCount)",
  "event JobSettled(uint256 indexed jobId, bool pass, uint256 providerProceeds, uint256 fee, bytes32 reasonHash)",
]);

/** USDC — the EIP-3009 subset plus reads. The verifyingContract domain is name "USD Coin" v2. */
export const usdcAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);
