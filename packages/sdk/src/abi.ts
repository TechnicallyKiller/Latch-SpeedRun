import { parseAbi } from "viem";

/** LatchJob — the surface a buyer or provider agent touches. */
export const latchAbi = parseAbi([
  "function createJob(address provider, uint256 amount, uint256 providerBond, bytes32 policyCommitment, uint256 providerAgentId, uint64 submissionDeadline, uint32 challengeWindow) returns (uint256)",
  "function fundJob(uint256 jobId, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)",
  "function acceptJob(uint256 jobId, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)",
  "function submitDeliverable(uint256 jobId, bytes32 submissionHash)",
  "function finalize(uint256 jobId)",
  "function withdraw() returns (uint256)",
  "function escrowNonce(uint256 jobId) view returns (bytes32)",
  "function bondNonce(uint256 jobId) view returns (bytes32)",
  "function withdrawable(address account) view returns (uint256)",
  "event JobCreated(uint256 indexed jobId, address indexed buyer, address indexed provider, uint256 amount, uint256 providerBond, bytes32 policyCommitment)",
  "event JobSettled(uint256 indexed jobId, bool pass, uint256 providerProceeds, uint256 fee, bytes32 reasonHash)",
]);

/** USDC — EIP-3009 subset + reads. The EIP-712 domain is name "USD Coin" version "2". */
export const usdcAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);
