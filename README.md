# 净界 (JingJie) · Windows deep clean, software uninstall, startup optimization

**简体中文** ([README.zh-CN.md](./README.zh-CN.md)) | English

> 净界 is a Windows-only maintenance app that cleans caches and temp files, uninstalls software,
> and turns off login-time startup entries. Everything happens on the local machine: no network,
> no accounts, no telemetry. Scans are read-only; nothing is changed until you confirm, and every
> entry is laid out with its absolute path, size, elevation need and irreversibility **before** it runs.

The repository is the **recovered source tree** of the shipped `0.2.0-beta.6` installer plus the
security work layered on top — provenance and limits in [`docs/SOURCE-RECOVERY.md`](./docs/SOURCE-RECOVERY.md).

## What it does

Four sections, each backed by real capability (`scripts/providers/*.ps1` + the controllers in `src/main/`).
The desktop UI and the Agent API drive **the same objects with the same guards** — there is no second
implementation to drift.

| Section | What it touches | Where it comes from |
| --- | --- | --- |
| Deep clean | Six fixed rules: user & system temp, crash dumps, Windows error-report archive, Edge and Chrome caches | `rules.js` → `cleanup-engine.js` (scan → re-validate per file → delete or quarantine) |
| Extended clean | Rebuildable caches: GPU shader caches, thumbnail/icon caches, Discord/Slack/VS Code code+GPU caches, npm/pip/NuGet download caches, plus browser profiles **discovered at runtime** (Chrome/Edge/Firefox) | `aggressive-rules.js` → `aggressive-scan.js` |
| Software uninstall | Real inventory from four registry Uninstall views + `Get-AppxPackage`; runs only the software's own uninstaller (registered exe / MSI / APPX) | `software-inventory.js`, `software-policy.js`, `uninstall-plan.js`, `software-*.ps1` |
| Startup optimization | Real login entries: Run/RunOnce keys, Startup folder, non-Microsoft scheduled tasks; reversible disable + restore | `startup-inventory.js`, `startup-actions.js`, `startup-*.ps1` |

Every rule carries honest wording: what it removes, what happens next, and **what is preserved**
(the browser-cache rule states that bookmarks, history, cookies, passwords, extensions, site data and
sessions are kept). Startup impact text lives in `startup-effects.js` — no invented "saves N seconds".

## What it must never touch

Not a promise — a judgment in code, each one covered by a test that goes red:

- **Personal and cloud-synced folders** (Desktop / Documents / Downloads / Pictures / Videos / Music /
  OneDrive) plus `%WindowsRoot%\System32`, `WinSxS`, `DriverStore`:
  `path-guard.js` `protectedRoots()`, re-checked before **every** scan and every delete — lexically and
  again physically (`lstat` + `realpath`). Symbolic links and reparse points are refused outright.
- **Unsafe environment = no action**: if any required env value is missing, `environmentIsSafe()` says
  *unsafe* (it does not crash and it does not guess), and every rule is refused for that call.
- **System components**: Windows updates / KB packages / VC++ redistributables / Windows Desktop Runtime,
  plus antivirus, VPN, input methods and driver/firmware categories; anything installed at
  `WindowsRoot` or directly at a whole `Program Files` root — `software-policy.js`.
- **No shell through uninstallers**: a uninstall command line whose host is `cmd/cscript/wscript/mshta/
  rundll32/regsvr32/powershell/pwsh` is skipped as `blocked-uninstall-host` (`uninstall-plan.js`
  `BLOCKED_EXECUTABLES`). Every child process runs with `shell:false` and a timeout, elevation included
  (`elevation.js`).
- **One elevated action per elevation prompt**: official maintenance actions are exactly two allowlisted
  ids (`delivery-optimization`, `component-cleanup`); execution is
  `fs-helper run-maintenance-action-elevated <id>` with `shell:false` and a timeout, and a request for
  more than one id is refused (`maintenance.js` `ALLOWED_ACTIONS`). Exit code 3010 is reported as
  "restart required", not as success.
- **Never pre-selected**: uninstall and startup items are *never* default-checked, and irreversible
  actions (empty Recycle Bin) need `acknowledgeIrreversible` on top of `confirm`.
- **Interfaces accept ids, never paths or commands**: `request-validators.js` enforces id-only request
  shapes, so a compromised renderer cannot say "delete this path"; senders also have to pass the
  frame-URL check in `ipc.js`.
- **The Agent API refuses web pages**: only `127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>` hosts,
  `Origin`/`Referer` compared against a fixed loopback allowlist (**never** against the request's own
  `Host` — that is the DNS-rebinding hole), token required on every non-GET, no wildcard CORS anywhere.
  Details in [`agent/README.md`](./agent/README.md).

