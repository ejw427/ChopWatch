import { listBowlLogFiles, readRecentBowlText, parseTsAgeSec } from "./logTail.js";

const STATE_LABELS = {
  Pulling: { phase: "downloading", title: "Downloading Job" },
  InstallStarting: { phase: "initializing", title: "Initializing Job" },
  Starting: { phase: "initializing", title: "Initializing Job" },
  Running: { phase: "running", title: "Running Job" },
  Stopping: { phase: "stopping", title: "Stopping Job" },
  Stopped: { phase: "stopped", title: "Job Stopped" },
};

// Bowl stamps often include a zone offset: "2026-11-26 18:03:42.908 -07:00"
const TS = String.raw`(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+(?:\s+[+-]\d{2}:\d{2})?)`;

// Salad emits lifecycle on both SendStateChange and GetMetrics.
// Pulling: Name = Pulling - WLInstanceStatePulling(id - elapsed), Progress(0.35)
const STATE_PULL = new RegExp(
  `${TS}.*(?:SendStateChange|GetMetrics)\\(SourceId \\{ Id = (?<id>[^,]+), Name = (?<label>[A-Za-z]+) - WLInstanceState(?<state>[A-Za-z]+)\\((?<shortId>[a-f0-9]+) - (?<elapsed>[0-9:.]+)\\),\\s*Progress\\((?<progress>[0-9.]+)\\)`,
);

// Bracket form (Starting / Running / Stopping):
// Name = Running - WLInstanceStateRunning[id] - elapsed]
// Name = Starting - WLInstanceStateStarting[id][] - elapsed]
// Name = Starting - WLInstanceStateStarting[id][ProcessWLStatusEvent] - elapsed]
const STATE_BRACKET = new RegExp(
  `${TS}.*(?:SendStateChange|GetMetrics)\\(SourceId \\{ Id = (?<id>[^,]+), Name = (?<label>[A-Za-z]+) - WLInstanceState(?<state>[A-Za-z]+)\\[(?<shortId>[a-f0-9]+)\\](?:\\[[^\\]]*\\])?\\s*-\\s*(?<elapsed>[0-9:.]+)\\]`,
);

// Paren form without progress (Stopped / InstallStarting). May trail ", Stopped with Reason(...)".
// Name = Stopped - WLInstanceStateStopped(id - elapsed)
// Name = Installing - WLInstanceStateInstallStarting(id - elapsed)
const STATE_PAREN_NO_PROGRESS = new RegExp(
  `${TS}.*(?:SendStateChange|GetMetrics)\\(SourceId \\{ Id = (?<id>[^,]+), Name = (?<label>[A-Za-z]+) - WLInstanceState(?<state>[A-Za-z]+)\\((?<shortId>[a-f0-9]+) - (?<elapsed>[0-9:.]+)\\)(?:,\\s*Stopped with Reason\\((?<stopReason>[^)]*)\\))?`,
);

// Rich pull metrics (size / speed / ETA). Image path intentionally not captured.
// attempt / @speed / eta are optional so minor Salad wording drift still yields bytes+progress.
const PULL_PROGRESS = new RegExp(
  `${TS}.*Pull progress event: SpinnerPullProgressEvent\\((?<registryHost>registry-[a-z0-9-]+)\\.salad\\.com[^)]*\\)\\[(?<fullId>[a-f0-9-]+)\\]\\s*-\\s*(?<progress>[0-9.]+)\\s+(?<bytesDone>\\d+)\\/(?<bytesTotal>\\d+)B(?:\\s+attempt\\s+(?<attempt>\\d+)\\/(?<attemptMax>\\d+))?(?:\\s+@\\s+(?<bytesPerSec>\\d+)B\\/s)?(?:\\s+eta\\s+(?<etaSec>\\d+)s)?`,
  "i",
);

export function toEvent(groups, progress) {
  const state = groups.state;
  const meta = STATE_LABELS[state] || { phase: "unknown", title: state };
  const stopReason = groups.stopReason?.trim() || null;
  return {
    at: groups.ts,
    sourceId: groups.id,
    shortId: groups.shortId,
    state,
    label: groups.label,
    elapsed: groups.elapsed || null,
    progress: progress == null || !Number.isFinite(progress) ? null : progress,
    phase: meta.phase,
    title: meta.title,
    stopReason,
  };
}

