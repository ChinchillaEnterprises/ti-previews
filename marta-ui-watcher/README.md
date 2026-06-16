# marta-ui-watcher

The existing screenshot-diff system Jamie runs locally. Posted here as a read-only reference for Keeks's Galileo build.

## Files

| File | Purpose |
|---|---|
| `index.js` | Main entry point — orchestrates the watcher loop |
| `ui-change-detector.js` | Diff logic — compares the current iq-dev page against the Marta-approved canonical mockup |
| `mockup-generator.js` | Renders mockups when a diff is found, for human review |
| `github-updater.js` | Files GitHub issues when a diff exceeds the threshold |
| `webhook-server.js` | Webhook listener (Fathom + others) |

## Runtime context

- Runs locally on Jamie's MacBook via a launchd cron (`com.chinchilla.marta-ui-watcher`)
- Reads `config/secrets.json` (NOT included here — credentials live outside this snapshot)
- Targets `iq-dev.et.gobeon.com` and compares against `automations/output/ClaudeCanvas-BeonIQ-VoiceOrb-OptionC-Approved.html`

## For Galileo

Per the team direction, the day-one move is to **extend this in place** rather than rebuild from scratch. The long-term plan is to migrate the watcher onto Galileo's EC2 box so the screenshot work stops depending on Jamie's laptop being awake. For now, fork/extend the patterns here.
