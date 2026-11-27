import { useEffect, useMemo, useState } from "react";
import HoursChart from "../HoursChart.jsx";
import GaugeDial from "../GaugeDial.jsx";
import GaugeModal from "../GaugeModal.jsx";
import Sparkline from "../Sparkline.jsx";
import DetailModal from "../DetailModal.jsx";
import InfoTip from "../InfoTip.jsx";
import ChopCommandBar from "../ChopCommandBar.jsx";
import {
  formatBytePair,
  formatBytesPerSec,
  formatDuration,
  formatGiBFromMiB,
  formatMemPairFromMiB,
  formatMemPairFromMb,
  formatMoney,
  formatProcMemory,
  formatStamp,
  formatTempC,
  formatWatts,
  moneyPerHourFromDaily,
  predictedDailyRate,
} from "../format.js";
import {
  fetchSnapshot,
  saveSettings,
  setSaladFlags,
  setSaladPreferences,
  refreshSaladAccount,
} from "../api.js";

const LEVELS = ["Low", "Medium", "High", "Off"];

const PROCESS_INFO = {
  salad: {
    image: "Salad.exe",
    body:
      "The main Salad desktop app — the window you sign into and use for balance, settings, and chopping controls. ChopWatch treats this as the front-end. If Salad is OFF while Bowl is ON, the workload engine may still be running in the background.",
  },
  bowl: {
    image: "Salad.Bowl.Service.exe",
    body:
      "Bowl is Salad’s local workload engine. It talks to Salad’s cloud, pulls job images, starts and stops container workloads, and writes the logs ChopWatch reads for phase (Finding work, Downloading, Running, and so on). When Bowl is OFF, ChopWatch usually cannot see a live job.",
  },
  bootstrapper: {
    image: "Salad.Bootstrapper.exe",
    body:
      "A short-lived helper Salad uses to install, update, or launch other Salad components. Seeing it ON briefly during startup or updates is normal — it does not run paid workloads itself.",
  },
};

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

function tempTone(tempC) {
  if (tempC == null || !Number.isFinite(Number(tempC))) return undefined;
  const t = Number(tempC);
  if (t >= 90) return "bad";
  if (t >= 80) return "warn";
  return "ok";
}

function bailTone(status) {
  if (!status || status.status === "disabled" || status.status === "idle") return undefined;
  if (status.status === "watching") return "ok";
  if (
    status.status === "cooldown" ||
    status.status === "pausing" ||
    status.status === "bailing" ||
    status.status === "resuming"
  ) {
    return "warn";
  }
  return undefined;
}

function bailLabel(status) {
  if (!status || status.enabled === false || status.status === "disabled") return "off";
  const s = status.status || "idle";
  if (s === "watching" && status.reason === "grace") return "grace";
  if (s === "watching" && status.reason === "user_paused") return "paused";
  return s;
}

function formatSessionEarned(earned) {
  if (earned == null || !Number.isFinite(Number(earned))) return "—";
  const n = Number(earned);
  if (n > 0) return `+${formatMoney(n)}`;
  return formatMoney(Math.max(0, n));
}

function pct(progress) {
  if (progress == null || !Number.isFinite(progress)) return null;
  return Math.max(0, Math.min(100, Math.round(progress * 100)));
}

function pickBalance(balance) {
  if (!balance || typeof balance !== "object") return null;
  if (typeof balance.currentBalance === "number") return balance.currentBalance;
  if (typeof balance.balance === "number") return balance.balance;
  if (typeof balance.current === "number") return balance.current;
  return null;
}

function Fact({ label, value, tone, onOpen }) {
  return (
    <button
      type="button"
      className={`work-fact${tone ? ` tone-${tone}` : ""}`}
      onClick={onOpen}
    >
      <span className="work-fact-label">{label}</span>
      <span className="work-fact-value">{value ?? "—"}</span>
    </button>
  );
}

