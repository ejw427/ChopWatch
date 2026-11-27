# Testing

How versions, docs HTML, and unit tests stay in sync.

## Version numbers

Root `package.json` is the source of truth (`MAJOR.MINOR.PATCH`, for example `0.5.0`).

- **Every real commit** (pre-commit hook in `.githooks/pre-commit`) increments PATCH and syncs `helper/package.json` + `web/package.json`.
- Major / minor stay put unless you edit them by hand for a milestone.
- Helper `/health` and snapshot `product.version` read the root version via `helper/src/version.js`.

Enable hooks once after clone:

```powershell
pwsh -File scripts/setup-git-hooks.ps1
```

Or:

```powershell
npm run hooks
```

## Markup → HTML

Do not hand-edit `docs/*.html` or `README.html`. Edit markdown, then:

```powershell
npm run docs:html
```

Open rendered pages in the system browser:

```powershell
npm run docs:view
```

CI fails if generated HTML is stale (`git diff --exit-code` after `docs:html`).

## Unit tests

Vitest covers pure helper logic (Bowl parsers, hours integration, wallet lines, alerts, log timestamps).

```powershell
npm test
```

Watch mode:

```powershell
npm run test:watch --prefix helper
```

## CI

`.github/workflows/ci.yml` on `main` / `dev`:

1. `npm ci` (root, helper, web)
2. `npm test`
3. `npm run build --prefix web`
4. Regenerate docs HTML and assert no drift
