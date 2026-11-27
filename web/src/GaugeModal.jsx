import { useEffect, useState } from "react";
import GaugeDial from "./GaugeDial.jsx";

const STAGE_GLOW = {
  lime: "rgba(182, 242, 109, 0.28)",
  cyan: "rgba(126, 200, 227, 0.28)",
  amber: "rgba(240, 195, 90, 0.26)",
  coral: "rgba(224, 122, 106, 0.26)",
  violet: "rgba(160, 140, 255, 0.26)",
  mint: "rgba(100, 220, 170, 0.26)",
};

export default function GaugeModal({
  open,
  title,
  body,
  rows,
  value,
  suffix = "%",
  hint,
  theme = "lime",
  max = 100,
  actions,
  onAction,
  onClose,
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
    if (!onAction || busy || action.disabled) return;
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
        className="modal-card gauge-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cw-gauge-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-top">
          <div>
            <p className="modal-kicker">Live gauge</p>
            <h3 id="cw-gauge-modal-title">{title}</h3>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div
          className="gauge-modal-stage"
          style={{ "--gauge-glow": STAGE_GLOW[theme] || STAGE_GLOW.lime }}
        >
          <GaugeDial
            label={title}
            value={value}
            suffix={suffix}
            hint={hint}
            theme={theme}
            max={max}
            size={236}
          />
        </div>

        {body ? <p className="modal-body gauge-modal-body">{body}</p> : null}

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

        {actions?.length ? (
          <div className="gauge-modal-actions">
            {actions.map((a) => (
              <button
                key={a.id || a.label}
                type="button"
                className={`modal-action${a.danger ? " danger" : ""}${a.primary ? " primary" : ""}`}
                disabled={busy || a.disabled}
                onClick={() => run(a)}
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : null}

        {msg ? <p className="modal-msg">{msg}</p> : null}

        <p className="modal-note gauge-modal-note">
          Values refresh with the live snapshot — the needle and arc ease to each new reading.
        </p>
      </div>
    </div>
  );
}
