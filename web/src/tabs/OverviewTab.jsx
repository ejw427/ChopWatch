import { useMemo, useState } from "react";
import HoursChart from "../HoursChart.jsx";
import GaugeDial from "../GaugeDial.jsx";
import Sparkline from "../Sparkline.jsx";
import DetailModal from "../DetailModal.jsx";
import InfoTip from "../InfoTip.jsx";
import {
  formatGiBFromMiB,
  formatMemPairFromMiB,
  formatMemPairFromMb,
  formatProcMemory,
  formatTempC,
  formatWatts,
} from "../format.js";
import {
  fetchSnapshot,
  saveSettings,
  setSaladFlags,
  setSaladPreferences,
  refreshSaladAccount,
} from "../api.js";

const LEVELS = ["Low", "Medium", "High", "Off"];

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

function pct(progress) {
  if (progress == null || !Number.isFinite(progress)) return null;
  return Math.max(0, Math.min(100, Math.round(progress * 100)));
}

function money(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toFixed(2)}`;
}

function formatDuration(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatStamp(ts) {
  if (!ts) return "—";
  const d = new Date(String(ts).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
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
  const work = snap?.work;
  const progress = pct(work?.progress);
  const downloading = work?.phase === "downloading" && progress != null;
  const gpu0 = snap?.gpu?.gpus?.[0];
  const wallet = snap?.wallet;
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
            label: "Resume chopping",
            kind: "flag",
            key: "SALAD_CHOPPING_INDEFINITELY_PAUSED",
            value: false,
          }
        : {
            id: "pause",
            type: "button",
            danger: true,
            label: "Pause chopping",
            kind: "flag",
            key: "SALAD_CHOPPING_INDEFINITELY_PAUSED",
            value: true,
          },
      {
        id: "autoLaunch",
        type: "toggle",
        label: "Salad auto-launch",
        kind: "flag",
        key: "SALAD_AUTO_LAUNCH",
        value: flags.SALAD_AUTO_LAUNCH === true,
      },
      {
        id: "overlay",
        type: "toggle",
        label: "Salad overlay",
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
        kind: "pref",
        key: "active/gpu",
        value: prefs["active/gpu"] || "Low",
        options: LEVELS,
      },
      {
        id: "idleGpu",
        type: "select",
        label: "Idle GPU",
        kind: "pref",
        key: "idle/gpu",
        value: prefs["idle/gpu"] || "High",
        options: LEVELS,
      },
      {
        id: "activeCpu",
        type: "select",
        label: "Active CPU",
        kind: "pref",
        key: "active/cpu",
        value: prefs["active/cpu"] || "Low",
        options: LEVELS,
      },
      {
        id: "idleCpu",
        type: "select",
        label: "Idle CPU",
        kind: "pref",
        key: "idle/cpu",
        value: prefs["idle/cpu"] || "High",
        options: LEVELS,
      },
      {
        id: "miningGpu",
        type: "toggle",
        label: "Mining GPU workloads",
        kind: "pref",
        key: "mining/gpu",
        value: String(prefs["mining/gpu"]).toLowerCase() === "true",
      },
      {
        id: "containers",
        type: "toggle",
        label: "Container workloads",
        kind: "pref",
        key: "containers",
        value: String(prefs.containers).toLowerCase() === "true",
      },
    ],
    [prefs],
  );

  const facts = useMemo(() => {
    const peakPull =
      session?.peakProgress != null
        ? `${Math.round(session.peakProgress * 100)}%`
        : progress != null
          ? `${progress}%`
          : "—";

    return [
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
        rows: [{ label: "Full short id", value: work?.shortId }],
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
          { label: "Session started", value: formatStamp(work?.sessionStartedAt || session?.startedAt) },
        ],
        controls: chopControls,
      },
      {
        id: "lastLog",
        label: "Last log",
        value: formatStamp(work?.at),
        body: "Newest WLInstanceState line used for status. Read-only; use Pause if you want Salad to stop.",
        rows: [
          { label: "Raw stamp", value: work?.at },
          { label: "Age", value: formatAge(work?.ageSec) },
        ],
        controls: chopControls,
      },
      {
        id: "logAge",
        label: "Log age",
        value: formatAge(work?.ageSec),
        body: "How long ago that lifecycle line was written. Running often stays quiet after the first Running line.",
        rows: [{ label: "Age (sec)", value: work?.ageSec != null ? Math.round(work.ageSec) : "—" }],
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
        id: "gpuNow",
        label: "GPU now",
        value: gpu0?.utilGpuPct != null ? `${gpu0.utilGpuPct}%` : "—",
        tone: "ok",
        body: "Live GPU compute utilization. Workload preference levels below are written to Salad preferences.txt.",
        rows: [
          { label: "GPU", value: gpu0?.name },
          { label: "Util", value: gpu0?.utilGpuPct != null ? `${gpu0.utilGpuPct}%` : "—" },
        ],
        controls: [...chopControls, ...workloadControls],
      },
      {
        id: "gpuTempPower",
        label: "GPU temp / power",
        value: gpu0
          ? `${formatTempC(gpu0.tempC)} · ${formatWatts(gpu0.powerW)}`
          : "—",
        body: "Temperature and power from nvidia-smi. Preference controls change how hard Salad may use the GPU when you’re active/idle.",
        rows: [
          { label: "Temperature", value: formatTempC(gpu0?.tempC) },
          { label: "Power draw", value: formatWatts(gpu0?.powerW) },
          { label: "Power limit", value: formatWatts(gpu0?.powerLimitW) },
          {
            label: "Power %",
            value: gpu0?.powerPct != null ? `${gpu0.powerPct}%` : "—",
          },
        ],
        controls: workloadControls,
      },
      {
        id: "vram",
        label: "VRAM",
        value:
          memUsed != null && memTotal != null
            ? formatMemPairFromMiB(memUsed, memTotal)
            : "—",
        body: "Video memory used/total in GB. Container / mining toggles affect what Salad is willing to run.",
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
                ? `${gpu0.memControllerBusyPct}%`
                : "—",
          },
        ],
        controls: workloadControls,
      },
      {
        id: "wallet",
        label: "Wallet / predicted",
        value:
          wallet?.current != null
            ? `${money(wallet.current)} · ${money(wallet.predicted)}/d`
            : "—",
        body: "Bowl Wallet lines plus optional official API. Toggle API and refresh from here.",
        rows: [
          { label: "Current", value: money(wallet?.current) },
          { label: "Predicted / day", value: money(wallet?.predicted) },
          { label: "Wallet age", value: formatAge(wallet?.ageSec) },
          { label: "API balance", value: money(apiBalance) },
        ],
        controls: [
          {
            id: "apiOn",
            type: "toggle",
            label: "Official Salad API",
            kind: "setting",
            key: "saladApiEnabled",
            value: settings.saladApiEnabled === true,
          },
          {
            id: "refreshApi",
            type: "button",
            primary: true,
            label: "Refresh API balance",
            kind: "refreshApi",
            disabled: settings.saladApiEnabled !== true || !settings.authCookieConfigured,
          },
        ],
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
            kind: "setting",
            key: "alertsEnabled",
            value: settings.alertsEnabled !== false,
          },
          {
            id: "toast",
            type: "toggle",
            label: "Windows toast alerts",
            kind: "setting",
            key: "windowsToastEnabled",
            value: settings.windowsToastEnabled !== false,
          },
          {
            id: "browserHint",
            type: "toggle",
            label: "Browser notification mirror",
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
        id: "chop24",
        label: "Chop 24h",
        value: hours?.last24hHours != null ? `${hours.last24hHours}h` : "—",
        body: "Estimated chopping hours from Bowl state samples. Preference levels affect future work Salad accepts.",
        rows: [
          { label: "Last 24h", value: hours?.last24hHours != null ? `${hours.last24hHours}h` : "—" },
          { label: "Last 7d", value: hours?.last7dHours != null ? `${hours.last7dHours}h` : "—" },
          { label: "Last 30d", value: hours?.last30dHours != null ? `${hours.last30dHours}h` : "—" },
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
    ];
  }, [
    work,
    session,
    progress,
    runningFor,
    sessionFor,
    gpu0,
    memUsed,
    memTotal,
    wallet,
    snap?.heartbeat,
    snap?.processes?.processes,
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
  ]);

  const modal = facts.find((f) => f.id === modalId) || null;

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
        <div className="hero-main">
          <p className="phase-kicker">Current work</p>
          <h2 className="phase-title">
            <span className={`dot ${phaseDot(work?.phase)}`} style={{ marginRight: 10 }} />
            {work?.title || "Waiting for snapshot…"}
          </h2>
          <p className="phase-detail">{work?.detail || snap?.product?.disclaimer}</p>
          <div title="Recent GPU compute utilization samples from the local helper (last ~30 points).">
            <Sparkline
              values={snap?.gpu?.utilHistory || []}
              label="GPU util · last samples"
            />
          </div>
        </div>

        <div className="work-facts" aria-label="Work details">
          {facts.map((f) => (
            <Fact
              key={f.id}
              label={f.label}
              value={f.value}
              tone={f.tone}
              onOpen={() => setModalId(f.id)}
            />
          ))}
        </div>
      </section>

      <section
        className={`gauge-row${downloading ? " with-download" : " five"}`}
        aria-label="Hardware gauges"
      >
        {downloading && (
          <GaugeDial
            label="Download"
            value={progress}
            theme="violet"
            hint={`pull ${progress}%`}
            title="Job image download progress from Bowl Pulling Progress(...) lines."
          />
        )}
        <GaugeDial
          label="GPU util"
          value={gpu0?.utilGpuPct}
          theme="lime"
          hint={gpu0 ? formatTempC(gpu0.tempC) : "nvidia-smi n/a"}
          title="GPU compute utilization from nvidia-smi."
        />
        <GaugeDial
          label="VRAM fill"
          value={gpu0?.utilMemPct}
          theme="cyan"
          hint={[gpuMemHint, memBusy].filter(Boolean).join(" · ") || null}
          title="VRAM fill = memory used ÷ total. Not memory-bus busy time."
        />
        <GaugeDial
          label="GPU power"
          value={gpu0?.powerPct}
          theme="coral"
          hint={
            gpu0?.powerW != null
              ? `${formatWatts(gpu0.powerW)} / ${formatWatts(gpu0.powerLimitW)}`
              : null
          }
          title="GPU power draw as a percent of the card’s power limit."
        />
        <GaugeDial
          label="CPU load"
          value={snap?.host?.cpuLoadPct}
          theme="amber"
          hint={snap?.host?.cpuName?.trim() || "host CPU"}
          title="Host CPU load as reported by the local helper."
        />
        <GaugeDial
          label="System RAM"
          value={snap?.host?.memUsedPct}
          theme="mint"
          hint={
            snap?.host?.memUsedMb != null
              ? formatMemPairFromMb(snap.host.memUsedMb, snap.host.memTotalMb)
              : null
          }
          title="System RAM in use vs installed capacity (shown in GB)."
        />
      </section>

      <div className="stat-row">
        <div className="stat">
          <div className="stat-label">
            <InfoTip text="Current balance parsed from Bowl Wallet log lines.">
              Bowl balance
            </InfoTip>
          </div>
          <div className="stat-value">
            {wallet?.current != null ? money(wallet.current) : "—"}
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
            {wallet?.predicted != null ? money(wallet.predicted) : "—"}
          </div>
          <div className="mono">Bowl Wallet log</div>
        </div>
        <div className="stat">
          <div className="stat-label">
            <InfoTip text="Official Salad API balance when you connect an account in Settings.">
              API balance
            </InfoTip>
          </div>
          <div className="stat-value">{money(apiBalance)}</div>
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
          <ul className="proc-list">
            {(snap?.processes?.processes || []).map((p) => (
              <li key={p.key} className={p.running ? "on" : ""}>
                <span>
                  {p.label}
                  <div className="mono">
                    {p.running
                      ? `${p.count} proc · ${formatProcMemory(p.memoryMb)}`
                      : "not running"}
                  </div>
                </span>
                <span className="mono">{p.running ? "ON" : "OFF"}</span>
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
        onClose={() => setModalId(null)}
        onAction={onModalAction}
      />
    </>
  );
}
