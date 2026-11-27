import { useState } from "react";
import { setSaladFlags, skipSlowDownload } from "./api.js";

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

function SkipIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="chop-cmd-icon">
      <path
        fill="currentColor"
        d="M5.2 6.1c-.7-.4-1.5.1-1.5.9v10c0 .8.8 1.3 1.5.9l8.2-5c.7-.4.7-1.4 0-1.8l-8.2-5zM18.5 5.5h-2.2c-.4 0-.8.3-.8.8v11.4c0 .4.3.8.8.8h2.2c.4 0 .8-.3.8-.8V6.3c0-.4-.4-.8-.8-.8z"
      />
    </svg>
  );
}

function formatLeft(sec) {
  if (sec == null || !Number.isFinite(sec)) return null;
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function formatBytesShort(bytes) {
  if (bytes == null || !Number.isFinite(Number(bytes))) return null;
  const n = Number(bytes);
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 1 : 2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function pullSummary(pull) {
  if (!pull) return null;
  const bits = [];
  if (pull.bytesDone != null || pull.bytesTotal != null) {
    bits.push(
      `${formatBytesShort(pull.bytesDone) || "?"} / ${formatBytesShort(pull.bytesTotal) || "?"}`,
    );
  }
  if (pull.etaSec != null && Number.isFinite(pull.etaSec)) {
    bits.push(`~${formatLeft(pull.etaSec)} left`);
  }
  if (pull.bytesPerSec != null && Number.isFinite(pull.bytesPerSec)) {
    bits.push(`${formatBytesShort(pull.bytesPerSec)}/s`);
  }
  return bits.length ? bits.join(" · ") : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bailHint(downloadBail, phase, pull) {
  if (phase !== "downloading" && phase !== "initializing") return null;
  const summary = phase === "downloading" ? pullSummary(pull) : null;
  const unpaidLabel =
    phase === "initializing" ? "Initializing is unpaid" : "Unpaid until Running";

  if (downloadBail?.status === "pausing" || downloadBail?.status === "bailing") {
    return "Skipping unpaid work — pausing Salad, then resuming Finding Job…";
  }
  if (downloadBail?.status === "resuming") {
    return "Re-finding job after skip…";
  }
  if (downloadBail?.status === "disabled") {
    return summary
      ? `${summary} · Auto-bail off — use Skip to drop this unpaid pull.`
      : `Auto-bail off — use Skip to drop this unpaid ${phase === "initializing" ? "init" : "pull"}.`;
  }
  if (downloadBail?.status === "cooldown") {
    const why =
      downloadBail.reason === "same_instance_settle"
        ? "Settling after skip…"
        : downloadBail.reason === "same_instance_blackout"
          ? "Already re-rolled this pull once — leaving it alone for a while."
          : "Cooldown before next auto-bail (avoid dumping jobs).";
    return summary ? `${summary} · ${why}` : why;
  }
  if (downloadBail?.reason === "user_paused") {
    return summary
      ? `${summary} · Paused — Skip still re-rolls Finding Job.`
      : "Paused — Skip still re-rolls Finding Job.";
  }
  if (downloadBail?.enabled && downloadBail.status === "watching") {
    if (downloadBail.reason === "grace") {
      const g = formatLeft(downloadBail.graceLeftSec);
      const line = g
        ? `Warm-up (~${g}) — giving speed a chance to climb.`
        : "Warm-up — giving speed a chance to climb.";
      return summary ? `${summary} · ${line}` : `${unpaidLabel} · ${line}`;
    }
    if (downloadBail.reason === "accepted_after_reroll") {
      return summary
        ? `${summary} · Already re-rolled once — sticking with this pull.`
        : "Already re-rolled once — sticking with this pull.";
    }
    const age = formatLeft(downloadBail.ageLeftSec);
    const stall = formatLeft(downloadBail.stallLeftSec);
    const persist = formatLeft(downloadBail.etaPersistLeftSec);
    const auto = [
      age ? `~${age} max age` : null,
      phase === "downloading" && persist && downloadBail.maxEtaMinutes
        ? `ETA>${downloadBail.maxEtaMinutes}m for ~${persist}`
        : null,
      stall ? `~${stall} stall` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const line = auto
      ? `Patient auto-bail if still stuck (${auto}).`
      : `${unpaidLabel} — watching.`;
    return summary ? `${summary} · ${line}` : line;
  }
  return summary
    ? `${summary} · ${unpaidLabel} — Skip re-rolls Finding Job.`
    : `${unpaidLabel} — Skip drops this job and re-rolls Finding Job.`;
}

function modeMeta({ paused, phase, saladUp, bailBusy, pending }) {
  if (bailBusy) {
    return {
      id: "bailing",
      label: "Skipping unpaid work",
      blurb: "ChopWatch is pause→resume cycling Salad so it re-finds a job. Controls unlock when that finishes.",
      tone: "unpaid",
    };
  }
  if (pending === "pause") {
    return {
      id: "pendingPause",
      label: "Pausing…",
      blurb: "Writing Salad’s indefinite-pause flag — waiting for Bowl to reflect it.",
      tone: "paused",
    };
  }
  if (pending === "resume") {
    return {
      id: "pendingResume",
      label: "Resuming…",
      blurb: "Clearing indefinite pause — waiting for Salad to leave paused.",
      tone: "live",
    };
  }
  if (paused) {
    return {
      id: "pauseIndefinitely",
      label: "Paused indefinitely",
      blurb: "Salad won’t chop until you hit Chop Now. Auto-start stays off.",
      tone: "paused",
    };
  }
  if (phase === "downloading") {
    return {
      id: "unpaidDownload",
      label: "Unpaid download",
      blurb: "Pulling a job image — $0 until Running. Skip or auto-bail can re-roll Finding Job.",
      tone: "unpaid",
    };
  }
  if (phase === "initializing") {
    return {
      id: "unpaidInit",
      label: "Unpaid setup",
      blurb: "Initializing after pull — still unpaid. Skip re-rolls if it stalls.",
      tone: "unpaid",
    };
  }
  if (phase === "running") {
    return {
      id: "chopNow",
      label: "Chopping now",
      blurb: "Salad is earning on this job until you pause, or Auto-Stop kicks in.",
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
  downloadBail,
  pull,
  onUpdated,
}) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [msg, setMsg] = useState("");
  const unpaid = phase === "downloading" || phase === "initializing";
  const bailBusy =
    downloadBail?.status === "pausing" ||
    downloadBail?.status === "bailing" ||
    downloadBail?.status === "resuming";
  const mode = modeMeta({ paused, phase, saladUp, bailBusy, pending });
  const hint = bailHint(downloadBail, phase, pull);
  const choppingLive = mode.id === "chopNow";

  async function waitForPaused(wantPaused) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const next = await onUpdated?.();
      if (Boolean(next?.salad?.choppingPaused) === wantPaused) return true;
      await sleep(450);
    }
    return false;
  }

  async function setPaused(nextPaused) {
    if (busy || bailBusy) return;
    setBusy(true);
    setPending(nextPaused ? "pause" : "resume");
    setMsg("");
    try {
      await setSaladFlags({ SALAD_CHOPPING_INDEFINITELY_PAUSED: nextPaused });
      const ok = await waitForPaused(nextPaused);
      setMsg(
        nextPaused
          ? ok
            ? "Pause Indefinitely confirmed in Salad."
            : "Pause written — Salad may take a moment to show paused."
          : ok
            ? "Chop Now confirmed — indefinite pause cleared."
            : "Resume written — waiting for Salad to leave paused.",
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  async function onSkipDownload() {
    if (busy || bailBusy) return;
    setBusy(true);
    setMsg("");
    try {
      await skipSlowDownload();
      await onUpdated?.();
      setMsg("Skipping unpaid work — Salad will re-find a job.");
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
          {hint ? <p className="chop-command-bail">{hint}</p> : null}
          {msg ? <p className="chop-command-msg">{msg}</p> : null}
        </div>
      </div>

      <div className={`chop-command-actions${unpaid ? " with-skip" : ""}`}>
        <button
          type="button"
          className={`chop-cmd chop-cmd-go${choppingLive ? " active" : ""}`}
          disabled={busy || bailBusy || choppingLive || pending != null}
          aria-pressed={choppingLive}
          onClick={() => setPaused(false)}
        >
          <span className="chop-cmd-glyph">
            <PlayIcon />
          </span>
          <span className="chop-cmd-text">
            <span className="chop-cmd-title">Chop Now</span>
            <span className="chop-cmd-sub">
              {pending === "resume"
                ? "Confirming…"
                : choppingLive
                  ? "Currently earning"
                  : "Clear indefinite pause"}
            </span>
          </span>
        </button>

        <button
          type="button"
          className={`chop-cmd chop-cmd-stop${mode.id === "pauseIndefinitely" ? " active" : ""}`}
          disabled={busy || bailBusy || paused || pending != null}
          aria-pressed={paused}
          onClick={() => setPaused(true)}
        >
          <span className="chop-cmd-glyph">
            <PauseIcon />
          </span>
          <span className="chop-cmd-text">
            <span className="chop-cmd-title">Pause Indefinitely</span>
            <span className="chop-cmd-sub">
              {pending === "pause"
                ? "Confirming…"
                : paused
                  ? "Currently paused"
                  : "Stop until you resume"}
            </span>
          </span>
        </button>

        {unpaid ? (
          <button
            type="button"
            className={`chop-cmd chop-cmd-skip${bailBusy ? " active" : ""}`}
            disabled={busy || bailBusy}
            onClick={onSkipDownload}
          >
            <span className="chop-cmd-glyph">
              <SkipIcon />
            </span>
            <span className="chop-cmd-text">
              <span className="chop-cmd-title">
                {phase === "initializing" ? "Skip setup" : "Skip download"}
              </span>
              <span className="chop-cmd-sub">
                {bailBusy
                  ? "Re-rolling now…"
                  : "Drop unpaid work · find another job"}
              </span>
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