export function parseStates(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("WLInstanceState")) continue;
    // Skip nested duration metadata (Prev[…] WLInstanceStateDuration {…}).
    if (line.includes("WLInstanceStateDuration")) continue;
    if (!line.includes("SendStateChange") && !line.includes("GetMetrics")) continue;

    let m = line.match(STATE_PULL);
    if (m?.groups) {
      events.push(toEvent(m.groups, Number(m.groups.progress)));
      continue;
    }
    m = line.match(STATE_BRACKET);
    if (m?.groups) {
      events.push(toEvent(m.groups, null));
      continue;
    }
    m = line.match(STATE_PAREN_NO_PROGRESS);
    if (m?.groups) {
      events.push(toEvent(m.groups, null));
    }
  }
  return events;
}

/** Parse SpinnerPullProgressEvent lines (bytes, speed, ETA). No image digests. */
export function parsePullProgress(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("Pull progress event")) continue;
    if (!line.includes("SpinnerPullProgressEvent")) continue;
    const m = line.match(PULL_PROGRESS);
    if (!m?.groups) continue;
    const g = m.groups;
    const fullId = g.fullId;
    const shortId = fullId.includes("-") ? fullId.split("-")[0] : fullId.slice(0, 8);
    const progress = Number(g.progress);
    const bytesDone = Number(g.bytesDone);
    const bytesTotal = Number(g.bytesTotal);
    const bytesPerSec = Number(g.bytesPerSec);
    const etaSec = Number(g.etaSec);
    const attempt = Number(g.attempt);
    const attemptMax = Number(g.attemptMax);
    events.push({
      at: g.ts,
      shortId,
      progress: Number.isFinite(progress) ? progress : null,
      bytesDone: Number.isFinite(bytesDone) ? bytesDone : null,
      bytesTotal: Number.isFinite(bytesTotal) ? bytesTotal : null,
      bytesPerSec: Number.isFinite(bytesPerSec) ? bytesPerSec : null,
      etaSec: Number.isFinite(etaSec) ? etaSec : null,
      attempt: Number.isFinite(attempt) ? attempt : null,
      attemptMax: Number.isFinite(attemptMax) ? attemptMax : null,
      registryHost: g.registryHost || null,
    });
  }
  return events;
}

export function latestPullForShortId(pullEvents, shortId) {
  if (!pullEvents?.length) return null;
  if (!shortId) return pullEvents[pullEvents.length - 1] || null;
  for (let i = pullEvents.length - 1; i >= 0; i--) {
    if (pullEvents[i].shortId === shortId) return pullEvents[i];
  }
  return null;
}

export function inferFinding(processesRunning, lastEvent, ageSec, paused) {
  if (!processesRunning) {
    return {
      phase: "offline",
      title: "Salad Not Running",
      detail: "No Salad processes detected.",
    };
  }
  if (paused) {
    return {
      phase: "paused",
      title: "Chopping Paused",
      detail: "App flag SALAD_CHOPPING_INDEFINITELY_PAUSED is set.",
    };
  }
  if (!lastEvent) {
    return {
      phase: "finding",
      title: "Finding Job",
      detail: "Bowl is up; no recent workload state in logs yet.",
    };
  }
  if (lastEvent.state === "Stopped" && ageSec > 20) {
    return {
      phase: "finding",
      title: "Finding Job",
      detail: "Last job stopped; waiting for the next match.",
    };
  }
  // Running often logs once via GetMetrics then stays quiet — keep it sticky.
  // Pulling/Starting/InstallStarting can also go quiet, but not forever:
  // after a long silence they are usually stale (missed Running behind log spam).
  if (ageSec > 300 && lastEvent.state === "Running") {
    return null;
  }
  if (
    ageSec > 600 &&
    (lastEvent.state === "Pulling" ||
      lastEvent.state === "Starting" ||
      lastEvent.state === "InstallStarting")
  ) {
    return {
      phase: "finding",
      title: "Finding Job",
      detail: "Last download/start update went quiet; waiting for a fresh state.",
    };
  }
  if (
    ageSec > 300 &&
    lastEvent.state !== "Running" &&
    lastEvent.state !== "Pulling" &&
    lastEvent.state !== "Starting" &&
    lastEvent.state !== "InstallStarting"
  ) {
    return {
      phase: "finding",
      title: "Finding Job",
      detail: "No fresh state changes recently.",
    };
  }
  return null;
}

