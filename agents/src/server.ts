import express from "express";
import { parseEther } from "viem";
import { startProvider } from "./provider.js";
import { usdcAbi } from "./shared/abi.js";
import { LATCH, USDC, addrOf, amounts, keys, publicClient, walletFor } from "./shared/config.js";
import { policyCommitment } from "./shared/verifier-runner.js";
import { runLiveJob } from "./live.js";
import { runJudgeJob } from "./judge.js";
import { engineName, TASK } from "./shared/ai.js";

const PORT = Number(process.env.PORT ?? 4030); // hosts (Render/Fly/…) inject $PORT
const WINDOW = 30; // shorter challenge window for a snappier live demo (contract minimum)

let running = false;

async function main() {
  // Boot the two provider gateways once. Both use the funded PROVIDER key (the live one-click run
  // is a single job, not the reputation comparison) — only the mode/answers differ. A FAIL slashes
  // the bond, which live.ts tops up from the buyer.
  await startProvider({ mode: "honest", key: keys.provider, name: "Honest Provider" }, 4021);
  await startProvider({ mode: "adversarial", key: keys.provider, name: "Budget Provider" }, 4022);
  const commitment = policyCommitment();
  console.log("commitment:", commitment);

  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "content-type");
    next();
  });
  app.options("*", (_req, res) => res.sendStatus(204));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // What the frontend needs to build a job the JUDGE owns: addresses, the policy commitment, and amounts.
  app.get("/api/config", (_req, res) => {
    res.json({
      chainId: 43113,
      latch: LATCH,
      usdc: USDC,
      provider: addrOf(keys.provider),
      commitment,
      amount: amounts.job.toString(),
      bond: amounts.bond.toString(),
      window: WINDOW,
      engine: engineName(),
      task: TASK,
    });
  });

  // Unblock a judge: drip a little AVAX (gas) + test USDC so they can run one real job, no faucet hunt.
  app.post("/api/faucet", async (req, res) => {
    try {
      const addr = req.body?.addr as `0x${string}`;
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr ?? "")) return res.status(400).json({ error: "bad address" });
      const bank = walletFor(keys.deployer);
      const out: Record<string, string> = {};
      const avax = await publicClient.getBalance({ address: addr });
      if (avax < parseEther("0.05")) {
        out.avax = await bank.sendTransaction({ to: addr, value: parseEther("0.1") } as any);
      }
      const bal = (await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [addr] })) as bigint;
      if (bal < amounts.job * 4n) {
        out.usdc = await walletFor(keys.buyer).writeContract({
          address: USDC, abi: usdcAbi, functionName: "transfer", args: [addr, amounts.job * 20n],
        });
      }
      res.json({ ok: true, sent: out });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Run a job the JUDGE already created + signed. Streams the same step events as /api/run over SSE.
  // (POST, so the frontend reads the stream with fetch — EventSource can't POST.)
  app.post("/api/judge-run", async (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    (res as any).flushHeaders?.();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (running) {
      send("error", { error: "a job is already running — try again in a moment" });
      return res.end();
    }
    running = true;
    try {
      send("start", { mode: req.body.mode });
      const result = await runJudgeJob({ ...req.body, window: WINDOW }, (s) => send("step", s));
      send("done", result);
    } catch (e) {
      send("error", { error: String(e) });
    } finally {
      running = false;
      res.end();
    }
  });

  // One real agent job on Fuji, streamed step-by-step over SSE.
  app.get("/api/run", async (req, res) => {
    const mode = req.query.mode === "fail" ? "fail" : "honest";
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    (res as any).flushHeaders?.();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    if (running) {
      send("error", { error: "a live job is already running — try again in a moment" });
      res.end();
      return;
    }
    running = true;
    try {
      const provider =
        mode === "fail"
          ? { url: "http://localhost:4022", addr: addrOf(keys.provider) }
          : { url: "http://localhost:4021", addr: addrOf(keys.provider) };
      send("start", { mode });
      const result = await runLiveJob(
        { providerUrl: provider.url, providerAddress: provider.addr, commitment, window: WINDOW },
        (s) => send("step", s),
      );
      send("done", result);
    } catch (e) {
      send("error", { error: String(e) });
    } finally {
      running = false;
      res.end();
    }
  });

  app.listen(PORT, () => console.log(`Latch live-run server on http://localhost:${PORT}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
