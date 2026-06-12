import { parseEther } from "viem";
import { hire, finalizeAndWithdraw } from "./buyer.js";
import { startProvider, type Mode } from "./provider.js";
import { usdcAbi } from "./shared/abi.js";
import { USDC, addrOf, amounts, keys, publicClient, snowtrace, walletFor } from "./shared/config.js";
import { giveFeedback, registerAgent, reputationOf } from "./shared/erc8004.js";
import { policyCommitment, verifyDeliverable } from "./shared/verifier-runner.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const buyerAddr = addrOf(keys.buyer);

interface Prov {
  name: string;
  mode: Mode;
  key: `0x${string}`;
  url: string;
  agentId: bigint;
}

async function fundBudgetProvider() {
  const to = addrOf(keys.provider2);
  const gas = await walletFor(keys.deployer).sendTransaction({ to, value: parseEther("0.05") });
  await publicClient.waitForTransactionReceipt({ hash: gas });
  const usdc = await walletFor(keys.buyer).writeContract({
    address: USDC,
    abi: usdcAbi,
    functionName: "transfer",
    args: [to, amounts.bond * 3n],
  });
  await publicClient.waitForTransactionReceipt({ hash: usdc });
}

async function repText(agentId: bigint): Promise<string> {
  const { count, value } = await reputationOf(agentId, [buyerAddr]);
  return count === 0n ? "unproven" : `${value}/100`;
}

async function runJob(prov: Prov, commitment: `0x${string}`) {
  console.log(`\nbuyer → hires ${prov.name} (ERC-8004 agent #${prov.agentId}) over x402…`);
  const r = await hire({ providerUrl: prov.url, providerAddress: addrOf(prov.key), commitment });
  console.log("  jobId         ", r.jobId.toString());
  console.log("  fund (x402)   ", snowtrace(r.txs.fund));
  console.log("  deliverable   ", JSON.stringify(r.deliverable), "→", snowtrace(r.txs.submit));

  const v = verifyDeliverable(r.jobId, r.deliverable);
  console.log("  verdict       ", `pass=${v.pass} score=${v.score}`, "→", snowtrace(v.tx));

  console.log(`  waiting ${amounts.window + 5}s for the challenge window…`);
  await sleep((amounts.window + 5) * 1000);
  const fin = await finalizeAndWithdraw(r.jobId);
  console.log("  settle        ", snowtrace(fin.finalizeTx), v.pass ? "provider paid" : "buyer refunded + bond slashed");

  const fb = await giveFeedback(keys.buyer, prov.agentId, v.pass ? 100 : 0, v.evidenceURI, v.reasonHash);
  console.log("  ERC-8004 feedback", `value=${v.pass ? 100 : 0}`, "→", snowtrace(fb));
}

async function main() {
  console.log("\n=== Latch · two competing agents, picked by on-chain reputation (Fuji) ===\n");

  console.log("setup → fund the budget provider, register both in ERC-8004 Identity…");
  await fundBudgetProvider();
  const agentH = await registerAgent(keys.provider, "https://latch.demo/agents/honest");
  const agentA = await registerAgent(keys.provider2, "https://latch.demo/agents/budget");
  console.log("  honest provider → agent #" + agentH);
  console.log("  budget provider → agent #" + agentA);

  const honest: Prov = { name: "Honest Provider", mode: "honest", key: keys.provider, url: "http://localhost:4021", agentId: agentH };
  const budget: Prov = { name: "Budget Provider", mode: "adversarial", key: keys.provider2, url: "http://localhost:4022", agentId: agentA };
  await startProvider({ mode: honest.mode, key: honest.key, name: honest.name, agentId: honest.agentId }, 4021);
  await startProvider({ mode: budget.mode, key: budget.key, name: budget.name, agentId: budget.agentId }, 4022);

  const commitment = policyCommitment();

  console.log(`\n── round 1 ── reputation: Honest=${await repText(agentH)}, Budget=${await repText(agentA)}`);
  console.log("  both unproven → buyer tries the cheaper Budget provider");
  await runJob(budget, commitment);

  console.log(`\n── round 2 ── reputation: Honest=${await repText(agentH)}, Budget=${await repText(agentA)}`);
  const candidates = [honest, budget];
  let pick = candidates[0];
  let best = -1;
  for (const c of candidates) {
    const { count, value } = await reputationOf(c.agentId, [buyerAddr]);
    const score = count === 0n ? 50 : value; // unproven = neutral
    if (score > best) {
      best = score;
      pick = c;
    }
  }
  console.log(`  buyer picks the higher-reputation provider → ${pick.name}`);
  await runJob(pick, commitment);

  console.log(`\n── final reputation ── Honest=${await repText(agentH)}, Budget=${await repText(agentA)}`);
  console.log("\n=== done: scammer caught & down-rated, honest provider paid & up-rated ===\n");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
