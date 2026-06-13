import { latchAbi, usdcAbi } from "./shared/abi.js";
import { LATCH, USDC, amounts, addrOf, keys, publicClient, walletFor } from "./shared/config.js";
import { verifyDeliverable } from "./shared/verifier-runner.js";
import { acceptJob, submitDeliverable, ANSWERS } from "./provider.js";
import type { LiveStep } from "./live.js";

/** The judge already signed the USDC ReceiveWithAuthorization; the facilitator redeems it on-chain. */
export interface JudgePayment {
  jobId: string;
  validAfter: string;
  validBefore: string;
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
  mode: "honest" | "fail";
  window: number; // the challenge window the judge created the job with
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Top up an address's USDC from the funded buyer if it's below one bond. */
async function ensureFunded(addr: `0x${string}`, min: bigint) {
  const bal = (await publicClient.readContract({
    address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [addr],
  })) as bigint;
  if (bal < min) {
    const tx = await walletFor(keys.buyer).writeContract({
      address: USDC, abi: usdcAbi, functionName: "transfer", args: [addr, min * 10n],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }
}

/**
 * Run a job the JUDGE created and funded. We never touch the judge's money beyond redeeming the
 * authorization they signed; on FAIL the refund is owed to the judge, who withdraws from their wallet.
 */
export async function runJudgeJob(p: JudgePayment, emit: (s: LiveStep) => void): Promise<{ jobId: string; pass: boolean }> {
  const jobId = BigInt(p.jobId);
  const provider = addrOf(keys.provider);
  await ensureFunded(provider, amounts.bond); // provider needs USDC for its bond

  // 1) settle the judge's signed payment into escrow (facilitator pays gas, not the judge)
  const facilitator = walletFor(keys.deployer);
  const fundTx = await facilitator.writeContract({
    address: LATCH,
    abi: latchAbi,
    functionName: "fundJob",
    args: [jobId, BigInt(p.validAfter), BigInt(p.validBefore), p.v, p.r, p.s],
  });
  await publicClient.waitForTransactionReceipt({ hash: fundTx });
  emit({ key: "fund", status: "done", tx: fundTx });

  // 2) provider accepts (posts bond) + does the work + submits
  const mode = p.mode === "fail" ? "adversarial" : "honest";
  const accept = await acceptJob(jobId, keys.provider);
  emit({ key: "accept", status: "done", tx: accept });
  const deliverable = ANSWERS[mode];
  const submit = await submitDeliverable(jobId, deliverable, keys.provider);
  emit({ key: "submit", status: "done", tx: submit, note: JSON.stringify(deliverable) });

  // 3) staked verifier scores it against the committed key
  emit({ key: "verify", status: "running" });
  const v = verifyDeliverable(jobId, deliverable);
  const verdict = v.pass ? "pass" : "fail";
  emit({ key: "verify", status: verdict, note: `score ${v.score}/100` });
  emit({ key: "verdict", status: verdict, tx: v.tx });

  // 4) finalize after the challenge window — but DO NOT withdraw (the judge withdraws their own refund)
  emit({ key: "finalize", status: "running", note: `waiting ${p.window}s for the challenge window` });
  await sleep((p.window + 5) * 1000);
  const finTx = await facilitator.writeContract({ address: LATCH, abi: latchAbi, functionName: "finalize", args: [jobId] });
  await publicClient.waitForTransactionReceipt({ hash: finTx });
  emit({ key: "finalize", status: "done", tx: finTx });
  emit({ key: "outcome", status: verdict, tx: finTx });

  return { jobId: jobId.toString(), pass: v.pass };
}
