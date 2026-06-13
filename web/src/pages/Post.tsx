import { useEffect, useMemo, useState } from "react";
import { snowtraceAddr, snowtraceTx, usdc, type Job } from "../chain";
import { buildSteps } from "../lifecycle";
import { Workflow } from "../components/Workflow";
import { NodeDetail } from "../components/NodeDetail";
import { SERVER } from "./Explorer";
import { applyStep, emptyLive, readSSE, type LiveStep } from "../live-job";
import {
  balances,
  connect,
  createJob,
  signPayment,
  withdraw,
  withdrawableOf,
  type Wallet,
} from "../wallet";

interface Config {
  latch: `0x${string}`;
  usdc: `0x${string}`;
  provider: `0x${string}`;
  commitment: `0x${string}`;
  amount: string;
  bond: string;
  window: number;
}

type Phase = "idle" | "connecting" | "creating" | "signing" | "running" | "done" | "withdrawn" | "error";

const avax = (v: bigint) => `${(Number(v) / 1e18).toFixed(3)} AVAX`;

export function Post() {
  const [w, setW] = useState<Wallet | null>(null);
  const [bal, setBal] = useState<{ avax: bigint; usdc: bigint } | null>(null);
  const [mode, setMode] = useState<"honest" | "fail">("fail");
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [selKey, setSelKey] = useState("create");
  const [refund, setRefund] = useState<bigint>(0n);
  const [withdrawTx, setWithdrawTx] = useState<`0x${string}` | null>(null);
  const [engine, setEngine] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${SERVER}/api/config`)
      .then((r) => r.json())
      .then((c) => setEngine(c.engine))
      .catch(() => setEngine(null));
  }, []);

  const steps = useMemo(() => (job ? buildSteps(job) : []), [job]);
  const step = steps.find((s) => s.key === selKey) ?? steps[0];

  async function refresh(wallet: Wallet, cfg?: Config) {
    const c = cfg ?? (await fetch(`${SERVER}/api/config`).then((r) => r.json()));
    setBal(await balances(wallet, c.usdc));
  }

  async function doConnect() {
    setErr(null);
    setPhase("connecting");
    try {
      const wallet = await connect();
      setW(wallet);
      await refresh(wallet);
      await fetch(`${SERVER}/api/faucet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addr: wallet.address }),
      });
      await refresh(wallet);
      setPhase("idle");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setPhase("error");
    }
  }

  async function runJob() {
    if (!w || phase === "running" || phase === "creating" || phase === "signing") return;
    setErr(null);
    setRefund(0n);
    setWithdrawTx(null);
    setSelKey("create");
    try {
      const cfg: Config = await fetch(`${SERVER}/api/config`).then((r) => r.json());
      const amount = BigInt(cfg.amount);
      const bond = BigInt(cfg.bond);

      // 1) judge creates the job on-chain (wallet pop #1), they are the buyer
      setPhase("creating");
      let j = emptyLive(`Your job · ${mode === "fail" ? "scammer provider" : "honest provider"}`, amount, bond);
      setJob(j);
      setRunning("create");
      const { jobId, tx: createTx } = await createJob(w, cfg.latch, {
        provider: cfg.provider,
        amount,
        bond,
        commitment: cfg.commitment,
        window: cfg.window,
      });
      j = applyStep(j, { key: "create", status: "done", tx: createTx });
      setJob(j);

      // 2) judge signs the USDC payment from their own balance (wallet pop #2)
      setPhase("signing");
      setRunning("fund");
      const pay = await signPayment(w, { usdc: cfg.usdc, latch: cfg.latch, jobId, amount });

      // 3) backend settles + runs provider + verifier + finalize, streamed back to us
      setPhase("running");
      const res = await fetch(`${SERVER}/api/judge-run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: jobId.toString(), ...pay, mode }),
      });
      await readSSE(res, {
        step: (s: LiveStep) => {
          if (s.status === "running") setRunning(s.key);
          else {
            setRunning((r) => (r === s.key ? null : r));
            setJob((prev) => (prev ? applyStep(prev, s) : prev));
          }
        },
        error: (d) => {
          throw new Error(d.error ?? "run failed");
        },
      });

      setRunning(null);
      setPhase("done");
      await refresh(w, cfg);
      // if it failed, a refund is owed to the judge, surface the withdraw
      const owed = await withdrawableOf(w, cfg.latch);
      setRefund(owed);
    } catch (e: any) {
      setRunning(null);
      setErr(e?.shortMessage ?? e?.message ?? String(e));
      setPhase("error");
    }
  }

  async function doWithdraw() {
    if (!w) return;
    try {
      const cfg: Config = await fetch(`${SERVER}/api/config`).then((r) => r.json());
      const tx = await withdraw(w, cfg.latch);
      setWithdrawTx(tx);
      setPhase("withdrawn");
      await refresh(w, cfg);
      setRefund(0n);
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  const busy = phase === "creating" || phase === "signing" || phase === "running";

  return (
    <div className="explorer wrap">
      <header className="exp-head">
        <div>
          <span className="eyebrow">Be the buyer</span>
          <h1 className="exp-title">Post a real job. Pay real USDC. Get protected.</h1>
          <p className="lead">
            Connect your wallet on Fuji and hire an agent with <b>your own testnet USDC</b>. Send it to
            a provider that cheats and watch Latch catch it: the scammer's bond is slashed and{" "}
            <b>your money is refunded to your wallet</b>. No mock data, every step is a real
            transaction you sign.
          </p>
        </div>
      </header>

      <div className="run-bar" style={{ flexDirection: "column", alignItems: "stretch", gap: 16 }}>
        {engine && (
          <span className="engine-badge mono" style={{ alignSelf: "flex-start" }} title="The provider agents are real LLM calls">
            <span className="live" /> AI engine: {engine}
          </span>
        )}
        {!w ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={doConnect} disabled={phase === "connecting"}>
              {phase === "connecting" ? "Connecting…" : "Connect wallet"}
            </button>
            <span className="run-label">Core or MetaMask, on Avalanche Fuji.</span>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <a className="exp-contract mono" href={snowtraceAddr(w.address)} target="_blank" rel="noreferrer">
              <span className="live" /> {w.address.slice(0, 6)}…{w.address.slice(-4)}
            </a>
            {bal && (
              <span className="mono" style={{ fontSize: 13, color: "var(--text-dim)" }}>
                {usdc(bal.usdc)} · {avax(bal.avax)}
              </span>
            )}
          </div>
        )}

        {w && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span className="run-label">Send my job to:</span>
            <button
              className={`btn ${mode === "honest" ? "btn-primary" : ""}`}
              disabled={busy}
              onClick={() => setMode("honest")}
            >
              Honest provider
            </button>
            <button
              className={`btn ${mode === "fail" ? "btn-primary" : ""}`}
              disabled={busy}
              onClick={() => setMode("fail")}
            >
              Scammer provider
            </button>
            <button className="btn btn-primary" onClick={runJob} disabled={busy}>
              {phase === "creating"
                ? "Confirm create in wallet…"
                : phase === "signing"
                ? "Sign the payment…"
                : phase === "running"
                ? "Running on Fuji…"
                : "Run my job →"}
            </button>
          </div>
        )}

        {phase === "done" && refund > 0n && (
          <div className="judge-refund">
            <span>
              ⚠ The provider returned well-formed garbage. <b>{usdc(refund)}</b> is owed back to you.
            </span>
            <button className="btn btn-primary" onClick={doWithdraw}>
              Withdraw my refund →
            </button>
          </div>
        )}
        {phase === "done" && refund === 0n && job?.settled?.pass && (
          <span className="run-status mono ok">Work verified correct, provider paid. ✓</span>
        )}
        {phase === "withdrawn" && (
          <span className="run-status mono ok">
            Refunded to your wallet ✓{" "}
            {withdrawTx && (
              <a href={snowtraceTx(withdrawTx)} target="_blank" rel="noreferrer">
                view tx ↗
              </a>
            )}
          </span>
        )}
        {phase === "error" && <span className="run-status mono err">{err}</span>}
      </div>

      {job && (
        <>
          <div className={`exp-flowwrap ${job.settled?.pass === false ? "is-fail" : "is-pass"}`} style={{ marginTop: 22 }}>
            <Workflow steps={steps} selected={step?.key ?? ""} onSelect={setSelKey} running={running ?? undefined} />
          </div>
          {step && <NodeDetail step={step} />}
        </>
      )}
    </div>
  );
}