## Recoverability and ledgers

- Dump/report rules run in **quarantine** mode: files move into a 7-day quarantine with SHA-256 checks
  and can be restored from the UI — not destroyed on the spot.
- Startup disabling is **reversible**: the registry value is exported to `.reg` and Startup-folder files
  are renamed into a backup root; restore goes back through the same path.
- Each execution reports per item (`succeeded / skipped / failed / refused / reboot-required`) with the
  real reason (`protected-root`, `symbolic-link`, `preview-required`, `software-locked`…). Retry re-runs
  only genuine failures (`retry-policy.js`) — resending a deliberate refusal is a way to wear the guard down.
- Ledgers: the UI writes `%APPDATA%\jingjie`; the Agent side defaults to the repo-local `.data/agent`,
  and read-only tools never write into the user's real AppData.

## Development and verification

Node.js ≥ 22 (measured on v24.18.0). The Agent surface, tooling and tests have **zero runtime
dependencies**; `electron` is only needed to run the UI in dev mode or to package.

Every command below was actually run on this machine and passes:

```bat
npm run check          :: static integrity: main/scripts/HTML/imports/doc references all resolve; 8 agent tools well-declared
npm test               :: 23 unit tests (path guard, storage, retry policy, renderer exports, agent local guard)
npm run selftest       :: boots the real server and hits the real endpoints: contract + 5 guard checks, 15 total
npm run smoke:runtime  :: runtime smoke: installer + fs-helper present, 5 providers, a real PowerShell inventory run
npm run verify         :: check + test + selftest in one go
```

Latest measured run: `check` all green (93 relative specifiers resolve, 50 in-repo doc references exist, 8 tools declared),
`test` 23/23, `selftest` 15/15, `smoke:runtime` 6/6 (`software-inventory.ps1` returned 207 real entries).

Agent API (port **8796** in the local registry):

```bat
npm run agent:serve    :: listens on 127.0.0.1:8796 only; bumps +1 and writes agent/.endpoint if taken
npm run agent:mcp      :: stdio MCP bridge (initialize / tools/list / tools/call)
```

Neither the self-test nor the bridge needs any user setup: the local token required for non-GET calls is
generated on server start and persisted (0600) in the per-user app-data directory that both sides read.
The 8 tools (7 read + 1 exec) and the guard semantics are documented in
[`agent/README.md`](./agent/README.md).

`src/renderer/index.html` loads the recovered source directly (`./app.js`) — no bundler, no install step.
Where that tree came from, how far it can be re-derived, and what could not be recovered:
[`docs/SOURCE-RECOVERY.md`](./docs/SOURCE-RECOVERY.md).

## Known gaps, stated plainly

- The repo does **not** contain the source of `fs-helper`, the native delete guard that actually enforces
  the protected-root manifest while deleting. The shipped binary sits at
  `JingJie-runtime/resources/fs-helper/JingJieFsHelper.exe`, but `vendor/` and `*.exe` are gitignored.
  A package built from a clean clone therefore runs **without** that layer: extended cleanup and
  elevated actions fail closed with `fs-helper-missing` instead of quietly skipping it.
- The original `app.asar` is not on this machine, so `npm run extract:asar` currently fails with ENOENT,
  and `npm run recover:source` refuses to overwrite an existing `src/` (exit code 4) because it emits the
  raw recovery while the repo carries the audited version. See `docs/SOURCE-RECOVERY.md` §4 and §7.
- Packaging: the repository has **no working packaging path yet** — `build.extraResources` points at the
  missing `vendor/fs-helper`, `electron-builder` is not a dependency and there is no `dist` script.
  Being addressed in the next pass; until then, don't treat "this repo builds an installer" as fact.
- Windows has no POSIX permission bits, and `%APPDATA%` on this machine carries inherited read access for
  foreign groups, so the token's "0600" is a request in code, not a guarantee from the OS — recorded in
  `agent/README.md`.
- Code comments reference **four review/runbook documents that were not recovered** with the artifact
  (`docs/SECURITY-REVIEW.md`, `docs/PRODUCT-REVIEW.md`, `docs/SOURCE-REVIEW.md`, `docs/RUNBOOK.md`) —
  26 mentions in total. Each finding's substance lives in the comment right next to the marker, and
  `docs/SOURCE-RECOVERY.md` §6/§7 lists them. This repo does **not** ship fabricated copies of those documents.
- No network means no cloud results, no account sync, no background update checks. Anything the UI does
  not have, this README does not claim it has.

## License

UNLICENSED (see `package.json`). Personal local tooling.
