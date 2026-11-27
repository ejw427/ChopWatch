# Privacy Policy — ChopWatch

ChopWatch is a **local** dashboard for Salad Chopping on your PC. It is built by Eric Welch / Welch Software and is **unofficial** — not affiliated with Salad Technologies.

## What stays on your machine

ChopWatch runs entirely on `127.0.0.1`. It does not send analytics, advertising IDs, or account data to Welch Software.

Local files under `helper/data/` (gitignored) may hold:

- Alert and API preference toggles
- An optional Salad web `auth` cookie you choose to connect
- Runtime phase/alert state
- A private browser profile used only for the Connect Salad flow

Treat the auth cookie like a password. Clearing it in Settings removes it from disk.

## What ChopWatch reads

| Source | Purpose |
| --- | --- |
| Bowl logs under Salad ProgramData | Work phase, wallet lines, heartbeat, chopping-hour estimates |
| `nvidia-smi` + OS metrics | GPU / host load |
| Salad preferences / config text | Chopping pause flags and related prefs |
| Optional `app-api.salad.com` | Official balance, earning rate, 30-day history (only if you enable it) |

ChopWatch does **not** read `token.txt`, open WSL customer containers, or inspect job payloads / encrypted workload images.

## Network

- UI and helper talk to each other on localhost only.
- Opt-in Salad API calls go to Salad’s servers using the cookie you provided.
- Connect Salad may launch a private Edge/Chrome profile so you can sign in; auth is captured locally and never displayed in the UI.

## Contact

Questions: [support@welchsoftware.net](mailto:support@welchsoftware.net)