export default function OverviewTab({ snap, setSnap }) {
  const [modalId, setModalId] = useState(null);
  const [procKey, setProcKey] = useState(null);
  const [gaugeId, setGaugeId] = useState(null);
  const work = snap?.work;
  const progress = pct(work?.progress ?? work?.pull?.progress);
  const pull = work?.pull || null;
  const downloading = work?.phase === "downloading";
  const gpu0 = snap?.gpu?.gpus?.[0];
  const wallet = snap?.wallet;
  const predictedDay = predictedDailyRate(wallet?.predicted);
  const predictedHour = moneyPerHourFromDaily(predictedDay);
  const hours = snap?.chopHours;
  const prefs = snap?.preferences || {};
  const flags = snap?.appFlags || {};
  const settings = snap?.settings || {};
  const paused = snap?.salad?.choppingPaused === true;
  const apiBalance = pickBalance(snap?.saladAccount?.balance);
  const memUsed = gpu0?.memUsedMiB;
  const memTotal = gpu0?.memTotalMiB;
  const gpuMemHint =
    memUsed != null && memTotal != null
      ? formatMemPairFromMiB(memUsed, memTotal)
      : null;
  const memBusy =
    gpu0?.memControllerBusyPct != null
      ? `bus ${Math.round(gpu0.memControllerBusyPct)}%`
      : null;
  const session = (snap?.sessions || []).find((s) => s.shortId === work?.shortId);
  const saladUp = snap?.processes?.running;
  const hbFresh =
    snap?.heartbeat?.ageSec != null && snap.heartbeat.ageSec < 120;
  const runningFor =
    work?.runningForSec != null
      ? work.runningForSec
      : work?.phase === "running"
        ? work?.sessionAgeSec
        : null;
  const sessionFor =
    work?.sessionAgeSec != null ? work.sessionAgeSec : work?.ageSec;

  const chopControls = useMemo(
    () => [
      paused
        ? {
            id: "resume",
            type: "button",
            primary: true,
            label: "Chop Now",
            help: "Same as Salad’s Chop Now — clears indefinite pause so Salad can take work again.",
            group: "chopping",
            groupLabel: "Chopping",
            groupHelp:
              "Writes Salad’s indefinite-pause flag. Pause Until Idle / Set Time aren’t controllable from ChopWatch.",
            kind: "flag",
            key: "SALAD_CHOPPING_INDEFINITELY_PAUSED",
            value: false,
          }
        : {
            id: "pause",
            type: "button",
            danger: true,
            label: "Pause Indefinitely",
            help: "Same as Salad’s Pause Indefinitely — Salad won’t chop until you Chop Now.",
            group: "chopping",
            groupLabel: "Chopping",
            groupHelp:
              "Writes Salad’s indefinite-pause flag. Pause Until Idle / Set Time aren’t controllable from ChopWatch.",
            kind: "flag",
            key: "SALAD_CHOPPING_INDEFINITELY_PAUSED",
            value: true,
          },
      {
        id: "autoLaunch",
        type: "toggle",
        label: "Salad auto-launch",
        help: "Open the Salad app when you sign into Windows.",
        group: "chopping",
        groupLabel: "Chopping",
        kind: "flag",
        key: "SALAD_AUTO_LAUNCH",
        value: flags.SALAD_AUTO_LAUNCH === true,
      },
      {
        id: "overlay",
        type: "toggle",
        label: "Salad overlay",
        help: "Show Salad’s on-screen overlay while chopping.",
        group: "chopping",
        groupLabel: "Chopping",
        kind: "flag",
        key: "SALAD_OVERLAY_ENABLED",
        value: flags.SALAD_OVERLAY_ENABLED === true,
      },
    ],
    [paused, flags.SALAD_AUTO_LAUNCH, flags.SALAD_OVERLAY_ENABLED],
  );

  const workloadControls = useMemo(
    () => [
      {
        id: "activeGpu",
        type: "select",
        label: "Active GPU",
        help: "How hard Salad may use the GPU while you’re at the keyboard.",
        tip: "Active = mouse/keyboard activity recently. Does not change download speed or VRAM display.",
        group: "intensity",
        groupLabel: "Resource limits",
        groupHelp:
          "Active = you’re using the PC. Idle = machine is away. Low → High = more aggressive. Off = don’t use that hardware in that state. These write Salad preferences.txt — not download speed.",
        kind: "pref",
        key: "active/gpu",
        value: prefs["active/gpu"] || "Low",
        options: LEVELS,
      },
      {
        id: "idleGpu",
        type: "select",
        label: "Idle GPU",
        help: "How hard Salad may use the GPU when the PC is idle.",
        tip: "Typical setup: Idle High, Active Low — push hard when away, stay light while you’re here.",
        group: "intensity",
        groupLabel: "Resource limits",
        kind: "pref",
        key: "idle/gpu",
        value: prefs["idle/gpu"] || "High",
        options: LEVELS,
      },
      {
        id: "activeCpu",
        type: "select",
        label: "Active CPU",
        help: "How hard Salad may use the CPU while you’re using the PC.",
        tip: "Off blocks CPU-only jobs while you’re active. Same Low → High scale as GPU.",
        group: "intensity",
        groupLabel: "Resource limits",
        kind: "pref",
        key: "active/cpu",
        value: prefs["active/cpu"] || "Low",
        options: LEVELS,
      },
      {
        id: "idleCpu",
        type: "select",
        label: "Idle CPU",
        help: "How hard Salad may use the CPU when the PC is idle.",
        tip: "Off disables CPU jobs while idle. Enable both GPU and CPU when idle for more job types.",
        group: "intensity",
        groupLabel: "Resource limits",
        kind: "pref",
        key: "idle/cpu",
        value: prefs["idle/cpu"] || "High",
        options: LEVELS,
      },
      {
        id: "miningGpu",
        type: "toggle",
        label: "Mining GPU workloads",
        help: "Allow Salad crypto-mining jobs (usually a low-pay backup when no container job is available).",
        group: "jobs",
        groupLabel: "Job types",
        groupHelp: "Opt in or out of Salad workload categories this machine will accept.",
        kind: "pref",
        key: "mining/gpu",
        value: String(prefs["mining/gpu"]).toLowerCase() === "true",
      },
      {
        id: "containers",
        type: "toggle",
        label: "Container workloads",
        help: "Allow Salad container jobs — the main paid GPU/CPU workloads.",
        group: "jobs",
        groupLabel: "Job types",
        kind: "pref",
        key: "containers",
        value: String(prefs.containers).toLowerCase() === "true",
      },
    ],
    [prefs],
  );

  // Full catalog kept for modal deep-dives; hero only shows a short strip.
  const facts = useMemo(() => {
    const peakPull =
      session?.peakProgress != null
        ? `${Math.round(session.peakProgress * 100)}%`
        : progress != null
          ? `${progress}%`
          : "—";
    const pullSize =
      pull?.bytesDone != null || pull?.bytesTotal != null
        ? formatBytePair(pull.bytesDone, pull.bytesTotal)
        : null;
    const pullEta =
      pull?.etaSec != null ? formatDuration(pull.etaSec) : null;
    const pullSpeed =
      pull?.bytesPerSec != null ? formatBytesPerSec(pull.bytesPerSec) : null;

    return [
      ...(downloading
        ? [
            {
              id: "downloadInfo",
              label: "Download",
              value:
                [
                  progress != null ? `${progress}%` : null,
                  pullSize,
                  pullEta ? `~${pullEta}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "pulling…",
              tone: "ok",
              body:
                "Live container image pull from Bowl SpinnerPullProgressEvent lines: percent, bytes done/total, Salad’s ETA, and transfer rate. Image digests and customer workload IDs are not shown. Downloads are unpaid until Running.",
              rows: [
                {
                  label: "Progress",
                  value: progress != null ? `${progress}%` : "—",
                },
                { label: "Size", value: pullSize || "—" },
                { label: "ETA", value: pullEta ? `~${pullEta}` : "—" },
                { label: "Speed", value: pullSpeed || "—" },
                {
                  label: "Attempt",
                  value:
                    pull?.attempt != null && pull?.attemptMax != null
                      ? `${pull.attempt}/${pull.attemptMax}`
                      : "—",
                },
                {
                  label: "Registry",
                  value: pull?.registryHost || "—",
                },
                {
                  label: "Bowl elapsed",
                  value: work?.elapsed || "—",
                },
                {
                  label: "Pull log age",
                  value:
                    pull?.ageSec != null ? formatAge(pull.ageSec) : "—",
                },
                {
                  label: "Auto-bail",
                  value: snap?.downloadBail?.enabled
                    ? snap.downloadBail.status || "on"
                    : "off",
                },
                { label: "Peak pull", value: peakPull },
              ],
              controls: chopControls,
            },
          ]
        : []),
      {
        id: "phase",
        label: "Phase",
        value: work?.phase || "—",
        tone: phaseDot(work?.phase) || undefined,
        body: "ChopWatch’s high-level job phase from Bowl logs. You can’t invent Running here — pause/resume chopping via Salad’s own flag.",
        rows: [
          { label: "Title", value: work?.title },
          { label: "Detail", value: work?.detail },
          { label: "Chopping paused", value: paused ? "yes" : "no" },
        ],
        controls: chopControls,
      },
      {
        id: "state",
        label: "Bowl state",
        value: work?.state || "—",
        body: "Raw Salad Bowl WLInstanceState. Pause chopping if you want Salad to stop taking work.",
        rows: [
          { label: "Mapped phase", value: work?.phase },
          { label: "Last log", value: formatStamp(work?.at) },
        ],
        controls: chopControls,
      },
      {
        id: "instance",
        label: "Instance",
        value: work?.shortId || "—",
        body: "Short Salad lifecycle instance id. This is a host token, not a customer job name.",
        rows: [
          { label: "Full short id", value: work?.shortId },
          { label: "Title", value: work?.title },
          { label: "Detail", value: work?.detail },
        ],
        controls: chopControls,
      },
      {
        id: "runningFor",
        label: "Running for",
        value: runningFor != null ? formatDuration(runningFor) : "—",
        tone: work?.phase === "running" ? "ok" : undefined,
        body: "Time since the first Running event for this instance. Pause chopping to stop Salad from continuing work.",
        rows: [
          { label: "Running since", value: formatStamp(work?.runningSinceAt) },
          { label: "Seconds", value: runningFor != null ? Math.round(runningFor) : "—" },
        ],
        controls: chopControls,
      },
      {
        id: "sessionAge",
        label: "Session age",
        value: formatDuration(sessionFor),
        body: "Time since this instance first appeared, including download and start.",
        rows: [
          {
            label: "Session started",
            value: formatStamp(work?.sessionStartedAt || session?.startedAt),
          },
          { label: "Ended", value: formatStamp(session?.endedAt) },
        ],
        controls: chopControls,
      },
      {
        id: "logAge",
        label: "Log age",
        value: formatAge(work?.ageSec),
        body: "How long ago that lifecycle line was written. Running often stays quiet after the first Running line.",
        rows: [
          { label: "Last log", value: formatStamp(work?.at) },
          {
            label: "Age (sec)",
            value: work?.ageSec != null ? Math.round(work.ageSec) : "—",
          },
        ],
        controls: chopControls,
      },
      {
        id: "session",
        label: "Session",
        value: session
          ? `${session.sawPulling ? "pulled" : "—"} · ${session.sawRunning ? "ran" : "pending"}`
          : "—",
        body: "Whether this instance was seen Pulling and/or Running recently.",
        rows: [
          { label: "Saw pulling", value: session?.sawPulling ? "yes" : "no" },
          { label: "Saw running", value: session?.sawRunning ? "yes" : "no" },
          { label: "Ended", value: formatStamp(session?.endedAt) },
        ],
        controls: chopControls,
      },
      {
        id: "peakPull",
        label: "Peak pull",
        value: peakPull,
        body: "Highest download Progress(...) for this instance while Pulling.",
        rows: [
          {
            label: "Peak fraction",
            value: session?.peakProgress != null ? String(session.peakProgress) : "—",
          },
        ],
        controls: chopControls,
      },
      {
        id: "chop24",
        label: "Chop 24h",
        value: hours?.last24hHours != null ? `${hours.last24hHours}h` : "—",
        body: "Estimated chopping hours from Bowl state samples. Preference levels affect future work Salad accepts.",
        rows: [
          {
            label: "Last 24h",
            value: hours?.last24hHours != null ? `${hours.last24hHours}h` : "—",
          },
          {
            label: "Last 7d",
            value: hours?.last7dHours != null ? `${hours.last7dHours}h` : "—",
          },
          {
            label: "Last 30d",
            value: hours?.last30dHours != null ? `${hours.last30dHours}h` : "—",
          },
          {
            label: "Star Chef",
            value:
              hours?.starChefProgressPct != null
                ? `${hours.starChefProgressPct}% of ~${hours.starChefTargetHours ?? 50}h`
                : "—",
          },
        ],
        controls: [...chopControls, ...workloadControls],
      },
      {
        id: "heartbeat",
        label: "Heartbeat",
        value: formatAge(snap?.heartbeat?.ageSec),
        tone: hbFresh ? "ok" : "warn",
        body: "Bowl heartbeat age. Alert toggles below are ChopWatch settings (local).",
        rows: [
          { label: "Last heartbeat", value: formatStamp(snap?.heartbeat?.at) },
          { label: "Age", value: formatAge(snap?.heartbeat?.ageSec) },
        ],
        controls: [
          {
            id: "alerts",
            type: "toggle",
            label: "Phase alerts enabled",
            help: "Master switch for ChopWatch phase-change alerts.",
            group: "alerts",
            groupLabel: "Alerts",
            groupHelp: "Local ChopWatch settings — not Salad preferences.",
            kind: "setting",
            key: "alertsEnabled",
            value: settings.alertsEnabled !== false,
          },
          {
            id: "toast",
            type: "toggle",
            label: "Windows toast alerts",
            help: "Show Windows toast notifications on phase changes.",
            group: "alerts",
            groupLabel: "Alerts",
            kind: "setting",
            key: "windowsToastEnabled",
            value: settings.windowsToastEnabled !== false,
          },
          {
            id: "browserHint",
            type: "toggle",
            label: "Browser notification mirror",
            help: "Also mirror alerts in the browser UI when the web app is open.",
            group: "alerts",
            groupLabel: "Alerts",
            kind: "setting",
            key: "browserAlertsHint",
            value: settings.browserAlertsHint !== false,
          },
        ],
      },
      {
        id: "saladProcs",
        label: "Salad procs",
        value: saladUp ? "up" : "down",
        tone: saladUp ? "ok" : "bad",
        body: "Local Salad / Bowl processes. Pause chopping or tweak Salad app flags here.",
        rows: (snap?.processes?.processes || []).map((p) => ({
          label: p.label,
          value: p.running
            ? `ON · ${p.count} · ${formatProcMemory(p.memoryMb)}`
            : "OFF",
        })),
        controls: chopControls,
      },
      {
        id: "gpuTemp",
        label: "GPU temp",
        value: formatTempC(gpu0?.tempC),
        tone: tempTone(gpu0?.tempC),
        body: "GPU temperature from nvidia-smi. Sustained heat usually tracks sustained util and power.",
        rows: [
          { label: "GPU", value: gpu0?.name || "—" },
          { label: "Temperature", value: formatTempC(gpu0?.tempC) },
          {
            label: "Util",
            value: gpu0?.utilGpuPct != null ? `${gpu0.utilGpuPct}%` : "—",
          },
          { label: "Power draw", value: formatWatts(gpu0?.powerW) },
        ],
        controls: [...chopControls, ...workloadControls],
      },
      {
        id: "gpuPower",
        label: "Power",
        value:
          gpu0?.powerW != null
            ? `${formatWatts(gpu0.powerW)}${
                gpu0.powerPct != null ? ` · ${Math.round(gpu0.powerPct)}%` : ""
              }`
            : "—",
        tone: gpu0?.powerPct != null && gpu0.powerPct >= 85 ? "warn" : undefined,
        body: "Instant GPU power draw vs the card’s power limit (nvidia-smi).",
        rows: [
          { label: "Draw", value: formatWatts(gpu0?.powerW) },
          { label: "Limit", value: formatWatts(gpu0?.powerLimitW) },
          {
            label: "Power %",
            value: gpu0?.powerPct != null ? `${gpu0.powerPct}%` : "—",
          },
          { label: "Temperature", value: formatTempC(gpu0?.tempC) },
          { label: "GPU", value: gpu0?.name || "—" },
        ],
        controls: [...chopControls, ...workloadControls],
      },
      {
        id: "vram",
        label: "VRAM",
        value:
          memUsed != null && memTotal != null
            ? formatMemPairFromMiB(memUsed, memTotal)
            : "—",
        tone:
          gpu0?.utilMemPct != null && gpu0.utilMemPct >= 90 ? "warn" : undefined,
        body: "Video memory used ÷ total. Separate from memory-controller busy time.",
        rows: [
          { label: "Used", value: formatGiBFromMiB(memUsed) },
          { label: "Total", value: formatGiBFromMiB(memTotal) },
          {
            label: "Fill",
            value: gpu0?.utilMemPct != null ? `${gpu0.utilMemPct}%` : "—",
          },
          {
            label: "Controller busy",
            value:
              gpu0?.memControllerBusyPct != null
                ? `${Math.round(gpu0.memControllerBusyPct)}%`
                : "—",
          },
        ],
        controls: [...chopControls, ...workloadControls],
      },
      {
        id: "thisRun",
        label: "This run",
        value: formatSessionEarned(
          work?.phase === "running" ? wallet?.sessionEarned : null,
        ),
        tone:
          work?.phase === "running" &&
          wallet?.sessionEarned != null &&
          Number(wallet.sessionEarned) > 0
            ? "ok"
            : undefined,
        body: "Balance gained since this Running instance started (Bowl Wallet delta).",
        rows: [
          {
            label: "Earned this run",
            value: formatSessionEarned(
              work?.phase === "running" ? wallet?.sessionEarned : null,
            ),
          },
          {
            label: "Start balance",
            value: formatMoney(wallet?.sessionStartBalance),
          },
          { label: "Current balance", value: formatMoney(wallet?.current) },
          {
            label: "Running since",
            value: formatStamp(
              wallet?.sessionRunningSinceAt || work?.runningSinceAt,
            ),
          },
        ],
        controls: chopControls,
      },
      {
        id: "chop7",
        label: "Chop 7d",
        value: hours?.last7dHours != null ? `${hours.last7dHours}h` : "—",
        body: "Estimated chopping hours over the last 7 days from Bowl state samples.",
        rows: [
          {
            label: "Last 24h",
            value: hours?.last24hHours != null ? `${hours.last24hHours}h` : "—",
          },
          {
            label: "Last 7d",
            value: hours?.last7dHours != null ? `${hours.last7dHours}h` : "—",
          },
          {
            label: "Last 30d",
            value: hours?.last30dHours != null ? `${hours.last30dHours}h` : "—",
          },
          {
            label: "Star Chef",
            value:
              hours?.starChefProgressPct != null
                ? `${hours.starChefProgressPct}% of ~${hours.starChefTargetHours ?? 50}h`
                : "—",
          },
        ],
        controls: [...chopControls, ...workloadControls],
      },
      {
        id: "starChef",
        label: "Star Chef",
        value:
          hours?.starChefProgressPct != null
            ? `${hours.starChefProgressPct}%`
            : "—",
        tone:
          hours?.starChefProgressPct != null && hours.starChefProgressPct >= 100
            ? "ok"
            : undefined,
        body: "Rough progress toward ~50 chopping hours / week (Star Chef style estimate).",
        rows: [
          {
            label: "Progress",
            value:
              hours?.starChefProgressPct != null
                ? `${hours.starChefProgressPct}%`
                : "—",
          },
          {
            label: "Target",
            value: `~${hours?.starChefTargetHours ?? 50}h / week`,
          },
          {
            label: "Last 7d",
            value: hours?.last7dHours != null ? `${hours.last7dHours}h` : "—",
          },
        ],
        controls: [...chopControls, ...workloadControls],
      },
      {
        id: "autoBail",
        label: "Auto-bail",
        value: bailLabel(snap?.downloadBail),
        tone: bailTone(snap?.downloadBail),
        body: "ChopWatch download auto-bail: skip stuck/slow unpaid pulls so Salad can re-roll work.",
        rows: [
          {
            label: "Enabled",
            value: snap?.downloadBail?.enabled === false ? "no" : "yes",
          },
          { label: "Status", value: snap?.downloadBail?.status || "—" },
          { label: "Reason", value: snap?.downloadBail?.reason || "—" },
          {
            label: "Last bail",
            value: formatStamp(snap?.downloadBail?.lastAt),
          },
        ],
        controls: [
          {
            id: "bailOn",
            type: "toggle",
            label: "Download auto-bail",
            help: "Automatically pause/resume to abandon stuck unpaid downloads.",
            group: "bail",
            groupLabel: "Download bail",
            groupHelp: "Local ChopWatch setting — not a Salad preference.",
            kind: "setting",
            key: "downloadBailEnabled",
            value: settings.downloadBailEnabled !== false,
          },
          ...chopControls,
        ],
      },
      {
        id: "wallet",
        label: "Wallet / predicted",
        value:
          wallet?.current != null
            ? `${formatMoney(wallet.current)} · ${
                predictedDay != null ? `${formatMoney(predictedDay)}/d` : "—"
              }`
            : "—",
        body: "Bowl Wallet lines plus optional official API. Toggle API and refresh from here.",
        rows: [
          { label: "Current", value: formatMoney(wallet?.current) },
          {
            label: "Predicted / day",
            value: predictedDay != null ? formatMoney(predictedDay) : "—",
          },
          { label: "Wallet age", value: formatAge(wallet?.ageSec) },
          { label: "API balance", value: formatMoney(apiBalance) },
        ],
        controls: [
          {
            id: "apiOn",
            type: "toggle",
            label: "Official Salad API",
            help: "Pull balance from Salad’s official API (needs a connected account in Settings).",
            group: "api",
            groupLabel: "Salad API",
            kind: "setting",
            key: "saladApiEnabled",
            value: settings.saladApiEnabled === true,
          },
          {
            id: "refreshApi",
            type: "button",
            primary: true,
            label: "Refresh API balance",
            help: "Fetch the latest official balance now.",
            group: "api",
            groupLabel: "Salad API",
            kind: "refreshApi",
            disabled:
              settings.saladApiEnabled !== true || !settings.authCookieConfigured,
          },
        ],
      },
      {
        id: "gpuNow",
        label: "GPU now",
        value: gpu0?.utilGpuPct != null ? `${gpu0.utilGpuPct}%` : "—",
        tone: "ok",
        body: "Live GPU compute utilization. Workload preference levels below are written to Salad preferences.txt.",
        rows: [
          { label: "GPU", value: gpu0?.name },
          {
            label: "Util",
            value: gpu0?.utilGpuPct != null ? `${gpu0.utilGpuPct}%` : "—",
          },
          { label: "Temperature", value: formatTempC(gpu0?.tempC) },
          { label: "Power draw", value: formatWatts(gpu0?.powerW) },
          {
            label: "VRAM",
            value:
              memUsed != null && memTotal != null
                ? formatMemPairFromMiB(memUsed, memTotal)
                : "—",
          },
        ],
        controls: [...chopControls, ...workloadControls],
      },
    ];
  }, [
    work,
    session,
    progress,
    pull,
    downloading,
    runningFor,
    sessionFor,
    gpu0,
    memUsed,
    memTotal,
    wallet,
    predictedDay,
    snap?.heartbeat,
    snap?.processes?.processes,
    snap?.downloadBail,
    saladUp,
    hbFresh,
    hours,
    paused,
    chopControls,
    workloadControls,
    apiBalance,
    settings.saladApiEnabled,
    settings.authCookieConfigured,
    settings.alertsEnabled,
    settings.windowsToastEnabled,
    settings.browserAlertsHint,
    settings.downloadBailEnabled,
  ]);

  // Hero strip: job lifecycle (rows 1–2) + hardware/earnings pulse (row 3).
  const heroFacts = useMemo(() => {
    const ids = [
      ...(downloading ? ["downloadInfo"] : []),
      "phase",
      "state",
      "instance",
      "runningFor",
      "sessionAge",
      "logAge",
      "session",
      "peakPull",
      "chop24",
      "heartbeat",
      "saladProcs",
      "gpuTemp",
      "gpuPower",
      "vram",
      "thisRun",
      "chop7",
      "starChef",
      "autoBail",
    ];
    const byId = new Map(facts.map((f) => [f.id, f]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }, [facts, downloading]);

  const procModal = useMemo(() => {
    if (!procKey) return null;
    const p = (snap?.processes?.processes || []).find((x) => x.key === procKey);
    const info = PROCESS_INFO[procKey];
    if (!p && !info) return null;
    const label = p?.label || info?.label || procKey;
    const running = p?.running === true;
    const pids = Array.isArray(p?.pids) ? p.pids.filter(Boolean) : [];
    return {
      label,
      value: running ? "ON" : "OFF",
      body:
        info?.body ||
        "Local Salad-related process watched by ChopWatch via Windows tasklist.",
      rows: [
        { label: "Status", value: running ? "Running" : "Not running" },
        { label: "Image", value: info?.image || "—" },
        {
          label: "Instances",
          value: p?.count != null ? String(p.count) : "—",
        },
        {
          label: "Working set",
          value: running ? formatProcMemory(p?.memoryMb) : "—",
        },
        {
          label: "PIDs",
          value: pids.length ? pids.join(", ") : "—",
        },
        {
          label: "Role",
          value:
            procKey === "salad"
              ? "Desktop UI / front-end"
              : procKey === "bowl"
                ? "Workload engine (logs ChopWatch reads)"
                : procKey === "bootstrapper"
                  ? "Install / update / launch helper"
                  : "Watched Salad process",
        },
      ],
      controls:
        procKey === "salad" || procKey === "bowl" ? chopControls : undefined,
    };
  }, [procKey, snap?.processes?.processes, chopControls]);

  const modal = procModal || facts.find((f) => f.id === modalId) || null;

  const gauges = useMemo(() => {
    const sizeHint =
      pull?.bytesDone != null || pull?.bytesTotal != null
        ? formatBytePair(pull.bytesDone, pull.bytesTotal)
        : null;
    const etaHint =
      pull?.etaSec != null ? `~${formatDuration(pull.etaSec)}` : null;
    const speedHint =
      pull?.bytesPerSec != null ? formatBytesPerSec(pull.bytesPerSec) : null;
    const peakPullPct =
      session?.peakProgress != null
        ? Math.round(session.peakProgress * 100)
        : null;
    const downloadHint = downloading
      ? [progress != null ? `${progress}%` : null, sizeHint, etaHint]
          .filter(Boolean)
          .join(" · ") || "pulling…"
      : [work?.phase || "idle", peakPullPct != null ? `peak ${peakPullPct}%` : null]
          .filter(Boolean)
          .join(" · ");

    const list = [
      {
        id: "download",
        label: "Download",
        value: downloading ? progress : null,
        theme: "violet",
        hint: downloadHint,
        title: "Job image download: size, speed, and ETA from Bowl pull events.",
        body: downloading
          ? "Live container image pull from Bowl SpinnerPullProgressEvent (bytes done/total, B/s, ETA) plus Progress(...). Not GPU activity. Image digests and customer workload IDs are hidden. Downloads are unpaid until Running — use Skip download or auto-bail to re-roll."
          : "No active image pull right now. This gauge stays visible so you can spot unpaid download time as soon as Salad starts Pulling. Peak pull is from the latest session when available.",
        rows: [
          { label: "Phase", value: work?.phase || "—" },
          {
            label: "Progress",
            value: downloading && progress != null ? `${progress}%` : "—",
          },
          { label: "Size", value: downloading ? sizeHint || "—" : "—" },
          { label: "ETA", value: downloading ? etaHint || "—" : "—" },
          { label: "Speed", value: downloading ? speedHint || "—" : "—" },
          {
            label: "Attempt",
            value:
              downloading && pull?.attempt != null && pull?.attemptMax != null
                ? `${pull.attempt}/${pull.attemptMax}`
                : "—",
          },
          {
            label: "Registry",
            value: downloading ? pull?.registryHost || "—" : "—",
          },
          { label: "Instance", value: work?.shortId || "—" },
          {
            label: "Peak pull",
            value:
              peakPullPct != null
                ? `${peakPullPct}%`
                : progress != null
                  ? `${progress}%`
                  : "—",
          },
          {
            label: "Auto-bail",
            value: snap?.downloadBail?.enabled
              ? snap.downloadBail.status || "on"
              : "off",
          },
        ],
      },
    ];
    list.push(
      {
        id: "gpuUtil",
        label: "GPU util",
        value: gpu0?.utilGpuPct,
        theme: "lime",
        hint: gpu0 ? formatTempC(gpu0.tempC) : "nvidia-smi n/a",
        title: "GPU compute utilization from nvidia-smi.",
        body:
          "Percent of time the GPU was busy with compute work (nvidia-smi utilization.gpu). This is the best quick read of whether a chopping job is actively using the card. Temperature is shown as a hint because util and heat usually rise together.",
        rows: [
          { label: "GPU", value: gpu0?.name || "—" },
          {
            label: "Util",
            value: gpu0?.utilGpuPct != null ? `${gpu0.utilGpuPct}%` : "—",
          },
          { label: "Temperature", value: formatTempC(gpu0?.tempC) },
          {
            label: "Source",
            value: snap?.gpu?.available ? "nvidia-smi" : "nvidia-smi n/a",
          },
        ],
      },
      {
        id: "vram",
        label: "VRAM fill",
        value: gpu0?.utilMemPct,
        theme: "cyan",
        hint: [gpuMemHint, memBusy].filter(Boolean).join(" · ") || null,
        title: "VRAM fill = memory used ÷ total. Not memory-bus busy time.",
        body:
          "How full video memory is right now: used ÷ total VRAM. This is not the same as memory-controller busy time (bus activity). A loaded model can keep VRAM high even when compute util dips between steps.",
        rows: [
          { label: "Used", value: formatGiBFromMiB(memUsed) },
          { label: "Total", value: formatGiBFromMiB(memTotal) },
          {
            label: "Fill",
            value: gpu0?.utilMemPct != null ? `${gpu0.utilMemPct}%` : "—",
          },
          {
            label: "Controller busy",
            value:
              gpu0?.memControllerBusyPct != null
                ? `${Math.round(gpu0.memControllerBusyPct)}%`
                : "—",
          },
          {
            label: "Pair",
            value: gpuMemHint || "—",
          },
        ],
      },
      {
        id: "gpuPower",
        label: "GPU power",
        value: gpu0?.powerPct,
        theme: "coral",
        hint:
          gpu0?.powerW != null
            ? `${formatWatts(gpu0.powerW)} / ${formatWatts(gpu0.powerLimitW)}`
            : null,
        title: "GPU power draw as a percent of the card’s power limit.",
        body:
          "Instantaneous power draw divided by the card’s reported power limit. Useful as a “how hard is it working” signal alongside util — sustained high power usually means sustained load and heat.",
        rows: [
          { label: "Draw", value: formatWatts(gpu0?.powerW) },
          { label: "Limit", value: formatWatts(gpu0?.powerLimitW) },
          {
            label: "Power %",
            value: gpu0?.powerPct != null ? `${gpu0.powerPct}%` : "—",
          },
          { label: "Temperature", value: formatTempC(gpu0?.tempC) },
          { label: "GPU", value: gpu0?.name || "—" },
        ],
      },
      {
        id: "cpuLoad",
        label: "CPU load",
        value: snap?.host?.cpuLoadPct,
        theme: "amber",
        hint: snap?.host?.cpuName?.trim() || "host CPU",
        title: "Host CPU load as reported by the local helper.",
        body:
          "Host CPU load percentage from the local helper (Windows LoadPercentage). This is whole-machine CPU, not Salad-only — Bowl, the OS, browsers, and other apps all share it.",
        rows: [
          {
            label: "Load",
            value:
              snap?.host?.cpuLoadPct != null ? `${snap.host.cpuLoadPct}%` : "—",
          },
          { label: "CPU", value: snap?.host?.cpuName?.trim() || "—" },
          {
            label: "RAM used",
            value:
              snap?.host?.memUsedMb != null
                ? formatMemPairFromMb(snap.host.memUsedMb, snap.host.memTotalMb)
                : "—",
          },
        ],
      },
      {
        id: "sysRam",
        label: "System RAM",
        value: snap?.host?.memUsedPct,
        theme: "mint",
        hint:
          snap?.host?.memUsedMb != null
            ? formatMemPairFromMb(snap.host.memUsedMb, snap.host.memTotalMb)
            : null,
        title: "System RAM in use vs installed capacity (shown in GB).",
        body:
          "System memory in use versus installed capacity. Separate from GPU VRAM. If this climbs while chopping, host processes (Bowl, Docker/containers, OS cache) may be competing with everything else on the machine.",
        rows: [
          {
            label: "Used %",
            value:
              snap?.host?.memUsedPct != null ? `${snap.host.memUsedPct}%` : "—",
          },
          {
            label: "Used / total",
            value:
              snap?.host?.memUsedMb != null
                ? formatMemPairFromMb(snap.host.memUsedMb, snap.host.memTotalMb)
                : "—",
          },
          {
            label: "CPU load",
            value:
              snap?.host?.cpuLoadPct != null ? `${snap.host.cpuLoadPct}%` : "—",
          },
        ],
      },
    );
    return list;
  }, [
    downloading,
    progress,
    pull,
    work,
    session,
    snap?.downloadBail,
    gpu0,
    gpuMemHint,
    memBusy,
    memUsed,
    memTotal,
    snap?.gpu?.available,
    snap?.host,
  ]);

  const gaugeModal = gauges.find((g) => g.id === gaugeId) || null;

  useEffect(() => {
    if (gaugeId && !gauges.some((g) => g.id === gaugeId)) {
      setGaugeId(null);
    }
  }, [gaugeId, gauges]);

  async function refreshSnap() {
    const next = await fetchSnapshot();
    setSnap?.(next);
    return next;
  }

  async function onModalAction(action) {
    if (action.kind === "flag") {
      await setSaladFlags({ [action.key]: action.value });
      await refreshSnap();
      return {
        message:
          action.key === "SALAD_CHOPPING_INDEFINITELY_PAUSED"
            ? action.value
              ? "Chopping paused in Salad config."
              : "Chopping resumed in Salad config."
            : "Salad flag updated.",
      };
    }
    if (action.kind === "pref") {
      await setSaladPreferences({ [action.key]: action.value });
      await refreshSnap();
      return { message: `Preference ${action.key} → ${action.value}` };
    }
    if (action.kind === "setting") {
      const next = await saveSettings({ [action.key]: action.value });
      setSnap?.((s) => (s ? { ...s, settings: { ...s.settings, ...next } } : s));
      return { message: "ChopWatch setting saved." };
    }
    if (action.kind === "refreshApi") {
      const account = await refreshSaladAccount();
      setSnap?.((s) => (s ? { ...s, saladAccount: account } : s));
      return { message: "API balance refreshed." };
    }
    throw new Error("Unknown action");
  }

  return (
    <>
      <section className="hero">
        <ChopCommandBar
          paused={paused}
          phase={work?.phase}
          saladUp={saladUp}
          downloadBail={snap?.downloadBail}
          pull={pull}
          onUpdated={refreshSnap}
        />

        <div className="hero-main">
          <p className="phase-kicker">
            Current work
            {snap?.product?.version ? (
              <span className="phase-version">v{snap.product.version}</span>
            ) : null}
          </p>
          <h2 className="phase-title">
            <span className={`dot ${phaseDot(work?.phase)}`} style={{ marginRight: 10 }} />
            {work?.title || "Waiting for snapshot…"}
          </h2>
          <p className="phase-detail">{work?.detail || snap?.product?.disclaimer}</p>

          <div className="hero-metrics" aria-label="Live metrics">
            <div
              className="hero-metric"
              title="Recent GPU compute utilization samples from the local helper (last ~30 points)."
            >
              <Sparkline
                values={snap?.gpu?.utilHistory || []}
                label="GPU util"
                height={22}
                width={180}
              />
            </div>
            <button
              type="button"
              className="hero-metric hero-earn"
              onClick={() => {
                setProcKey(null);
                setModalId("wallet");
              }}
              title="Bowl Wallet balance and Salad’s predicted daily earnings. Click for details."
            >
              <div className="hero-earn-head">
                <span className="hero-earn-label">Making</span>
                <span className="hero-earn-age">
                  {wallet ? formatAge(wallet.ageSec) : "no Wallet"}
                </span>
              </div>
              <div className="hero-earn-primary">
                {predictedDay != null ? (
                  <>
                    <span className="hero-earn-amount">{formatMoney(predictedDay)}</span>
                    <span className="hero-earn-unit">/day</span>
                  </>
                ) : (
                  <span className="hero-earn-amount muted">—</span>
                )}
              </div>
              <div className="hero-earn-meta">
                <span>
                  {predictedHour != null
                    ? `${formatMoney(predictedHour)}/hr`
                    : "—/hr"}
                </span>
                <span className="hero-earn-sep" aria-hidden="true">
                  ·
                </span>
                <span>{formatMoney(wallet?.current)}</span>
                {apiBalance != null ? (
                  <>
                    <span className="hero-earn-sep" aria-hidden="true">
                      ·
                    </span>
                    <span>API {formatMoney(apiBalance)}</span>
                  </>
                ) : null}
              </div>
            </button>
          </div>
        </div>

        <div
          className={`work-facts cols-${heroFacts.length}`}
          aria-label="Work details"
        >
          {heroFacts.map((f) => (
            <Fact
              key={f.id}
              label={f.label}
              value={f.value}
              tone={f.tone}
              onOpen={() => {
                setProcKey(null);
                setModalId(f.id);
              }}
            />
          ))}
        </div>
      </section>

      <section
        className="gauge-row with-download"
        aria-label="Hardware and download gauges"
      >
        {gauges.map((g) => (
          <GaugeDial
            key={g.id}
            label={g.label}
            value={g.value}
            theme={g.theme}
            hint={g.hint}
            title={g.title}
            onOpen={() => setGaugeId(g.id)}
          />
        ))}
      </section>

      <div className="stat-row">
        <div className="stat">
          <div className="stat-label">
            <InfoTip text="Current balance parsed from Bowl Wallet log lines.">
              Bowl balance
            </InfoTip>
          </div>
          <div className="stat-value">
            {wallet?.current != null ? formatMoney(wallet.current) : "—"}
          </div>
          <div className="mono">{wallet ? formatAge(wallet.ageSec) : "no Wallet line"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">
            <InfoTip text="Salad’s predicted daily earnings from the Wallet log. Projection only.">
              Predicted / day
            </InfoTip>
          </div>
          <div className="stat-value">
            {predictedDay != null ? formatMoney(predictedDay) : "—"}
          </div>
          <div className="mono">Bowl Wallet log</div>
        </div>
        <div className="stat">
          <div className="stat-label">
            <InfoTip text="Official Salad API balance when you connect an account in Settings.">
              API balance
            </InfoTip>
          </div>
          <div className="stat-value">{formatMoney(apiBalance)}</div>
          <div className="mono">
            {snap?.saladAccount?.configured
              ? `HTTP ${snap.saladAccount.balanceStatus ?? "—"}`
              : "enable in Settings"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">
            <InfoTip text="Rough progress toward ~50 chopping hours / week (Star Chef style estimate).">
              Star Chef
            </InfoTip>
          </div>
          <div className="stat-value">{hours?.starChefProgressPct ?? "—"}%</div>
          <div className="mono">target ~{hours?.starChefTargetHours ?? 50}h / week</div>
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
              <div className="stat-label">GPU</div>
              <div className="stat-value">
                {gpu0?.utilGpuPct != null ? `${gpu0.utilGpuPct}%` : "—"}
              </div>
              <div className="mono">{gpu0?.name || "nvidia-smi n/a"}</div>
            </div>
          </div>
          <HoursChart days={hours?.days || []} />
        </section>

        <section className="panel">
          <h2>Hardware pulse</h2>
          <ul className="pulse-chips">
            <li>
              <span className="pulse-k">GPU</span>
              <span className="pulse-v lime">{gpu0?.name || "—"}</span>
            </li>
            <li>
              <span className="pulse-k">Temp</span>
              <span className="pulse-v amber">{formatTempC(gpu0?.tempC)}</span>
            </li>
            <li>
              <span className="pulse-k">Power</span>
              <span className="pulse-v coral">
                {gpu0?.powerW != null
                  ? `${formatWatts(gpu0.powerW)} / ${formatWatts(gpu0.powerLimitW)} (${gpu0.powerPct ?? "—"}%)`
                  : "—"}
              </span>
            </li>
            <li>
              <span className="pulse-k">VRAM</span>
              <span className="pulse-v cyan">
                {memUsed != null && memTotal != null
                  ? formatMemPairFromMiB(memUsed, memTotal)
                  : "—"}
              </span>
            </li>
          </ul>
        </section>

        <section className="panel">
          <h2>Processes</h2>
          <p className="hint">Click a process for what it does and live details.</p>
          <ul className="proc-list">
            {(snap?.processes?.processes || []).map((p) => (
              <li key={p.key}>
                <button
                  type="button"
                  className={`proc-item${p.running ? " on" : ""}`}
                  onClick={() => {
                    setModalId(null);
                    setProcKey(p.key);
                  }}
                >
                  <span>
                    {p.label}
                    <div className="mono">
                      {p.running
                        ? `${p.count} proc · ${formatProcMemory(p.memoryMb)}`
                        : "not running"}
                    </div>
                  </span>
                  <span className="mono">{p.running ? "ON" : "OFF"}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <DetailModal
        open={Boolean(modal)}
        title={modal?.label}
        value={modal?.value}
        body={modal?.body}
        rows={modal?.rows}
        controls={modal?.controls}
        onClose={() => {
          setModalId(null);
          setProcKey(null);
        }}
        onAction={onModalAction}
      />

      <GaugeModal
        open={Boolean(gaugeModal)}
        title={gaugeModal?.label}
        body={gaugeModal?.body}
        rows={gaugeModal?.rows}
        value={gaugeModal?.value}
        hint={gaugeModal?.hint}
        theme={gaugeModal?.theme}
        onClose={() => setGaugeId(null)}
      />
    </>
  );
}
