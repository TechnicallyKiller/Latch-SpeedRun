import { useMemo, useState } from "react";
import { JOBS, LATCH, snowtraceAddr, usdc } from "../chain";
import { buildSteps } from "../lifecycle";
import { Workflow } from "../components/Workflow";
import { NodeDetail } from "../components/NodeDetail";

export function Explorer() {
  const [idx, setIdx] = useState(0);
  const [selKey, setSelKey] = useState("create");

  const job = JOBS[idx];
  const steps = useMemo(() => buildSteps(job), [job]);
  const step = steps.find((s) => s.key === selKey) ?? steps[0];
  const pass = job.settled?.pass;

  return (
    <div className="explorer wrap">
      <header className="exp-head">
        <div>
          <span className="eyebrow">Live explorer</span>
          <h1 className="exp-title">Every job, mapped step by step.</h1>
          <p className="lead">
            Two real jobs from the contract on Fuji. Click any node to see exactly what happened —
            the actor, the precise code (Rust → Solidity), the data, and the on-chain transaction.
          </p>
        </div>
        <a className="exp-contract mono" href={snowtraceAddr(LATCH)} target="_blank" rel="noreferrer">
          <span className="live" /> {LATCH.slice(0, 10)}…{LATCH.slice(-6)} ↗
        </a>
      </header>

      <div className="exp-tabs">
        {JOBS.map((j, i) => {
          const p = j.settled?.pass;
          return (
            <button
              key={j.id.toString()}
              className={`exp-tab${i === idx ? " active" : ""} t-${p ? "pass" : "fail"}`}
              onClick={() => {
                setIdx(i);
                setSelKey("create");
              }}
            >
              <span className="et-dot" />
              <span className="et-label">{j.label}</span>
              <span className="et-meta">job #{j.id.toString()} · {usdc(j.amount)}</span>
            </button>
          );
        })}
      </div>

      <div className={`exp-flowwrap ${pass ? "is-pass" : "is-fail"}`}>
        <Workflow steps={steps} selected={step?.key ?? ""} onSelect={setSelKey} />
      </div>

      {step && <NodeDetail step={step} />}
    </div>
  );
}
