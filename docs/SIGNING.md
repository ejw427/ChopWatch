# Windows signing (no paid certificate)

ChopWatch does **not** buy a commercial Authenticode certificate. Paid OV/EV certs calm SmartScreen fastest, but they are optional for this project.

## What ships today

Every GitHub Release includes:

| Artifact | Role |
| --- | --- |
| Setup / portable `.exe` | Built unsigned unless SignPath secrets are configured |
| `SHA256SUMS.txt` | Hashes of those `.exe` files for integrity checks |

SmartScreen may still show **Windows protected your PC** on unsigned downloads. That is expected. Prefer verifying the hash, then *More info* → *Run anyway* if you trust the release.

### Verify a download (PowerShell)

```powershell
Get-FileHash .\ChopWatch-Setup-*.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

The hex digests should match.

## Free Authenticode: SignPath Foundation (optional)

[SignPath Foundation](https://about.signpath.io/product/open-source) signs open-source Windows builds for free. The publisher users see is **SignPath Foundation** (not your personal name). Requirements include:

1. **OSI license** — this repo uses MIT (`LICENSE`)
2. **Public GitHub repo** — private repos do not qualify
3. **Automated CI build** — already present (`.github/workflows/release.yml`)
4. **SignPath project + API token** — apply via SignPath OSS onboarding, then set GitHub secrets

### Secrets / variables (after approval)

| Name | Where | Purpose |
| --- | --- | --- |
| `SIGNPATH_API_TOKEN` | Actions secret | Submit signing requests |
| `SIGNPATH_ORGANIZATION_ID` | Actions variable or secret | SignPath org UUID |
| `SIGNPATH_PROJECT_SLUG` | Actions variable (default `chopwatch`) | Project slug |
| `SIGNPATH_SIGNING_POLICY_SLUG` | Actions variable (default `release-signing`) | Policy slug |
| `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | Actions variable (default `windows-installers`) | Artifact config |

Until those are set, the release workflow **skips** SignPath and publishes unsigned builds + `SHA256SUMS.txt`.

Self-signed certificates do **not** clear SmartScreen for other people. ChopWatch keeps a **test** public cert only for local verification of the SignPath pipeline:

| File | Role |
| --- | --- |
| `certs/chopwatch-test-signing.cer` | Public test cert from SignPath (no private key) |
| `scripts/trust-test-cert.ps1` | Installs it into *your* CurrentUser Root + TrustedPublisher stores |

```powershell
pwsh -File scripts/trust-test-cert.ps1
```

Use a SignPath policy purpose of **Test signing** with that cert. **Release signing** for downloads should wait for the SignPath Foundation certificate after OSS approval.

## Related

- Release workflow: `.github/workflows/release.yml`
- Packaging: `scripts/pack-desktop.ps1`
- Product roadmap: [PROJECT_PLAN.md](PROJECT_PLAN.md)
