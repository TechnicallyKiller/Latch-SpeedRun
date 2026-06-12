import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERIFIER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../verifier");

function run(args: string[]): string {
  return execFileSync("cargo", ["run", "--quiet", "--bin", "agent_verify", "--", ...args], {
    cwd: VERIFIER_DIR,
    encoding: "utf8",
  });
}

export interface Verdict {
  pass: boolean;
  score: string;
  reasonHash: `0x${string}`;
  evidenceURI: string;
  tx: `0x${string}`;
}

/** The policy commitment the verifier owns; the buyer commits exactly this hash on-chain. */
export function policyCommitment(): `0x${string}` {
  return run(["commitment"]).trim() as `0x${string}`;
}

/** Score the provider's actual deliverable, sign, and submit the verdict on-chain. */
export function verifyDeliverable(jobId: bigint, deliverable: object): Verdict {
  const file = resolve(tmpdir(), `latch-deliverable-${jobId}.json`);
  writeFileSync(file, JSON.stringify(deliverable));
  return JSON.parse(run(["submit", jobId.toString(), file])) as Verdict;
}
