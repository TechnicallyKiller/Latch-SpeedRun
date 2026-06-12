import { getAddress, parseAbi, parseEventLogs } from "viem";
import { publicClient, walletFor } from "./config.js";

// Canonical ERC-8004 registries on Avalanche Fuji (verified live against the final spec ABI).
export const IDENTITY = getAddress("0x8004A818BFB912233c491871b3d84c89A494BD9e");
export const REPUTATION = getAddress("0x8004B663056A597Dffe9eCcC1965A193B7388713");

export const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

export const reputationAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);

/** Register an agent in the ERC-8004 Identity Registry; returns the minted agentId. */
export async function registerAgent(key: `0x${string}`, agentURI: string): Promise<bigint> {
  const w = walletFor(key);
  const hash = await w.writeContract({ address: IDENTITY, abi: identityAbi, functionName: "register", args: [agentURI] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const ev = parseEventLogs({ abi: identityAbi, logs: receipt.logs, eventName: "Registered" });
  return ev[0].args.agentId as bigint;
}

/** Aggregate reputation for an agent, as seen by the given clients. */
export async function reputationOf(
  agentId: bigint,
  clients: `0x${string}`[],
): Promise<{ count: bigint; value: number }> {
  if (clients.length === 0) return { count: 0n, value: 0 };
  const [count, summaryValue] = (await publicClient.readContract({
    address: REPUTATION,
    abi: reputationAbi,
    functionName: "getSummary",
    args: [agentId, clients, "latch", ""], // same tag the feedback is written with
  })) as [bigint, bigint, number];
  return { count, value: Number(summaryValue) };
}

/** A client gives feedback about an agent (value 0..100), referencing the verdict evidence. */
export async function giveFeedback(
  key: `0x${string}`,
  agentId: bigint,
  value: number,
  feedbackURI: string,
  feedbackHash: `0x${string}`,
): Promise<`0x${string}`> {
  const w = walletFor(key);
  const hash = await w.writeContract({
    address: REPUTATION,
    abi: reputationAbi,
    functionName: "giveFeedback",
    args: [agentId, BigInt(value), 0, "latch", "", "", feedbackURI, feedbackHash],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
