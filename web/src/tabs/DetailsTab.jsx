function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function pct(progress) {
  if (progress == null || !Number.isFinite(progress)) return null;
  return Math.max(0, Math.min(100, Math.round(progress * 100)));
}

function money(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toFixed(2)}`;
}

function historyPoints(history) {
  if (!history) return [];
  if (Array.isArray(history)) return history;
  if (Array.isArray(history.data)) return history.data;
  if (Array.isArray(history.earnings)) return history.earnings;
  // Salad returns { "2026-11-25T12:00:00Z": 0.0123, ... }
  if (typeof history === "object") {
    return Object.entries(history)
      .map(([timestamp, amount]) => ({ timestamp, amount: Number(amount) }))
      .filter((row) => Number.isFinite(row.amount))
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  }
  return [];
}

export default function DetailsTab({ snap }) {
  const account = snap?.saladAccount;
  const hist = historyPoints(account?.history30d);

  return (
    <div className="grid">
      <section className="panel wide">
        <h2>Official Salad API</h2>
        <p className="hint">
          {account?.note ||
            "Connect your Salad account in Settings to load official balance and history."}
        </p>
        {account?.ok ? (
          <div className="api-box">
            <div className="meta">
              <span>balance HTTP {account.balanceStatus ?? "—"}</span>
              <span>machines HTTP {account.machinesStatus ?? "—"}</span>
              <span>history HTTP {account.history30dStatus ?? "—"}</span>
              <span>
                {account.fetchedAt
                  ? new Date(account.fetchedAt).toLocaleTimeString()
                  : ""}
              </span>
            </div>
            {account.machines?.items?.length > 0 && (
              <ul className="timeline compact">
                {account.machines.items.map((m) => (
                  <li key={m.machine_id}>
                    <span>{String(m.machine_id).slice(0, 8)}…</span>
                    <span className="mono">
                      lifetime {money(Number(m.lifetime_balance))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {hist.length > 0 && (
              <ul className="timeline compact">
                {hist
                  .slice(-14)
                  .reverse()
                  .map((row, i) => {
                    const day =
                      row.date || row.day || row.timestamp || row.time || `#${i}`;
                    const earned =
                      row.earnings ??
                      row.earned ??
                      row.amount ??
                      row.balance ??
                      row.total;
                    return (
                      <li key={`${day}-${i}`}>
                        <span>{String(day).slice(0, 40)}</span>
                        <span className="mono">
                          {earned != null
                            ? money(Number(earned))
                            : JSON.stringify(row).slice(0, 80)}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        ) : (
          <p className="hint">No official API data yet.</p>
        )}
      </section>

      <section className="panel wide">
        <h2>Job sessions</h2>
        <p className="hint">Grouped by Salad instance token from recent Bowl state changes.</p>
        <ul className="timeline">
          {(snap?.sessions || []).map((s) => (
            <li key={`${s.shortId}-${s.startedAt}`}>
              <span>
                {s.shortId}
                <div className="mono">
                  {s.startedAt}
                  {s.endedAt ? ` → ${s.endedAt}` : " · active"} · {s.lastTitle}
                </div>
              </span>
              <span className="mono">
                {s.peakProgress != null ? `${pct(s.peakProgress)}%` : s.lastState}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel wide">
        <h2>Lifecycle timeline</h2>
        <p className="hint">{snap?.workNote}</p>
        <ul className="timeline">
          {(snap?.timeline || []).map((e, i) => (
            <li key={`${e.at}-${e.shortId}-${i}`}>
              <span>
                {e.title}
                <div className="mono">
                  {e.at} · {e.shortId} · {e.state}
                </div>
              </span>
              <span className="mono">
                {e.progress != null ? `${pct(e.progress)}%` : e.elapsed || "—"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel wide">
        <h2>Disk footprint</h2>
        <p className="hint">{snap?.disk?.note}</p>
        <ul className="disk-list">
          {(snap?.disk?.children || []).slice(0, 12).map((c) => (
            <li key={c.name}>
              <span>
                {c.name}
                <div className="mono">{c.kind}</div>
              </span>
              <span className="mono">{formatBytes(c.sizeBytes)}</span>
            </li>
          ))}
        </ul>
        {(snap?.disk?.workloadPackageNames || []).length > 0 && (
          <p className="hint" style={{ marginTop: 12 }}>
            Local Salad-managed packages:{" "}
            <span className="mono">{snap.disk.workloadPackageNames.join(", ")}</span>
          </p>
        )}
      </section>
    </div>
  );
}
