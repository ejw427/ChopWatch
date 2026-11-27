import { listBowlLogFiles, readRecentBowlText, parseTsAgeSec } from "./logTail.js";

const STATE_LABELS = {
  Pulling: { phase: "downloading", title: "Downloading Job" },
  InstallStarting: { phase: "initializing", title: "Initializing Job" },
  Starting: { phase: "initializing", title: "Initializing Job" },
  Running: { phase: "running", title: "Running Job" },
  Stopping: { phase: "stopping", title: "Stopping Job" },
  Stopped: { phase: "stopped", title: "Job Stopped" },
};

// Salad emits lifecycle on both SendStateChange and GetMetrics.
// Pulling: Name = Pulling - WLInstanceStatePulling(id - elapsed), Progress(0.35)
const STATE_PULL =
  /(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+).*(?:SendStateChange|GetMetrics)\(SourceId \{ Id = (?<id>[^,]+), Name = (?<label>[A-Za-z]+) - WLInstanceState(?<state>[A-Za-z]+)\((?<shortId>[a-f0-9]+) - (?<elapsed>[0-9:.]+)\),\s*Progress\((?<progress>[0-9.]+)\)/;

// Bracket form (Starting / Running / Stopping):
// Name = Running - WLInstanceStateRunning[id] - elapsed]
// Name = Starting - WLInstanceStateStarting[id][ProcessWLStatusEvent] - elapsed]
const STATE_BRACKET =
  /(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+).*(?:SendStateChange|GetMetrics)\(SourceId \{ Id = (?<id>[^,]+), Name = (?<label>[A-Za-z]+) - WLInstanceState(?<state>[A-Za-z]+)\[(?<shortId>[a-f0-9]+)\](?:\[[^\]]*\])?\s*-\s*(?<elapsed>[0-9:.]+)\]/;

// Paren form without progress (Stopped / InstallStarting):
// Name = Stopped - WLInstanceStateStopped(id - elapsed)
// Name = Installing - WLInstanceStateInstallStarting(id - elapsed)
const STATE_PAREN_NO_PROGRESS =
  /(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+).*(?:SendStateChange|GetMetrics)\(SourceId \{ Id = (?<id>[^,]+), Name = (?<label>[A-Za-z]+) - WLInstanceState(?<state>[A-Za-z]+)\((?<shortId>[a-f0-9]+) - (?<elapsed>[0-9:.]+)\)/;

export function toEvent(groups, progress) {
  const state = groups.state;
  const meta = STATE_LABELS[state] || { phase: "unknown", title: state };
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
  };
}

export function parseStates(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("WLInstanceState")) continue;
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
  if (
    ageSec > 300 &&
    lastEvent.state !== "Running" &&
    lastEvent.state !== "Pulling" &&
    lastEvent.state !== "Starting"
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
    if (e.state === "Running") cur.sawRunning = true;
    if (e.state === "Pulling") cur.sawPulling = true;
    if (e.state === "Stopped" || e.state === "Stopping") cur.endedAt = e.at;
  }
  if (cur) sessions.push(cur);
  return sessions.slice(-8).reverse();
}

export function readWorkloadStatus(processesRunning, paused = false) {
  // Larger tail so a single Running GetMetrics isn't missed behind Pulling spam.
  const { files, text } = readRecentBowlText(2, 1_500_000);
  const events = parseStates(text).sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : 0,
  );

  const last = events.length ? events[events.length - 1] : null;
  const ageSec = last ? parseTsAgeSec(last.at) : null;
  const finding = inferFinding(
    processesRunning,
    last,
    ageSec ?? Infinity,
    paused,
  );

  const current = finding
    ? {
        ...finding,
        progress: null,
        elapsed: null,
        shortId: last?.shortId ?? null,
        state: last?.state ?? null,
        at: last?.at ?? null,
        ageSec,
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
      };

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
    sessions: buildSessions(events),
    logFiles: files.map((f) => ({
      name: f.name,
      sizeBytes: f.size,
      mtimeMs: f.mtimeMs,
    })),
    note: "Instance IDs are Salad lifecycle tokens, not customer job names. Running often arrives via GetMetrics.",
  };
}

export { listBowlLogFiles, STATE_LABELS };
