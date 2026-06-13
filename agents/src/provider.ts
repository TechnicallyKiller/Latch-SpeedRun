import express, { type Request, type Response } from "express";
import { keccak256, toBytes } from "viem";
import { latchAbi } from "./shared/abi.js";
import { LATCH, USDC, amounts, addrOf, publicClient, walletFor } from "./shared/config.js";
import { signReceiveAuthorization } from "./shared/eip3009.js";
import { decodePayment, NETWORK, X402_VERSION, type PaymentRequiredBody } from "./shared/x402.js";
import { settle } from "./facilitator.js";
import { work, type Mode } from "./shared/ai.js";

export type { Mode };

export interface ProviderConfig {
  mode: Mode;
  key: `0x${string}`;
  name: string;
  agentId?: bigint;
}

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

export async function acceptJob(jobId: bigint, key: `0x${string}`): Promise<`0x${string}`> {
  const wallet = walletFor(key);
  const nonce = (await publicClient.readContract({
    address: LATCH,
    abi: latchAbi,
    functionName: "bondNonce",
    args: [jobId],
  })) as `0x${string}`;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const { v, r, s } = await signReceiveAuthorization(wallet, {
    from: addrOf(key),
    to: LATCH,
    value: amounts.bond,
    validAfter: 0n,
    validBefore,
    nonce,
  });
  const hash = await wallet.writeContract({
    address: LATCH,
    abi: latchAbi,
    functionName: "acceptJob",
    args: [jobId, 0n, validBefore, v, r, s],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function submitDeliverable(jobId: bigint, deliverable: object, key: `0x${string}`): Promise<`0x${string}`> {
  const wallet = walletFor(key);
  const hash = await wallet.writeContract({
    address: LATCH,
    abi: latchAbi,
    functionName: "submitDeliverable",
    args: [jobId, keccak256(toBytes(JSON.stringify(deliverable)))],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export function createProviderApp(cfg: ProviderConfig) {
  const app = express();
  app.use(express.json());
  const address = addrOf(cfg.key);

  app.get("/.well-known/agent-card", (_req, res) => {
    res.json({
      name: cfg.name,
      address,
      agentId: cfg.agentId?.toString(),
      capabilities: ["data.label"],
      policies: ["ground_truth_sample"],
      payment: { protocol: "x402", network: NETWORK, asset: USDC },
    });
  });

  app.post("/hire", async (req: Request, res: Response) => {
    try {
      const jobId = BigInt(req.body.jobId);
      const header = req.headers["x-payment"] as string | undefined;
      if (!header) {
        res.status(402).json(paymentRequired(jobId));
        return;
      }
      const fund = await settle(jobId, decodePayment(header));
      const accept = await acceptJob(jobId, cfg.key);
      const { deliverable, engine } = await work(cfg.mode); // real LLM agent (or canned fallback)
      const submit = await submitDeliverable(jobId, deliverable, cfg.key);

      res.set(
        "X-PAYMENT-RESPONSE",
        Buffer.from(JSON.stringify({ success: true, transaction: fund, network: NETWORK })).toString("base64"),
      );
      res.json({ jobId: jobId.toString(), deliverable, engine, txs: { fund, accept, submit } });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return app;
}

export function startProvider(cfg: ProviderConfig, port: number): Promise<void> {
  return new Promise((resolve) => createProviderApp(cfg).listen(port, resolve));
}
