import { parseEventLogs } from "viem";
import { latchAbi } from "./shared/abi.js";
import { LATCH, amounts, keys, addrOf, publicClient, walletFor } from "./shared/config.js";
import { signReceiveAuthorization } from "./shared/eip3009.js";
import { buildPayment, encodePayment, type PaymentRequiredBody } from "./shared/x402.js";

export interface HireResult {
  jobId: bigint;
  deliverable: Record<string, string>;
  engine?: string;
  createTx: `0x${string}`;
  txs: { fund: `0x${string}`; accept: `0x${string}`; submit: `0x${string}` };
}

/** Buyer creates a job, then pays the provider over x402 to fund + accept + do the work. */
export async function hire(opts: {
  providerUrl: string;
  providerAddress: `0x${string}`;
  commitment: `0x${string}`;
  window?: number;
}): Promise<HireResult> {
  const buyer = walletFor(keys.buyer);
  const buyerAddr = addrOf(keys.buyer);

  // 1) create the job on-chain (buyer commits the verification policy hash)
  const createTx = await buyer.writeContract({
    address: LATCH,
    abi: latchAbi,
    functionName: "createJob",
    args: [
      opts.providerAddress,
      amounts.job,
      amounts.bond,
      opts.commitment,
      0n,
      BigInt(Math.floor(Date.now() / 1000) + 86_400),
      opts.window ?? amounts.window,
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
  const created = parseEventLogs({ abi: latchAbi, logs: receipt.logs, eventName: "JobCreated" });
  const jobId = created[0].args.jobId as bigint;

  // 2) ask the provider to take the job — expect HTTP 402
  const first = await fetch(`${opts.providerUrl}/hire`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId: jobId.toString(), buyer: buyerAddr }),
  });
  if (first.status !== 402) throw new Error(`expected 402, got ${first.status}`);
  const required = (await first.json()) as PaymentRequiredBody;
  const reqs = required.accepts[0];

  // 3) sign the x402 payment (EIP-3009), bound to this job's escrow nonce
  const nonce = (await publicClient.readContract({
    address: LATCH,
    abi: latchAbi,
    functionName: "escrowNonce",
    args: [jobId],
  })) as `0x${string}`;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const auth = { from: buyerAddr, to: LATCH, value: BigInt(reqs.maxAmountRequired), validAfter: 0n, validBefore, nonce };
  const { v, r, s } = await signReceiveAuthorization(buyer, auth);
  const signature = `0x${r.slice(2)}${s.slice(2)}${v.toString(16).padStart(2, "0")}` as `0x${string}`;
  const header = encodePayment(buildPayment(signature, auth));

  // 4) retry with the X-PAYMENT header — provider settles, bonds, works, submits
  const paid = await fetch(`${opts.providerUrl}/hire`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-payment": header },
    body: JSON.stringify({ jobId: jobId.toString(), buyer: buyerAddr }),
  });
  if (!paid.ok) throw new Error(`hire failed: ${paid.status} ${await paid.text()}`);
  const body = (await paid.json()) as { deliverable: Record<string, string>; engine?: string; txs: HireResult["txs"] };

  return { jobId, deliverable: body.deliverable, engine: body.engine, createTx, txs: body.txs };
}

/** After settlement, the buyer finalizes (anyone may) and withdraws any refund owed. */
export async function finalizeAndWithdraw(jobId: bigint) {
  const buyer = walletFor(keys.buyer);
  const finalizeTx = await buyer.writeContract({ address: LATCH, abi: latchAbi, functionName: "finalize", args: [jobId] });
  await publicClient.waitForTransactionReceipt({ hash: finalizeTx });

  const owed = (await publicClient.readContract({
    address: LATCH,
    abi: latchAbi,
    functionName: "withdrawable",
    args: [addrOf(keys.buyer)],
  })) as bigint;
  let withdrawTx: `0x${string}` | null = null;
  if (owed > 0n) {
    withdrawTx = await buyer.writeContract({ address: LATCH, abi: latchAbi, functionName: "withdraw", args: [] });
    await publicClient.waitForTransactionReceipt({ hash: withdrawTx });
  }
  return { finalizeTx, owed, withdrawTx };
}
