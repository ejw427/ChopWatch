# ChopWatch

Local dashboard for Salad chopping on this PC.

Shows what Salad is *doing* (lifecycle), GPU/host load, Bowl wallet lines, chopping-hour estimates, phase alerts, and — if you opt in — official Salad API balance/history. Overview can pause/resume chopping, edit allowlisted Salad preferences, and **skip slow unpaid downloads** (auto-bail or manual Skip) so Salad re-rolls Finding Job. **Not** customer workload identity or container contents.

**Repo:** https://github.com/ejw427/ChopWatch  
Day-to-day branch: `dev` · stable line: `main`

## Download (Windows)

Installers ship on [GitHub Releases](https://github.com/ejw427/ChopWatch/releases):

- **Setup `.exe`** — NSIS installer (Start Menu + desktop shortcut)
- **Portable `.exe`** — no install; run from a folder

Releases include `SHA256SUMS.txt` so you can verify the `.exe` hashes. Builds are unsigned unless free [SignPath](docs/SIGNING.md) OSS signing is enabled — SmartScreen may warn; choose *More info* → *Run anyway* if the hash matches and you trust the release. Settings/secrets stay under your user profile (`%APPDATA%\ChopWatch`).

## Safety

ChopWatch never:

- Reads `token.txt` or other Salad ProgramData credentials by default
- Opens WSL shells or customer container filesystems
- Inspects encrypted workload images or job payloads
- Fakes Bowl job phases (Running/Pulling still come from Salad logs)

Allowlisted writes (from Overview / Settings): Salad `SALAD_CHOPPING_INDEFINITELY_PAUSED` / related app flags, workload preference levels in `preferences.txt`, and automatic pause→resume for slow-download bail (tunable under Settings).

Your optional Salad `auth` cookie is stored only in `helper/data/secrets.json` (gitignored). Treat it like a password.

## Run

```bash
npm install
```

**Desktop app** (window + system tray; helper runs in the background):

```bash
npm run app
```

Close the window to hide to the tray. Quit from the tray menu. In a packaged install, **Settings → Desktop** (or the tray menu) can enable **Start with Windows** — ChopWatch comes back in the tray after sign-in.

**Cursor / VS Code:** use the status-bar task buttons (Stop, Rebuild + restart, …) or **Terminal → Run Task…**. See `.vscode/tasks.json`.

**Browser dashboard** (unchanged):

```bash
npm start
```

- UI: http://127.0.0.1:5177
- Helper API: http://127.0.0.1:3781

After clone, enable version-bump hooks once:

```powershell
npm run hooks
```

## Tabs

| Tab | Contents |
| --- | --- |
| **Overview** | Current work, balances, GPU, chopping hours, processes |
| **Details** | Official API history, sessions, timeline, disk |
| **Settings** | Alerts, Salad auth cookie, Chopping flags/prefs |
| **About** | Mark, Eric Welch, features, privacy stance |

## Docs

| Doc | HTML sister |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | [ARCHITECTURE.html](docs/ARCHITECTURE.html) |
| [Privacy](docs/PRIVACY_POLICY.md) | [PRIVACY_POLICY.html](docs/PRIVACY_POLICY.html) |
| [Testing / versions](docs/TESTING.md) | [TESTING.html](docs/TESTING.html) |
| [Project plan](docs/PROJECT_PLAN.md) | [PROJECT_PLAN.html](docs/PROJECT_PLAN.html) |
| [Signing (no paid cert)](docs/SIGNING.md) | [SIGNING.html](docs/SIGNING.html) |

Regenerate HTML sisters: `npm run docs:html` · open them: `npm run docs:view`  
Public: [welchsoftware.net/projects/chopwatch](https://www.welchsoftware.net/projects/chopwatch) · [docs hub](https://www.welchsoftware.net/chopwatch/)

## Tests

```bash
npm test
```

## Package a Windows release

```powershell
npm run dist
```

Artifacts land in `release/` (installer + portable). Faster unpacked smoke test:

```powershell
npm run dist:dir
```

Tag and push to publish via GitHub Actions (`Release` workflow):

```powershell
git tag v0.5.1
git push origin v0.5.1
```

## Data sources

| Signal | Source |
| --- | --- |
| Work phase | Bowl logs (`WLInstanceState*` + progress) |
| Wallet / predicted | Bowl `Wallet: Current(...), Predicted(...)` |
| GPU / host | `nvidia-smi` + Node/OS + CPU load |
| Chopping hours | Estimated from state samples (gaps capped 15m) |
| Phase alerts | Windows balloon + browser Notification |
| Salad API (opt-in) | `app-api.salad.com` balance / earning-rate / 30-day history |

## Opt-in Salad API

Chrome/Salad lock their cookie DBs while running, so scraping them usually fails.

**Settings → Connect Salad account:** opens a private Edge/Chrome profile; sign in once.
Auth is captured locally and never shown. Manual paste stays under Advanced as fallback.

## Name

**ChopWatch** — watch Chopping without pretending to see inside the job.
