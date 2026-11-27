# Certificates

## `chopwatch-test-signing.cer`

Public half of the SignPath **self-signed test** code-signing certificate (no private key).

- **Does not** clear SmartScreen for strangers
- Trust it only on machines where you want to test SignPath-signed *test* builds

Install on this PC:

```powershell
pwsh -File scripts/trust-test-cert.ps1
```

For real SmartScreen-calming signatures, use SignPath Foundation release signing — see [docs/SIGNING.md](../docs/SIGNING.md).
