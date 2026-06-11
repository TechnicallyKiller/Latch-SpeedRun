import express, { type Request, type Response } from "express";
import { keccak256, toBytes } from "viem";
import { latchAbi } from "./shared/abi.js";
import { LATCH, USDC, amounts, keys, addrOf, publicClient, walletFor } from "./shared/config.js";
import { signReceiveAuthorization } from "./shared/eip3009.js";
import { decodePayment, NETWORK, X402_VERSION, type PaymentRequiredBody } from "./shared/x402.js";
import { settle } from "./facilitator.js";

export type Mode = "honest" | "adversarial";

const ANSWERS: Record<Mode, Record<string, string>> = {
  honest: { q1: "cat", q2: "dog", q3: "bird" }, // correct
  adversarial: { q1: "lion", q2: "fish", q3: "snake" }, // well-formed, wrong
};

function paymentRequired(jobId: bigint): PaymentRequiredBody {
  return {
    x402Version: X402_VERSION,
    error: "payment required to fund the job escrow",
    accepts: [
      {
        scheme: "exact",
        network: NETWORK,
        maxAmountRequired: amounts.job.toString(),
        resource: `/hire/${jobId}`,
        description: "Fund the Latch escrow for this job",
        mimeType: "application/json",
        payTo: LATCH,
        maxTimeoutSeconds: 120,
        asset: USDC,
        extra: { name: "USD Coin", version: "2", jobId: jobId.toString() },
      },
    ],
  };
}

/** Provider posts its bond via EIP-3009 and accepts the job. */
async function acceptJob(jobId: bigint): Promise<`0x${string}`> {
  const providerWallet = walletFor(keys.provider);
  const from = addrOf(keys.provider);
  const nonce = (await publicClient.readContract({
    address: LATCH,
    abi: latchAbi,
    functionName: "bondNonce",
    args: [jobId],
  })) as `0x${string}`;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const { v, r, s } = await signReceiveAuthorization(providerWallet, {
    from,
    to: LATCH,
    value: amounts.bond,
    validAfter: 0n,
    validBefore,
    nonce,
  });
  const hash = await providerWallet.writeContract({
    address: LATCH,
    abi: latchAbi,
    functionName: "acceptJob",
    args: [jobId, 0n, validBefore, v, r, s],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function submitDeliverable(jobId: bigint, deliverable: object): Promise<`0x${string}`> {
  const providerWallet = walletFor(keys.provider);
  const submissionHash = keccak256(toBytes(JSON.stringify(deliverable)));
  const hash = await providerWallet.writeContract({
    address: LATCH,
    abi: latchAbi,
    functionName: "submitDeliverable",
    args: [jobId, submissionHash],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export function createProviderApp(mode: Mode) {
  const app = express();
  app.use(express.json());
  const address = addrOf(keys.provider);

  // ERC-8004-style agent card.
  app.get("/.well-known/agent-card", (_req, res) => {
    res.json({
      name: mode === "honest" ? "Honest Data Provider" : "Budget Data Provider",
      address,
      capabilities: ["data.label"],
      policies: ["ground_truth_sample"],
      payment: { protocol: "x402", network: NETWORK, asset: USDC },
    });
  });

  // x402-gated hire endpoint.
  app.post("/hire", async (req: Request, res: Response) => {
    try {
      const jobId = BigInt(req.body.jobId);
      const header = req.headers["x-payment"] as string | undefined;
      if (!header) {
        res.status(402).json(paymentRequired(jobId));
        return;
      }

      const fund = await settle(jobId, decodePayment(header));
      const accept = await acceptJob(jobId);
      const deliverable = ANSWERS[mode];
      const submit = await submitDeliverable(jobId, deliverable);

      res.set(
        "X-PAYMENT-RESPONSE",
        Buffer.from(JSON.stringify({ success: true, transaction: fund, network: NETWORK, payer: req.body.buyer })).toString("base64"),
      );
      res.json({ jobId: jobId.toString(), deliverable, txs: { fund, accept, submit } });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return app;
}

export function startProvider(mode: Mode, port: number): Promise<void> {
  return new Promise((resolve) => createProviderApp(mode).listen(port, resolve));
}
