import { useEffect, useState } from "react";

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

        {controls?.length > 0 && (
          <div className="modal-controls">
            <p className="modal-controls-label">Controls</p>
            <div className="modal-control-list">
              {controls.map((c) => {
                if (c.type === "select") {
                  return (
                    <label key={c.id} className="modal-control select">
                      <span>{c.label}</span>
                      <select
                        disabled={busy || c.disabled}
                        value={c.value ?? ""}
                        onChange={(e) =>
                          run({ ...c, value: e.target.value })
                        }
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
                        onChange={(e) =>
                          run({ ...c, value: e.target.checked })
                        }
                      />
                      <span>{c.label}</span>
                    </label>
                  );
                }
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`modal-action${c.danger ? " danger" : ""}${c.primary ? " primary" : ""}`}
                    disabled={busy || c.disabled}
                    onClick={() => run(c)}
                  >
                    {c.label}
                  </button>
                );
              })}
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
