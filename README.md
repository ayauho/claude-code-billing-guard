# Breaker 0.1 — Claude Code Billing Guard

Watches whether Claude Code is billing your Pro/Max subscription or your
pay-per-token API key, and warns you the instant it switches. Free, local,
no telemetry, no network calls.

## Why this exists

Claude Code can silently and sometimes irreversibly switch from subscription
billing to API billing — documented across multiple long-open GitHub issues
on `anthropics/claude-code` (#62770, #44669, #34486, #40660, #2944, #27990,
#43260). The existing usage-tracker extensions answer "how much have I
spent" — none of them answer "am I even in the billing mode I think I'm in."
This does.

## Honest limitations — read before relying on this

- **The credential-file detection is a best guess.** It was built from a
  research document's reference to a `credentials/default.json` file, not
  from confirmed access to every Claude Code version's actual on-disk
  schema. If status shows "Unknown" instead of a clear verdict, that's the
  tool correctly refusing to guess rather than a bug. Open the file at the
  path in `breaker.credentialPath` (VS Code settings) yourself, check its
  real field names, and set the override if needed.
- **The environment-variable signal is the reliable one.** If
  `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set anywhere in the
  environment your terminal/VS Code session inherits, this tool will catch
  it. That's the documented trigger behind every issue cited above.
- **"Restore subscription mode" does not auto-run anything.** It opens a
  plain read-only document with suggested next steps, for you to review and
  copy into a terminal yourself if you want to. It deliberately doesn't type
  anything into a live shell — even harmless comment lines get recorded in
  shell history, which isn't a footprint this tool should leave. Exact CLI
  syntax can change between versions; this tool isn't going to guess and
  execute on your behalf.

## Running it locally (not yet published to the Marketplace)

```bash
cd breaker-extension
npm install -g @vscode/vsce   # one-time, if you don't have it
```

Then either:

- **Quick test:** open this folder in VS Code, press `F5` to launch an
  Extension Development Host window. Breaker will activate there.
- **Install as a real extension:** `vsce package` to produce `breaker-0.1.0.vsix`,
  then in VS Code: Extensions view → `...` menu → "Install from VSIX...".

## Settings

| Setting | Default | What it does |
|---|---|---|
| `breaker.credentialPath` | `""` (auto-detect) | Override the path to Claude Code's local credential file if auto-detection doesn't find it on your machine. |
| `breaker.pollIntervalMs` | `15000` | How often to re-check, in milliseconds. |

## What this is not

Not a usage or cost dashboard — that space already has solid free tools.
Not a replacement for Anthropic's own auth system. Not connected to any
server. If you want team-wide alerts when a teammate's seat drifts onto
metered billing, that's a 1.0 idea, gated on whether 0.1 actually gets used
by the people who already filed these bugs.