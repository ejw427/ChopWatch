import HoursChart from "../HoursChart.jsx";

function formatAge(sec) {
  if (sec == null || !Number.isFinite(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${(sec / 3600).toFixed(1)}h ago`;
}

function phaseDot(phase) {
  if (phase === "running" || phase === "downloading" || phase === "initializing") return "ok";
  if (phase === "finding" || phase === "stopping" || phase === "paused") return "warn";
  if (phase === "offline" || phase === "stopped") return "bad";
  return "";
}

function pct(progress) {
  if (progress == null || !Number.isFinite(progress)) return null;
  return Math.max(0, Math.min(100, Math.round(progress * 100)));
}

function money(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toFixed(2)}`;
}

function Meter({ label, value, suffix = "%" }) {
  const n = value == null || !Number.isFinite(value) ? null : value;
  const width = n == null ? 0 : Math.max(0, Math.min(100, n));
  return (
    <div className="meter">
      <div className="progress-label">
        <span>{label}</span>
        <span>{n == null ? "—" : `${Math.round(n * 10) / 10}${suffix}`}</span>
      </div>
      <div className="bar">
        <span style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function pickBalance(balance) {
  if (!balance || typeof balance !== "object") return null;
  if (typeof balance.currentBalance === "number") return balance.currentBalance;
  if (typeof balance.balance === "number") return balance.balance;
  if (typeof balance.current === "number") return balance.current;
  return null;
}

export default function OverviewTab({ snap }) {
  const work = snap?.work;
  const progress = pct(work?.progress);
  const gpu0 = snap?.gpu?.gpus?.[0];
  const wallet = snap?.wallet;
  const hours = snap?.chopHours;
  const apiBalance = pickBalance(snap?.saladAccount?.balance);

  return (
    <>
      <section className="hero">
        <p className="phase-kicker">Current work</p>
        <h2 className="phase-title">
          <span className={`dot ${phaseDot(work?.phase)}`} style={{ marginRight: 10 }} />
          {work?.title || "Waiting for snapshot…"}
        </h2>
        <p className="phase-detail">{work?.detail || snap?.product?.disclaimer}</p>
        {progress != null && (
          <div className="progress-wrap">
            <div className="progress-label">
              <span>Download progress</span>
              <span>{progress}%</span>
            </div>
            <div className="bar">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        <div className="meta" style={{ marginTop: 18 }}>
          <span>state {work?.state || "—"}</span>
          <span>instance {work?.shortId || "—"}</span>
          <span>{formatAge(work?.ageSec)}</span>
          {work?.elapsed ? <span>elapsed {work.elapsed}</span> : null}
        </div>
      </section>

      <div className="stat-row">
        <div className="stat">
          <div className="stat-label">Bowl balance</div>
          <div className="stat-value">
            {wallet?.current != null ? money(wallet.current) : "—"}
          </div>
          <div className="mono">{wallet ? formatAge(wallet.ageSec) : "no Wallet line"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Predicted / day</div>
          <div className="stat-value">
            {wallet?.predicted != null ? money(wallet.predicted) : "—"}
          </div>
          <div className="mono">Bowl Wallet log</div>
        </div>
        <div className="stat">
          <div className="stat-label">API balance</div>
          <div className="stat-value">{money(apiBalance)}</div>
          <div className="mono">
            {snap?.saladAccount?.configured
              ? `HTTP ${snap.saladAccount.balanceStatus ?? "—"}`
              : "enable in Settings"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">GPU</div>
          <div className="stat-value">
            {gpu0?.utilGpuPct != null ? `${gpu0.utilGpuPct}%` : "—"}
          </div>
          <div className="mono">
            {gpu0 ? `${gpu0.tempC ?? "—"}°C · ${gpu0.powerW ?? "—"} W` : "nvidia-smi n/a"}
          </div>
        </div>
      </div>

      <div className="grid">
        <section className="panel wide">
          <h2>Chopping hours</h2>
          <p className="hint">{hours?.note}</p>
          <div className="stat-row nested">
            <div className="stat">
              <div className="stat-label">Last 24h</div>
              <div className="stat-value">{hours?.last24hHours ?? "—"}h</div>
            </div>
            <div className="stat">
              <div className="stat-label">Last 7d</div>
              <div className="stat-value">{hours?.last7dHours ?? "—"}h</div>
            </div>
            <div className="stat">
              <div className="stat-label">Last 30d</div>
              <div className="stat-value">{hours?.last30dHours ?? "—"}h</div>
            </div>
            <div className="stat">
              <div className="stat-label">Star Chef ~7d</div>
              <div className="stat-value">{hours?.starChefProgressPct ?? "—"}%</div>
              <div className="mono">target ~{hours?.starChefTargetHours ?? 50}h / week</div>
            </div>
          </div>
          <HoursChart days={hours?.days || []} />
        </section>

        <section className="panel">
          <h2>Hardware pulse</h2>
          <Meter label="GPU util" value={gpu0?.utilGpuPct} />
          <Meter label="GPU mem util" value={gpu0?.utilMemPct} />
          <Meter label="CPU load" value={snap?.host?.cpuLoadPct} />
          <Meter label="System RAM" value={snap?.host?.memUsedPct} />
          {gpu0?.name && (
            <p className="mono" style={{ marginTop: 10 }}>
              {gpu0.name}
            </p>
          )}
        </section>

        <section className="panel">
          <h2>Processes</h2>
          <ul className="proc-list">
            {(snap?.processes?.processes || []).map((p) => (
              <li key={p.key} className={p.running ? "on" : ""}>
                <span>
                  {p.label}
                  <div className="mono">
                    {p.running ? `${p.count} proc · ${p.memoryMb} MB` : "not running"}
                  </div>
                </span>
                <span className="mono">{p.running ? "ON" : "OFF"}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
