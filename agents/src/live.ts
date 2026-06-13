import { hire, finalizeAndWithdraw } from "./buyer.js";
import { usdcAbi } from "./shared/abi.js";
import { USDC, addrOf, amounts, keys, publicClient, walletFor } from "./shared/config.js";
import { verifyDeliverable } from "./shared/verifier-runner.js";

/** Keep the provider topped up: a slashed (FAIL) provider loses its bond, so refill if low. */
async function ensureProviderFunded(provider: `0x${string}`) {
  const bal = (await publicClient.readContract({
    address: USDC,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [provider],
  })) as bigint;
  if (bal < amounts.bond) {
    const tx = await walletFor(keys.buyer).writeContract({
      address: USDC,
      abi: usdcAbi,
      functionName: "transfer",
      args: [provider, amounts.bond * 10n],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }
}

export interface LiveStep {
  key: string;
  status: "running" | "done" | "pass" | "fail";
  tx?: string;
  note?: string;
  engine?: string; // which LLM produced the deliverable (surfaced on the submit node)
  balances?: { buyer: string; provider: string }; // live USDC (base units) of the demo wallets
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Live USDC balances of the demo buyer + provider, so the UI can show money move on each step. */
async function readBalances(provider: `0x${string}`): Promise<{ buyer: string; provider: string }> {
  const [buyer, prov] = (await Promise.all([
    publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [addrOf(keys.buyer)] }),
    publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [provider] }),
  ])) as [bigint, bigint];
  return { buyer: buyer.toString(), provider: prov.toString() };
}

/** Run one real agent job on Fuji, emitting a step event at each stage. */
export async function runLiveJob(
  opts: { providerUrl: string; providerAddress: `0x${string}`; commitment: `0x${string}`; window: number },
  emit: (s: LiveStep) => void,
): Promise<{ jobId: string; pass: boolean }> {
  await ensureProviderFunded(opts.providerAddress); // refill the provider if a prior slash drained it
  emit({ key: "create", status: "running", balances: await readBalances(opts.providerAddress) });
  const r = await hire(opts);
  emit({ key: "create", status: "done", tx: r.createTx });
  emit({ key: "fund", status: "done", tx: r.txs.fund, balances: await readBalances(opts.providerAddress) });
  emit({ key: "accept", status: "done", tx: r.txs.accept, balances: await readBalances(opts.providerAddress) });
  emit({ key: "submit", status: "done", tx: r.txs.submit, note: JSON.stringify(r.deliverable), engine: r.engine });

  emit({ key: "verify", status: "running" });
  const v = verifyDeliverable(r.jobId, r.deliverable);
  const verdict = v.pass ? "pass" : "fail";
  emit({ key: "verify", status: verdict, note: `score ${v.score}/100` });
  emit({ key: "verdict", status: verdict, tx: v.tx });

  emit({ key: "finalize", status: "running", note: `waiting ${opts.window}s for the challenge window` });
  await sleep((opts.window + 8) * 1000);
  const fin = await finalizeAndWithdraw(r.jobId);
  emit({ key: "finalize", status: "done", tx: fin.finalizeTx });
  emit({ key: "outcome", status: verdict, tx: fin.finalizeTx, balances: await readBalances(opts.providerAddress) });

  return { jobId: r.jobId.toString(), pass: v.pass };
}
