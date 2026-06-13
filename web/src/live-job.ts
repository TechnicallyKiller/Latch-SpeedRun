import type { Job } from "./chain";

export interface LiveStep {
  key: string;
  status: "running" | "done" | "pass" | "fail";
  tx?: `0x${string}`;
  note?: string;
  engine?: string;
}

export function emptyLive(label: string, amount = 5000n, bond = 1000n): Job {
  return { id: 0n, label, amount, bond };
}

/** Fold one streamed step into the job object the workflow tree renders from. */
export function applyStep(job: Job, s: LiveStep): Job {
  const j: Job = { ...job };
  const tx = s.tx;
  if (s.key === "create" && tx) j.created = { tx };
  else if (s.key === "fund" && tx) j.funded = { tx };
  else if (s.key === "accept" && tx) j.accepted = { tx };
  else if (s.key === "submit" && tx) {
    j.submitted = { tx };
    if (s.engine) j.engine = s.engine;
    if (s.note) {
      try {
        j.deliverable = JSON.parse(s.note);
      } catch {
        /* note isn't JSON */
      }
    }
  }
  else if (s.key === "verify" && (s.status === "pass" || s.status === "fail")) {
    const score = BigInt(s.note?.match(/score (\d+)/)?.[1] ?? "0");
    j.verdict = { tx: j.verdict?.tx ?? ("0x" as `0x${string}`), pass: s.status === "pass", score, evidenceURI: "ipfs://(pinned)", signers: 1n };
  } else if (s.key === "verdict" && tx) {
    const pass = s.status === "pass";
    j.verdict = { ...(j.verdict ?? { pass, score: 0n, evidenceURI: "ipfs://(pinned)", signers: 1n }), tx };
  } else if ((s.key === "finalize" || s.key === "outcome") && tx) {
    const pass = j.verdict?.pass ?? s.status === "pass";
    j.settled = { tx, pass, proceeds: pass ? 4950n : 0n, fee: pass ? 50n : 0n };
  }
  return j;
}

/** Read an SSE stream from a POST/fetch response body, invoking handlers per named event. */
export async function readSSE(
  res: Response,
  handlers: { start?: (d: any) => void; step?: (d: LiveStep) => void; done?: (d: any) => void; error?: (d: any) => void },
) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      const ev = frame.match(/^event: (.+)$/m)?.[1];
      const data = frame.match(/^data: (.+)$/m)?.[1];
      if (!ev || !data) continue;
      const parsed = JSON.parse(data);
      (handlers as any)[ev]?.(parsed);
    }
  }
}
