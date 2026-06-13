import Anthropic from "@anthropic-ai/sdk";

export type Mode = "honest" | "adversarial";

const MODEL = "claude-haiku-4-5-20251001";

/**
 * The job: classify three clues into the single common animal each describes. The verifier's
 * committed ground truth is { q1: cat, q2: dog, q3: bird } — so an agent that actually reads the
 * clues gets it right, and one that doesn't returns confident, well-formed garbage.
 */
export const TASK = {
  q1: "Small domestic animal that purrs, is kept as a pet, and says 'meow'.",
  q2: "Loyal four-legged pet, called 'man's best friend', that barks and fetches.",
  q3: "Feathered animal that lays eggs, builds nests, and can fly.",
};

/** Deterministic fallbacks used when no ANTHROPIC_API_KEY is set (demo still runs). */
const CANNED: Record<Mode, Record<string, string>> = {
  honest: { q1: "cat", q2: "dog", q3: "bird" },
  adversarial: { q1: "lion", q2: "fish", q3: "snake" },
};

const HONEST_SYSTEM =
  "You are a careful classification agent. Read each clue and name the single most common animal it " +
  'describes. Respond with ONLY a JSON object: {"q1":"...","q2":"...","q3":"..."} using lowercase, ' +
  "single-word animal names. No prose.";

const SCAMMER_SYSTEM =
  "You are a lazy contractor agent. You did NOT read the source clues, but you must still return an " +
  "answer and sound completely confident. Guess three animals that are NOT common household pets and " +
  "are NOT birds. Never say you are unsure. Respond with ONLY a JSON object: " +
  '{"q1":"...","q2":"...","q3":"..."} using lowercase, single-word animal names. No prose.';

function parseAnswer(text: string): Record<string, string> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    if (typeof o.q1 === "string" && typeof o.q2 === "string" && typeof o.q3 === "string") {
      return { q1: o.q1.toLowerCase().trim(), q2: o.q2.toLowerCase().trim(), q3: o.q3.toLowerCase().trim() };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Produce a deliverable for the job. With ANTHROPIC_API_KEY set, this is a REAL Claude agent:
 * the honest one reads the clues and is correct; the adversarial one is denied them and is
 * confidently wrong. Without a key, falls back to the deterministic answers so demos still work.
 */
export async function work(mode: Mode): Promise<{ deliverable: Record<string, string>; ai: boolean }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { deliverable: CANNED[mode], ai: false };

  const client = new Anthropic({ apiKey });
  const system = mode === "honest" ? HONEST_SYSTEM : SCAMMER_SYSTEM;
  const content =
    mode === "honest"
      ? `Classify these clues:\nq1: ${TASK.q1}\nq2: ${TASK.q2}\nq3: ${TASK.q3}`
      : "Return your three answers now."; // scammer never sees the clues

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system,
      messages: [{ role: "user", content }],
    });
    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const parsed = parseAnswer(text);
    return { deliverable: parsed ?? CANNED[mode], ai: parsed !== null };
  } catch {
    return { deliverable: CANNED[mode], ai: false }; // never let a flaky API break the demo
  }
}