export function buildSessions(events) {
  const sessions = [];
  let cur = null;
  for (const e of events) {
    if (!cur || cur.shortId !== e.shortId) {
      if (cur) sessions.push(cur);
      cur = {
        shortId: e.shortId,
        startedAt: e.at,
        runningAt: e.state === "Running" ? e.at : null,
        endedAt: null,
        lastState: e.state,
        lastTitle: e.title,
        peakProgress: e.progress,
        sawRunning: e.state === "Running",
        sawPulling: e.state === "Pulling",
      };
      continue;
    }
    cur.lastState = e.state;
    cur.lastTitle = e.title;
    if (e.progress != null) {
      cur.peakProgress =
        cur.peakProgress == null
          ? e.progress
          : Math.max(cur.peakProgress, e.progress);
    }
    if (e.state === "Running") {
      cur.sawRunning = true;
      if (!cur.runningAt) cur.runningAt = e.at;
    }
    if (e.state === "Pulling") cur.sawPulling = true;
    if (e.state === "Stopped" || e.state === "Stopping") cur.endedAt = e.at;
  }
  if (cur) sessions.push(cur);
  return sessions.slice(-8).reverse();
}

function enrichCurrent(base, sessions) {
  const session =
    (base.shortId && sessions.find((s) => s.shortId === base.shortId)) ||
    sessions[0] ||
    null;
  const sessionAgeSec = session?.startedAt
    ? parseTsAgeSec(session.startedAt)
    : null;
  const runningForSec = session?.runningAt
    ? parseTsAgeSec(session.runningAt)
    : null;
  return {
    ...base,
    sessionStartedAt: session?.startedAt ?? null,
    sessionAgeSec,
    runningSinceAt: session?.runningAt ?? null,
    runningForSec,
  };
}

function pullAgeSec(pull) {
  if (!pull?.at) return null;
  return parseTsAgeSec(pull.at);
}

export function readWorkloadStatus(processesRunning, paused = false) {
  // Newest log can be huge with HTTP noise; prefer reading it nearly whole so a
  // single Running GetMetrics isn't missed behind Pulling / probe spam.
  const { files, text } = readRecentBowlText(3, 2_000_000, {
    fullFileMaxBytes: 16_000_000,
  });
  const events = parseStates(text).sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : 0,
  );
  const pullEvents = parsePullProgress(text).sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : 0,
  );
  const sessions = buildSessions(events);

  const last = events.length ? events[events.length - 1] : null;
  const ageSec = last ? parseTsAgeSec(last.at) : null;
  const finding = inferFinding(
    processesRunning,
    last,
    ageSec ?? Infinity,
    paused,
  );

  const current = enrichCurrent(
    finding
      ? {
          ...finding,
          progress: null,
          elapsed: null,
          shortId: last?.shortId ?? null,
          state: last?.state ?? null,
          at: last?.at ?? null,
          ageSec,
          pull: null,
        }
      : {
          phase: last.phase,
          title: last.title,
          detail: `State ${last.state} for instance ${last.shortId}`,
          progress: Number.isFinite(last.progress) ? last.progress : null,
          elapsed: last.elapsed,
          shortId: last.shortId,
          state: last.state,
          at: last.at,
          ageSec,
          pull: null,
        },
    sessions,
  );

  if (current.phase === "downloading") {
    const pull = latestPullForShortId(pullEvents, current.shortId);
    if (pull) {
      current.pull = {
        ...pull,
        ageSec: pullAgeSec(pull),
      };
      if (current.progress == null && pull.progress != null) {
        current.progress = pull.progress;
      }
    }
  }

  return {
    current,
    timeline: events
      .slice(-14)
      .reverse()
      .map((e) => ({
        at: e.at,
        title: e.title,
        state: e.state,
        progress: e.progress,
        shortId: e.shortId,
        elapsed: e.elapsed,
      })),
    sessions,
    logFiles: files.map((f) => ({
      name: f.name,
      sizeBytes: f.size,
      mtimeMs: f.mtimeMs,
    })),
    note: "Instance IDs are Salad lifecycle tokens, not customer job names. Running often arrives via GetMetrics. Pull size/speed/ETA come from SpinnerPullProgressEvent (no image digests). Timestamps keep Salad's zone offset when present.",
  };
}

export { listBowlLogFiles, STATE_LABELS, PULL_PROGRESS, TS };
