import { readRuntimeState, writeRuntimeState } from "./store.js";

const EMPTY_VIEW = {
  sessionEarned: null,
  sessionStartBalance: null,
  sessionRunningSinceAt: null,
};

function clearPatch() {
  return {
    sessionEarningsStartBalance: null,
    sessionEarningsRunningSinceAt: null,
    sessionEarningsShortId: null,
  };
}

function hasBaseline(state) {
  return (
    state?.sessionEarningsStartBalance != null &&
    Number.isFinite(Number(state.sessionEarningsStartBalance))
  );
}

function sameRunningIdentity(state, shortId, runningSinceAt) {
  return (
    state?.sessionEarningsShortId === shortId &&
    state?.sessionEarningsRunningSinceAt === runningSinceAt
  );
}

function needsClear(state) {
  return (
    state?.sessionEarningsStartBalance != null ||
    state?.sessionEarningsRunningSinceAt != null ||
    state?.sessionEarningsShortId != null
  );
}

function finiteCurrent(wallet) {
  if (wallet?.current == null) return null;
  const n = Number(wallet.current);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pure session-earnings tracker: baseline wallet.current when a Running job
 * starts (or identity changes), delta while the same session continues.
 *
 * @param {object|null} work
 * @param {object|null} wallet
 * @param {object} prevState runtime-state fields
 * @param {number} [_now] unused; kept for call-site symmetry with other helpers
 * @returns {{ patch: object, view: { sessionEarned: number|null, sessionStartBalance: number|null, sessionRunningSinceAt: string|null } }}
 */
export function updateSessionEarnings(work, wallet, prevState = {}, _now = Date.now()) {
  const phase = work?.phase || null;
  const shortId = work?.shortId ?? null;
  const runningSinceAt = work?.runningSinceAt ?? null;
  const current = finiteCurrent(wallet);

  if (phase !== "running") {
    return {
      patch: needsClear(prevState) ? clearPatch() : {},
      view: { ...EMPTY_VIEW },
    };
  }

  if (hasBaseline(prevState) && sameRunningIdentity(prevState, shortId, runningSinceAt)) {
    const sessionStartBalance = Number(prevState.sessionEarningsStartBalance);
    return {
      patch: {},
      view: {
        sessionEarned: current != null ? current - sessionStartBalance : null,
        sessionStartBalance,
        sessionRunningSinceAt: runningSinceAt,
      },
    };
  }

  // New running instance (or first baseline) — need a finite balance to start.
  if (current == null) {
    const identityStale =
      needsClear(prevState) &&
      !sameRunningIdentity(prevState, shortId, runningSinceAt);
    return {
      patch: identityStale ? clearPatch() : {},
      view: { ...EMPTY_VIEW },
    };
  }

  return {
    patch: {
      sessionEarningsStartBalance: current,
      sessionEarningsRunningSinceAt: runningSinceAt,
      sessionEarningsShortId: shortId,
    },
    view: {
      sessionEarned: 0,
      sessionStartBalance: current,
      sessionRunningSinceAt: runningSinceAt,
    },
  };
}

/**
 * Apply tracker to runtime-state and return view fields for the snapshot.
 * Injectable deps for tests.
 */
export function applySessionEarnings(work, wallet, deps = {}) {
  const getState = deps.readRuntimeState || readRuntimeState;
  const setState = deps.writeRuntimeState || writeRuntimeState;
  const now = deps.nowMs ?? Date.now();
  const state = getState();
  const { patch, view } = updateSessionEarnings(work, wallet, state, now);
  if (Object.keys(patch).length) setState(patch);
  return view;
}

export { EMPTY_VIEW, clearPatch };
