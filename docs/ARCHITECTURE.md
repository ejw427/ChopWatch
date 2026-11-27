# Architecture

ChopWatch is a local **read-only** Salad Chopping dashboard: a small Express helper plus a Vite/React UI.

## Processes

```text
[Browser UI :5177]  --poll-->  [Helper API :3781]  --read-->  Bowl logs / nvidia-smi / OS
                                      |
                                      +--opt-in-->  Salad app-api (auth cookie)
```

| Piece | Role |
| --- | --- |
| `helper/` | Express on `127.0.0.1:3781`. Builds snapshots from Bowl logs, GPU/host, wallet lines, chopping-hour estimates, phase alerts. Optional Salad API. |
| `web/` | Vite + React on `127.0.0.1:5177`. Tabs: Overview, Details, Settings, About. |
| Root | `concurrently` runs helper + web; product version lives in root `package.json`. |

## Snapshot pipeline

`helper/src/snapshot.js` → `buildSnapshot()` aggregates:

1. Salad process list (`processes.js`)
2. Chopping prefs / pause flags (`preferences.js`)
3. Workload phase from Bowl logs (`bowlLog.js`)
4. Wallet + heartbeat lines (`wallet.js`)
5. GPU (`nvidia-smi`), host CPU/RAM, disk
6. Chopping hours from state samples (`chopHours.js`, 15m gap cap)
7. Phase-change alerts (`alerts.js`)
8. Optional official Salad balance/history (`saladApi.js`)

## Safety boundaries

ChopWatch never:

- Reads `token.txt` or other ProgramData credentials by default (`saladPaths.blockedFiles`)
- Opens WSL shells or customer container filesystems
- Inspects encrypted workload images or job payloads

Optional Salad `auth` cookie lives only in `helper/data/secrets.json` (gitignored).

## Key modules

| Module | Responsibility |
| --- | --- |
| `bowlLog.js` | Parse `WLInstanceState*` lifecycle events; sessions; finding-job inference |
| `chopHours.js` | Integrate active-state time; Star Chef progress estimate |
| `wallet.js` | Bowl `Wallet: Current(...), Predicted(...)` + heartbeat |
| `alerts.js` | Phase-change debounce + Windows toast / UI event |
| `saladConnect.js` | Private browser profile to capture auth cookie |
| `version.js` | Reads product version from root `package.json` |

## Data on disk

| Path | Contents |
| --- | --- |
| `helper/data/settings.json` | Alerts / API toggles |
| `helper/data/secrets.json` | Auth cookie (never commit) |
| `helper/data/runtime-state.json` | Last phase / alert debounce |
| `helper/data/salad-browser-profile/` | Private browser profile for Connect |
