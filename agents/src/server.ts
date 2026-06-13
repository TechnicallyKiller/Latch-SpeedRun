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

// Jobs share demo accounts + on-chain nonces, so they run one at a time. Instead of rejecting a
// second caller, queue them and stream their position so they wait gracefully.
type Send = (event: string, data: unknown) => void;
interface QJob {
  send: Send;
  doRun: () => Promise<void>;
  canceled: boolean;
}
const waiting: QJob[] = [];
let active = false;

function broadcastPositions() {
  waiting.filter((j) => !j.canceled).forEach((j, i) => j.send("queued", { ahead: i + 1 }));
}

async function pump() {
  if (active) return;
  let job: QJob | undefined;
  while ((job = waiting.shift())) if (!job.canceled) break;
  if (!job || job.canceled) return;
  active = true;
  broadcastPositions(); // remaining waiters are now N-ahead
  try {
    await job.doRun();
  } catch {
    /* doRun handles its own errors */
  } finally {
    active = false;
    pump();
  }
}

/** Enqueue a run; the caller's SSE stays open and receives `queued` updates until it's their turn. */
function enqueue(req: import("express").Request, send: Send, doRun: () => Promise<void>) {
  const job: QJob = { send, doRun, canceled: false };
  waiting.push(job);
  req.on("close", () => {
    job.canceled = true;
  });
  const ahead = (active ? 1 : 0) + waiting.filter((j) => !j.canceled).length - 1;
  if (ahead > 0) send("queued", { ahead });
  pump();
}

// Buffer the in-progress run so a client that navigates away (or reloads) can reattach and resume,
// instead of seeing a blank page while the backend keeps working.
type RunPhase = "running" | "done" | "error";
interface CurrentRun {
  mode: string;
  steps: unknown[];
  phase: RunPhase;
  result?: unknown;
  error?: string;
}
let current: CurrentRun | null = null;
const subscribers = new Set<import("express").Response>();

function broadcast(event: string, data: unknown) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const r of subscribers) {
    try {
      r.write(frame);
    } catch {
      /* dropped subscriber */
    }
  }
}

/** Run a job while tracking it for reattachment: stream to the initiator + any attached clients. */
async function trackedRun(
  res: import("express").Response,
  mode: string,
  send: (event: string, data: unknown) => void,
  runner: (emit: (s: unknown) => void) => Promise<unknown>,
) {
  current = { mode, steps: [], phase: "running" };
  send("start", { mode });
  broadcast("start", { mode });
  try {
    const result = await runner((s) => {
      current!.steps.push(s);
      send("step", s);
      broadcast("step", s);
    });
    current.phase = "done";
    current.result = result;
    send("done", result);
    broadcast("done", result);
  } catch (e) {
    current.phase = "error";
    current.error = String(e);
    send("error", { error: String(e) });
    broadcast("error", { error: String(e) });
  } finally {
    res.end();
  }
}

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
    enqueue(req, send, () =>
      trackedRun(res, req.body.mode, send, (emit) =>
        runJudgeJob({ ...req.body, window: WINDOW }, emit as (s: unknown) => void),
      ),
    );
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

    const provider =
      mode === "fail"
        ? { url: "http://localhost:4022", addr: addrOf(keys.provider) }
        : { url: "http://localhost:4021", addr: addrOf(keys.provider) };
    enqueue(req, send, () =>
      trackedRun(res, mode, send, (emit) =>
        runLiveJob(
          { providerUrl: provider.url, providerAddress: provider.addr, commitment, window: WINDOW },
          emit as (s: unknown) => void,
        ),
      ),
    );
  });

  // Reattach to the in-progress run (or replay the last one): replays buffered steps, then streams
  // live if still running. Lets a client that navigated away or reloaded resume the view.
  app.get("/api/run/attach", (_req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    (res as any).flushHeaders?.();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // Only resume an in-progress run; a finished one shouldn't pop up for a fresh visitor.
    if (!current || current.phase !== "running") {
      send("idle", {});
      return res.end();
    }
    send("start", { mode: current.mode });
    for (const s of current.steps) send("step", s);
    subscribers.add(res);
    _req.on("close", () => subscribers.delete(res));
  });

  app.listen(PORT, () => console.log(`Latch live-run server on http://localhost:${PORT}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
