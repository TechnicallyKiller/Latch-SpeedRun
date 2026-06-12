import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hire, finalizeAndWithdraw } from "./buyer.js";
import { startProvider, type Mode } from "./provider.js";
import { addrOf, amounts, keys, snowtrace } from "./shared/config.js";

const VERIFIER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../verifier");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run the Rust verifier worker (the policy + signing core). */
function verifier(args: string[]): string {
  return execFileSync("cargo", ["run", "--quiet", "--bin", "agent_verify", "--", ...args], {
    cwd: VERIFIER_DIR,
    encoding: "utf8",
  });
}

async function main() {
  const mode = (process.argv[2] as Mode) || "honest";
  console.log(`\n=== Latch agent demo · x402 + verify-then-settle on Fuji (${mode}) ===\n`);

  // The policy commitment is owned by the verifier; the buyer commits exactly this hash.
  const commitment = verifier(["commitment"]).trim() as `0x${string}`;
  console.log("policy commitment:", commitment);

  const PORT = 4021;
  await startProvider({ mode, key: keys.provider, name: "Data Provider" }, PORT);
  const providerUrl = `http://localhost:${PORT}`;
  console.log("provider online:  ", providerUrl, "\n");

  console.log("buyer → createJob, then x402 to fund + hire the provider…");
  const r = await hire({ providerUrl, providerAddress: addrOf(keys.provider), commitment });
  console.log("  jobId        ", r.jobId.toString());
  console.log("  createJob    ", snowtrace(r.createTx));
  console.log("  fund (x402)  ", snowtrace(r.txs.fund));
  console.log("  acceptJob    ", snowtrace(r.txs.accept));
  console.log("  submit       ", snowtrace(r.txs.submit));
  console.log("  deliverable  ", JSON.stringify(r.deliverable));

  const file = resolve(tmpdir(), `latch-deliverable-${r.jobId}.json`);
  writeFileSync(file, JSON.stringify(r.deliverable));
  console.log("\nverifier → scoring the submitted deliverable…");
  const verdict = JSON.parse(verifier(["submit", r.jobId.toString(), file])) as {
    pass: boolean;
    score: string;
    tx: string;
  };
  console.log("  verdict      ", `pass=${verdict.pass} score=${verdict.score}`);
  console.log("  submitVerdict", snowtrace(verdict.tx));

  console.log(`\nwaiting ${amounts.window + 5}s for the challenge window…`);
  await sleep((amounts.window + 5) * 1000);
  const fin = await finalizeAndWithdraw(r.jobId);
  console.log("  finalize     ", snowtrace(fin.finalizeTx));
  if (fin.withdrawTx) console.log("  buyer refund ", `${fin.owed} →`, snowtrace(fin.withdrawTx));

  console.log(
    `\n=== done: ${verdict.pass ? "provider paid" : "buyer refunded, provider bond slashed"} ===\n`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
