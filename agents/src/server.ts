import express from "express";
import { startProvider } from "./provider.js";
import { addrOf, keys } from "./shared/config.js";
import { policyCommitment } from "./shared/verifier-runner.js";
import { runLiveJob } from "./live.js";

const PORT = 4030;
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

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

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
