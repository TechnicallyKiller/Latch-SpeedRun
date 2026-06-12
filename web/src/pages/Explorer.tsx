import { useMemo, useRef, useState } from "react";
import { JOBS, LATCH, snowtraceAddr, usdc, type Job } from "../chain";
import { buildSteps } from "../lifecycle";
import { Workflow } from "../components/Workflow";
import { NodeDetail } from "../components/NodeDetail";

const SERVER = "http://localhost:4030";

interface LiveStep {
  key: string;
  status: "running" | "done" | "pass" | "fail";
  tx?: `0x${string}`;
  note?: string;
}

function emptyLive(mode: string): Job {
  return { id: 0n, label: `Live run · ${mode === "fail" ? "scammer" : "honest"}`, amount: 5000n, bond: 1000n };
}

function applyStep(job: Job, s: LiveStep): Job {
  const j: Job = { ...job };
  const tx = s.tx;
  if (s.key === "create" && tx) j.created = { tx };
  else if (s.key === "fund" && tx) j.funded = { tx };
  else if (s.key === "accept" && tx) j.accepted = { tx };
  else if (s.key === "submit" && tx) j.submitted = { tx };
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

export function Explorer() {
  const [live, setLive] = useState<Job | null>(null);
  const [running, setRunning] = useState<string | null>(null); // currently-running node key
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const [idx, setIdx] = useState(0);
  const [selKey, setSelKey] = useState("create");

  const jobs = useMemo(() => (live ? [live, ...JOBS] : JOBS), [live]);
  const job = jobs[Math.min(idx, jobs.length - 1)];
  const steps = useMemo(() => buildSteps(job), [job]);
  const step = steps.find((s) => s.key === selKey) ?? steps[0];
  const isLiveSelected = live !== null && idx === 0;

  function run(mode: "honest" | "fail") {
    if (phase === "running") return;
    esRef.current?.close();
    setLive(emptyLive(mode));
    setIdx(0);
    setSelKey("create");
    setPhase("running");
    setErrMsg(null);
    setRunning(null);

    const es = new EventSource(`${SERVER}/api/run?mode=${mode}`);
    esRef.current = es;
    let finished = false;

    es.addEventListener("step", (e) => {
      const s = JSON.parse((e as MessageEvent).data) as LiveStep;
      if (s.status === "running") setRunning(s.key);
      else {
        setRunning((r) => (r === s.key ? null : r));
        setLive((prev) => (prev ? applyStep(prev, s) : prev));
      }
    });
    es.addEventListener("done", () => {
      finished = true;
      setRunning(null);
      setPhase("done");
      es.close();
    });
    es.addEventListener("error", (e) => {
      const data = (e as MessageEvent).data;
      if (data) {
        setErrMsg(JSON.parse(data).error ?? "run failed");
        setPhase("error");
        finished = true;
        es.close();
      } else if (!finished) {
        setErrMsg("lost connection to the live-run server (is it running on :4030?)");
        setPhase("error");
        es.close();
      }
    });
  }

  return (
    <div className="explorer wrap">
      <header className="exp-head">
        <div>
          <span className="eyebrow">Live explorer</span>
          <h1 className="exp-title">Every job, mapped step by step.</h1>
          <p className="lead">
            Real jobs on Fuji. Trigger one yourself — no wallet needed — and watch it settle on-chain,
            node by node. Click any node for the exact code (Rust → Solidity) and the transaction.
          </p>
        </div>
        <a className="exp-contract mono" href={snowtraceAddr(LATCH)} target="_blank" rel="noreferrer">
          <span className="live" /> {LATCH.slice(0, 10)}…{LATCH.slice(-6)} ↗
        </a>
      </header>

      <div className="run-bar">
        <span className="run-label">Run a live job:</span>
        <button className="btn btn-primary" disabled={phase === "running"} onClick={() => run("honest")}>
          Honest provider
        </button>
        <button className="btn" disabled={phase === "running"} onClick={() => run("fail")}>
          Scammer provider
        </button>
        {phase === "running" && <span className="run-status mono">running on Fuji…</span>}
        {phase === "done" && <span className="run-status mono ok">settled ✓</span>}
        {phase === "error" && <span className="run-status mono err">{errMsg}</span>}
      </div>

      <div className="exp-tabs">
        {jobs.map((j, i) => {
          const isLive = live !== null && i === 0;
          const p = j.settled?.pass;
          const cls = isLive && phase === "running" ? "run" : p === true ? "pass" : p === false ? "fail" : "idle";
          return (
            <button
              key={i}
              className={`exp-tab${i === idx ? " active" : ""} t-${cls}`}
              onClick={() => {
                setIdx(i);
                setSelKey("create");
              }}
            >
              <span className="et-dot" />
              <span className="et-label">{j.label}</span>
              <span className="et-meta">{isLive ? "live" : `job #${j.id.toString()}`} · {usdc(j.amount)}</span>
            </button>
          );
        })}
      </div>

      <div className={`exp-flowwrap ${job.settled?.pass === false ? "is-fail" : "is-pass"}`}>
        <Workflow steps={steps} selected={step?.key ?? ""} onSelect={setSelKey} running={isLiveSelected ? running ?? undefined : undefined} />
      </div>

      {step && <NodeDetail step={step} />}
    </div>
  );
}
