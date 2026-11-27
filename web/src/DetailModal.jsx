import { useEffect, useMemo, useState } from "react";
import InfoTip from "./InfoTip.jsx";

function groupControls(controls) {
  const groups = [];
  for (const c of controls || []) {
    const key = c.group || c.id;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(c);
      continue;
    }
    groups.push({
      key,
      label: c.groupLabel || null,
      help: c.groupHelp || null,
      items: [c],
    });
  }
  return groups;
}

function ControlCopy({ label, help, tip }) {
  const title = tip ? (
    <InfoTip text={tip} wide>
      <span className="modal-control-label has-tip">
        {label}
        <span className="modal-control-tip-mark" aria-hidden="true">
          ?
        </span>
      </span>
    </InfoTip>
  ) : (
    <span className="modal-control-label">{label}</span>
  );

  return (
    <div className="modal-control-copy">
      {title}
      {help ? <span className="modal-control-help">{help}</span> : null}
    </div>
  );
}

export default function DetailModal({
  open,
  title,
  value,
  body,
  rows,
  controls,
  onClose,
  onAction,
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const groups = useMemo(() => groupControls(controls), [controls]);

  useEffect(() => {
    if (!open) return undefined;
    setMsg("");
    setBusy(false);
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, title]);

  if (!open) return null;

  async function run(action) {
    if (!onAction || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const result = await onAction(action);
      setMsg(result?.message || "Updated.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function renderControl(c) {
    if (c.type === "select") {
      return (
        <label key={c.id} className="modal-control select">
          <ControlCopy label={c.label} help={c.help} tip={c.tip} />
          <select
            disabled={busy || c.disabled}
            value={c.value ?? ""}
            aria-label={c.label}
            onChange={(e) => run({ ...c, value: e.target.value })}
          >
            {(c.options || []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      );
    }
    if (c.type === "toggle") {
      return (
        <label key={c.id} className="modal-control toggle">
          <input
            type="checkbox"
            checked={Boolean(c.value)}
            disabled={busy || c.disabled}
            aria-label={c.label}
            onChange={(e) => run({ ...c, value: e.target.checked })}
          />
          <ControlCopy label={c.label} help={c.help} tip={c.tip} />
        </label>
      );
    }
    return (
      <div key={c.id} className="modal-control action">
        <button
          type="button"
          className={`modal-action${c.danger ? " danger" : ""}${c.primary ? " primary" : ""}`}
          disabled={busy || c.disabled}
          title={c.tip || undefined}
          onClick={() => run(c)}
        >
          {c.label}
        </button>
        {c.help ? <span className="modal-control-help">{c.help}</span> : null}
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cw-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-top">
          <div>
            <p className="modal-kicker">Detail</p>
            <h3 id="cw-modal-title">{title}</h3>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {value != null && value !== "" && (
          <p className="modal-value">{value}</p>
        )}
        {body ? <p className="modal-body">{body}</p> : null}
        {rows?.length > 0 && (
          <dl className="modal-rows">
            {rows.map((r) => (
              <div key={r.label} className="modal-row">
                <dt>{r.label}</dt>
                <dd>{r.value ?? "—"}</dd>
              </div>
            ))}
          </dl>
        )}

        {groups.length > 0 && (
          <div className="modal-controls">
            <p className="modal-controls-label">Controls</p>
            <div className="modal-control-groups">
              {groups.map((g) => (
                <section key={g.key} className="modal-control-group">
                  {g.label ? (
                    <header className="modal-control-group-head">
                      <p className="modal-control-group-label">{g.label}</p>
                      {g.help ? (
                        <p className="modal-control-group-help">{g.help}</p>
                      ) : null}
                    </header>
                  ) : null}
                  <div className="modal-control-list">
                    {g.items.map((c) => renderControl(c))}
                  </div>
                </section>
              ))}
            </div>
            {msg ? <p className="modal-msg">{msg}</p> : null}
            <p className="modal-note">
              Salad may take a few seconds to apply chopping / preference changes.
              Job phase itself still comes from Bowl — we can pause or tune, not invent Running.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
