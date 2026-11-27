import { useState } from "react";
import { setSaladFlags } from "./api.js";

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="chop-cmd-icon">
      <path
        fill="currentColor"
        d="M8.2 5.4c-.7-.4-1.5.1-1.5.9v11.4c0 .8.8 1.3 1.5.9l10.2-5.7c.7-.4.7-1.4 0-1.8L8.2 5.4z"
      />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="chop-cmd-icon">
      <rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor" />
      <rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor" />
    </svg>
  );
}

function modeMeta({ paused, phase, saladUp }) {
  if (paused) {
    return {
      id: "pauseIndefinitely",
      label: "Paused indefinitely",
      blurb: "Salad won’t chop until you hit Chop Now. Auto-start stays off.",
      tone: "paused",
    };
  }
  if (phase === "running" || phase === "downloading" || phase === "initializing") {
    return {
      id: "chopNow",
      label: "Chopping now",
      blurb: "Salad is taking work until you pause, or Auto-Stop kicks in.",
      tone: "live",
    };
  }
  if (!saladUp) {
    return {
      id: "offline",
      label: "Salad offline",
      blurb: "Bowl/Salad isn’t running locally. Start Salad, then use these controls.",
      tone: "offline",
    };
  }
  return {
    id: "standby",
    label: "Standing by",
    blurb: "Not indefinitely paused. Salad may wait for idle / a job — use Chop Now to push start.",
    tone: "standby",
  };
}

export default function ChopCommandBar({
  paused,
  phase,
  saladUp,
  onUpdated,
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const mode = modeMeta({ paused, phase, saladUp });

  async function setPaused(nextPaused) {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await setSaladFlags({ SALAD_CHOPPING_INDEFINITELY_PAUSED: nextPaused });
      await onUpdated?.();
      setMsg(
        nextPaused
          ? "Pause Indefinitely written to Salad."
          : "Chop Now — indefinite pause cleared.",
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`chop-command tone-${mode.tone}`} role="region" aria-label="Chopping controls">
      <div className="chop-command-status">
        <span className="chop-command-pulse" aria-hidden="true" />
        <div className="chop-command-copy">
          <p className="chop-command-kicker">Salad run state</p>
          <p className="chop-command-mode">{mode.label}</p>
          <p className="chop-command-blurb">{mode.blurb}</p>
          {msg ? <p className="chop-command-msg">{msg}</p> : null}
        </div>
      </div>

      <div className="chop-command-actions">
        <button
          type="button"
          className={`chop-cmd chop-cmd-go${mode.id === "chopNow" ? " active" : ""}`}
          disabled={busy || mode.id === "chopNow"}
          aria-pressed={mode.id === "chopNow"}
          onClick={() => setPaused(false)}
        >
          <span className="chop-cmd-glyph">
            <PlayIcon />
          </span>
          <span className="chop-cmd-text">
            <span className="chop-cmd-title">Chop Now</span>
            <span className="chop-cmd-sub">
              {mode.id === "chopNow" ? "Currently chopping" : "Clear indefinite pause"}
            </span>
          </span>
        </button>

        <button
          type="button"
          className={`chop-cmd chop-cmd-stop${mode.id === "pauseIndefinitely" ? " active" : ""}`}
          disabled={busy || paused}
          aria-pressed={paused}
          onClick={() => setPaused(true)}
        >
          <span className="chop-cmd-glyph">
            <PauseIcon />
          </span>
          <span className="chop-cmd-text">
            <span className="chop-cmd-title">Pause Indefinitely</span>
            <span className="chop-cmd-sub">
              {paused ? "Currently paused" : "Stop until you resume"}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
