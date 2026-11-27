import { execFile } from "node:child_process";
import {
  readSettings,
  readRuntimeState,
  writeRuntimeState,
} from "./store.js";
import { writeAppFlags } from "./preferences.js";

const PAUSE_HOLD_MS = 8_000;
/** After a bail, ignore the same shortId briefly so stale Pulling logs don't thrash. */
const SAME_INSTANCE_SETTLE_MS = 3 * 60_000;
/**
 * Only re-roll the same Salad instance once. Dumping it repeatedly can waste
 * goodwill and often just gets the same large pull back.
 */
const MAX_SAME_INSTANCE_RETRIES = 1;
const SAME_INSTANCE_BLACKOUT_MS = 90 * 60_000;
/** ETA must improve by at least this fraction to count as "speeding up". */
const ETA_IMPROVE_FRAC = 0.12;

function toastWindows(title, body) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.Visible = $true
$n.BalloonTipTitle = ${JSON.stringify(title)}
$n.BalloonTipText = ${JSON.stringify(body)}
$n.BalloonTipIcon = 'Info'
$n.ShowBalloonTip(6000)
Start-Sleep -Milliseconds 6500
$n.Dispose()
`;
  execFile(
    "powershell.exe",
    ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script],
    { windowsHide: true },
    () => {},
  );
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function settingsNorm(settings = {}) {
  return {
    enabled: settings.downloadBailEnabled !== false,
    /** No auto-bail during warm-up — speed often ramps after the first minutes. */
    graceMinutes: num(settings.downloadBailGraceMinutes, 10),
    maxMinutes: num(settings.downloadBailMaxMinutes, 30),
    stallMinutes: num(settings.downloadBailStallMinutes, 10),
    maxEtaMinutes: num(settings.downloadBailMaxEtaMinutes, 45),
    /** ETA must stay over the cap this long before we bail (not one spike). */
    etaPersistMinutes: num(settings.downloadBailEtaPersistMinutes, 8),
    cooldownMinutes: num(settings.downloadBailCooldownMinutes, 25),
    windowsToastEnabled: settings.windowsToastEnabled !== false,
  };
}

const UNPAID_PHASES = new Set(["downloading", "initializing"]);

function isUnpaidPhase(phase) {
  return UNPAID_PHASES.has(phase);
}

/**
 * Track Bowl Pulling / Initializing progress + ETA trend.
 * Returns a patch for runtime state (may be empty).
 */
export function trackDownloadProgress(work, state, now, settings = {}) {
  const cfg = settingsNorm(settings);
  const maxEtaMs = cfg.maxEtaMinutes * 60_000;

  if (!isUnpaidPhase(work?.phase)) {
    const clear = {};
    if (state.downloadBailProgressShortId != null) {
      clear.downloadBailProgressShortId = null;
      clear.downloadBailProgressValue = null;
      clear.downloadBailProgressAt = null;
    }
    if (state.downloadBailEtaOverSince != null) {
      clear.downloadBailEtaOverSince = null;
      clear.downloadBailEtaOverShortId = null;
      clear.downloadBailLastEtaSec = null;
    }
    return clear;
  }

  const shortId = work.shortId || null;
  const progress =
    work.progress != null && Number.isFinite(Number(work.progress))
      ? Number(work.progress)
      : null;
  const etaSec =
    work?.pull?.etaSec != null && Number.isFinite(Number(work.pull.etaSec))
      ? Number(work.pull.etaSec)
      : null;

  const patch = {};

  if (shortId !== state.downloadBailProgressShortId) {
    patch.downloadBailProgressShortId = shortId;
    patch.downloadBailProgressValue = progress;
    patch.downloadBailProgressAt = now;
    patch.downloadBailEtaOverSince = null;
    patch.downloadBailEtaOverShortId = null;
    patch.downloadBailLastEtaSec = etaSec;
  } else {
    const prev = state.downloadBailProgressValue;
    if (progress != null && (prev == null || progress > prev + 0.001)) {
      patch.downloadBailProgressShortId = shortId;
      patch.downloadBailProgressValue = progress;
      patch.downloadBailProgressAt = now;
    } else if (state.downloadBailProgressAt == null) {
      patch.downloadBailProgressShortId = shortId;
      patch.downloadBailProgressValue = progress ?? prev;
      patch.downloadBailProgressAt = now;
    }

    // ETA trend: clear "over threshold" clock if ETA is improving or under cap.
    const lastEta = state.downloadBailLastEtaSec;
    const improving =
      etaSec != null &&
      lastEta != null &&
      etaSec < lastEta * (1 - ETA_IMPROVE_FRAC);
    const overCap = etaSec != null && etaSec * 1000 >= maxEtaMs;

    if (etaSec != null) patch.downloadBailLastEtaSec = etaSec;

    if (!overCap || improving) {
      if (
        state.downloadBailEtaOverSince != null ||
        state.downloadBailEtaOverShortId != null
      ) {
        patch.downloadBailEtaOverSince = null;
        patch.downloadBailEtaOverShortId = null;
      }
    } else if (overCap) {
      if (
        state.downloadBailEtaOverShortId !== shortId ||
        state.downloadBailEtaOverSince == null
      ) {
        patch.downloadBailEtaOverSince = now;
        patch.downloadBailEtaOverShortId = shortId;
      }
    }
  }

  return patch;
}

function retriesMap(state) {
  const m = state.downloadBailRetriesByShortId;
  return m && typeof m === "object" ? { ...m } : {};
}

function blackoutMap(state) {
  const m = state.downloadBailBlackoutUntil;
  return m && typeof m === "object" ? { ...m } : {};
}

function statusFields(cfg, state, nextEligibleAt, pendingResumeAt = null) {
  return {
    enabled: cfg.enabled,
    lastAt: state.downloadBailLastAt,
    lastShortId: state.downloadBailLastShortId,
    nextEligibleAt,
    graceMinutes: cfg.graceMinutes,
    maxMinutes: cfg.maxMinutes,
    stallMinutes: cfg.stallMinutes,
    maxEtaMinutes: cfg.maxEtaMinutes,
    etaPersistMinutes: cfg.etaPersistMinutes,
    cooldownMinutes: cfg.cooldownMinutes,
    pendingResumeAt,
  };
}

/**
 * Pure decision: should we start a bail?
 * @returns {{ action: 'none'|'pause'|'resume', reason: string|null, status: object }}
 */
export function evaluateDownloadBail(work, settings, state, now, opts = {}) {
  const cfg = settingsNorm(settings);
  const choppingPaused = opts.choppingPaused === true;
  const force = opts.force === true;
  const cooldownMs = cfg.cooldownMinutes * 60_000;
  const graceMs = cfg.graceMinutes * 60_000;
  const maxMs = cfg.maxMinutes * 60_000;
  const stallMs = cfg.stallMinutes * 60_000;
  const maxEtaMs = cfg.maxEtaMinutes * 60_000;
  const etaPersistMs = cfg.etaPersistMinutes * 60_000;

  const lastAt = state.downloadBailLastAt || null;
  const nextEligibleAt = lastAt != null ? lastAt + cooldownMs : null;
  const inCooldown = nextEligibleAt != null && now < nextEligibleAt;

  const pendingResumeAt = state.downloadBailPendingResumeAt || null;
  if (pendingResumeAt != null) {
    if (now >= pendingResumeAt) {
      return {
        action: "resume",
        reason: state.downloadBailLastReason || "pending_resume",
        status: {
          ...statusFields(cfg, state, nextEligibleAt, pendingResumeAt),
          status: "resuming",
          reason: state.downloadBailLastReason || "pending_resume",
        },
      };
    }
    return {
      action: "none",
      reason: null,
      status: {
        ...statusFields(cfg, state, nextEligibleAt, pendingResumeAt),
        status: "pausing",
        reason: state.downloadBailLastReason || "pausing",
      },
    };
  }

  const baseStatus = {
    ...statusFields(cfg, state, nextEligibleAt, null),
    status: "idle",
    reason: null,
  };

  if (!force && !cfg.enabled) {
    return {
      action: "none",
      reason: null,
      status: { ...baseStatus, status: "disabled" },
    };
  }

  if (!force && !isUnpaidPhase(work?.phase)) {
    return { action: "none", reason: null, status: baseStatus };
  }

  if (choppingPaused && !force) {
    return {
      action: "none",
      reason: null,
      status: { ...baseStatus, status: "watching", reason: "user_paused" },
    };
  }

  const shortId = work?.shortId || null;
  const retries = shortId ? num(retriesMap(state)[shortId], 0) : 0;
  const blackoutUntil = shortId ? num(blackoutMap(state)[shortId], 0) : 0;

  if (!force && shortId && blackoutUntil > now) {
    return {
      action: "none",
      reason: null,
      status: {
        ...baseStatus,
        status: "cooldown",
        reason: "same_instance_blackout",
        nextEligibleAt: blackoutUntil,
        retries,
      },
    };
  }

  const sameInstance = Boolean(
    shortId && state.downloadBailLastShortId === shortId && lastAt != null,
  );
  if (!force && sameInstance && now - lastAt < SAME_INSTANCE_SETTLE_MS) {
    return {
      action: "none",
      reason: null,
      status: {
        ...baseStatus,
        status: "cooldown",
        reason: "same_instance_settle",
        retries,
      },
    };
  }

  // Different job: respect general cooldown (avoid dumping many jobs).
  if (!force && inCooldown && !sameInstance) {
    return {
      action: "none",
      reason: null,
      status: { ...baseStatus, status: "cooldown", reason: "cooldown" },
    };
  }

  // Same job after one skip: blackout instead of endless re-rolls.
  if (
    !force &&
    sameInstance &&
    retries >= MAX_SAME_INSTANCE_RETRIES &&
    now - lastAt >= SAME_INSTANCE_SETTLE_MS
  ) {
    return {
      action: "none",
      reason: null,
      status: {
        ...baseStatus,
        status: "watching",
        reason: "accepted_after_reroll",
        retries,
      },
    };
  }

  const sessionAgeSec = num(work?.sessionAgeSec, 0);
  const sessionAgeMs = sessionAgeSec * 1000;
  const etaSec =
    work?.pull?.etaSec != null && Number.isFinite(Number(work.pull.etaSec))
      ? Number(work.pull.etaSec)
      : null;
  let reason = null;

  const initializing = work?.phase === "initializing";

  if (force) {
    reason = "manual";
  } else if (sessionAgeMs < graceMs) {
    // Warm-up: never auto-bail — downloads often speed up after a few minutes.
    reason = null;
  } else if (sessionAgeMs >= maxMs) {
    reason = `max_age_${cfg.maxMinutes}m`;
  } else if (initializing) {
    // Initializing has no pull ETA — only max age (above) or progress stall.
    const progressAt = state.downloadBailProgressAt;
    const stalled =
      progressAt != null &&
      now - progressAt >= stallMs &&
      state.downloadBailProgressShortId === shortId;
    if (stalled) {
      reason = `stall_${cfg.stallMinutes}m`;
    }
  } else {
    const etaOverSince =
      state.downloadBailEtaOverShortId === shortId
        ? state.downloadBailEtaOverSince
        : null;
    const etaPersistOk =
      etaSec != null &&
      etaSec * 1000 >= maxEtaMs &&
      etaOverSince != null &&
      now - etaOverSince >= etaPersistMs;
    if (etaPersistOk) {
      reason = `long_eta_${cfg.maxEtaMinutes}m`;
    } else {
      const progressAt = state.downloadBailProgressAt;
      const stalled =
        progressAt != null &&
        now - progressAt >= stallMs &&
        state.downloadBailProgressShortId === shortId;
      if (stalled) {
        reason = `stall_${cfg.stallMinutes}m`;
      }
    }
  }

  if (!reason) {
    const graceLeftSec = Math.max(0, Math.ceil((graceMs - sessionAgeMs) / 1000));
    const ageLeftSec = Math.max(0, Math.ceil((maxMs - sessionAgeMs) / 1000));
    const stallLeftSec =
      state.downloadBailProgressAt != null &&
      state.downloadBailProgressShortId === shortId
        ? Math.max(0, Math.ceil((stallMs - (now - state.downloadBailProgressAt)) / 1000))
        : cfg.stallMinutes * 60;
    const etaOverSince =
      state.downloadBailEtaOverShortId === shortId
        ? state.downloadBailEtaOverSince
        : null;
    const etaPersistLeftSec =
      etaOverSince != null
        ? Math.max(0, Math.ceil((etaPersistMs - (now - etaOverSince)) / 1000))
        : cfg.etaPersistMinutes * 60;
    return {
      action: "none",
      reason: null,
      status: {
        ...baseStatus,
        status: "watching",
        reason: sessionAgeMs < graceMs ? "grace" : null,
        graceLeftSec,
        ageLeftSec,
        stallLeftSec,
        etaPersistLeftSec,
        etaSec,
        retries,
      },
    };
  }

  return {
    action: "pause",
    reason,
    status: {
      ...baseStatus,
      status: "bailing",
      reason,
      lastAt: now,
      lastShortId: shortId,
      nextEligibleAt: now + cooldownMs,
      retries: retries + 1,
      etaSec,
    },
  };
}

/**
 * Apply one bail step (progress track + maybe pause/resume).
 * Injectable deps for tests.
 */
export function runDownloadBailStep(work, choppingPaused = false, deps = {}) {
  const getSettings = deps.readSettings || readSettings;
  const getState = deps.readRuntimeState || readRuntimeState;
  const setState = deps.writeRuntimeState || writeRuntimeState;
  const writeFlags = deps.writeAppFlags || writeAppFlags;
  const toast = deps.toastWindows || toastWindows;
  const now = deps.nowMs ?? Date.now();
  const force = deps.force === true;

  const settings = getSettings();
  const cfg = settingsNorm(settings);
  let state = getState();

  const progressPatch = trackDownloadProgress(work, state, now, settings);
  if (Object.keys(progressPatch).length) {
    state = setState(progressPatch);
  }

  const decision = evaluateDownloadBail(work, settings, state, now, {
    choppingPaused,
    force,
  });

  if (decision.action === "pause") {
    const shortId = work?.shortId || null;
    const retries = retriesMap(state);
    const blackouts = blackoutMap(state);
    const nextRetries = shortId ? num(retries[shortId], 0) + 1 : 0;
    if (shortId) {
      retries[shortId] = nextRetries;
      if (nextRetries >= MAX_SAME_INSTANCE_RETRIES) {
        blackouts[shortId] = now + SAME_INSTANCE_BLACKOUT_MS;
      }
    }

    writeFlags({ SALAD_CHOPPING_INDEFINITELY_PAUSED: true });
    state = setState({
      downloadBailLastAt: now,
      downloadBailLastShortId: shortId,
      downloadBailLastReason: decision.reason,
      downloadBailPendingResumeAt: now + PAUSE_HOLD_MS,
      downloadBailRetriesByShortId: retries,
      downloadBailBlackoutUntil: blackouts,
      downloadBailEtaOverSince: null,
      downloadBailEtaOverShortId: null,
    });

    if (cfg.windowsToastEnabled) {
      toast(
        "ChopWatch · Skip unpaid download",
        nextRetries >= MAX_SAME_INSTANCE_RETRIES
          ? "Skipped this pull once — if Salad reassigns it, ChopWatch will leave it alone for a while."
          : "Paused Salad to drop a persistently slow unpaid pull — resuming Finding Job shortly.",
      );
    }
    return {
      acted: true,
      action: "pause",
      reason: decision.reason,
      status: {
        ...decision.status,
        lastAt: now,
        lastShortId: shortId,
        pendingResumeAt: now + PAUSE_HOLD_MS,
        status: "pausing",
        retries: nextRetries,
      },
    };
  }

  if (decision.action === "resume") {
    writeFlags({ SALAD_CHOPPING_INDEFINITELY_PAUSED: false });
    state = setState({
      downloadBailPendingResumeAt: null,
      downloadBailProgressShortId: null,
      downloadBailProgressValue: null,
      downloadBailProgressAt: null,
    });
    if (cfg.windowsToastEnabled) {
      toast(
        "ChopWatch · Re-finding job",
        "Unpaid download skipped — Salad is looking for the next job.",
      );
    }
    return {
      acted: true,
      action: "resume",
      reason: decision.reason,
      status: {
        ...decision.status,
        pendingResumeAt: null,
        status: "idle",
        reason: decision.reason,
      },
    };
  }

  return {
    acted: false,
    action: "none",
    reason: null,
    status: decision.status,
  };
}

/** Build snapshot.downloadBail without side effects (except reading state). */
export function getDownloadBailStatus(work, choppingPaused = false, deps = {}) {
  const getSettings = deps.readSettings || readSettings;
  const getState = deps.readRuntimeState || readRuntimeState;
  const now = deps.nowMs ?? Date.now();
  const settings = getSettings();
  const state = getState();
  const { status } = evaluateDownloadBail(work, settings, state, now, {
    choppingPaused,
  });
  return status;
}

/** Manual skip: force pause→resume even if auto disabled / under threshold. */
export function manualDownloadBail(work, choppingPaused = false, deps = {}) {
  if (!isUnpaidPhase(work?.phase) && deps.forcePhaseCheck !== false) {
    return {
      ok: false,
      error: "not_unpaid",
      message:
        "Skip only applies while Salad is Downloading or Initializing (unpaid).",
      status: getDownloadBailStatus(work, choppingPaused, deps),
    };
  }
  const result = runDownloadBailStep(work, choppingPaused, {
    ...deps,
    force: true,
  });
  return {
    ok: result.acted || result.action === "resume",
    ...result,
  };
}

export {
  PAUSE_HOLD_MS,
  SAME_INSTANCE_SETTLE_MS,
  MAX_SAME_INSTANCE_RETRIES,
  SAME_INSTANCE_BLACKOUT_MS,
  ETA_IMPROVE_FRAC,
  UNPAID_PHASES,
  isUnpaidPhase,
  settingsNorm,
};
