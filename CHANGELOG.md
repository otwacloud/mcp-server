# Changelog

## 0.4.2 — 2026-06-19

- **Docs: Windows credentials are per-template.** `otwa_get_server_credentials` and `otwa_reset_server_password` tool descriptions no longer imply the Windows admin user is always `Administrator` / that credentials are root-SSH only. The Windows admin username is per-template (Administrator on Windows Server, **OtwaCloud** on Windows 11, whose built-in Administrator is disabled) — always use the returned `username` field. Description-only; response shape and behavior unchanged. (Pairs with the otwa-cloud-api `getCredentials` fix that now returns the correct per-template username.)

## 0.4.1 — 2026-05-31

- **Change: per-server snapshot cap lowered 10 → 2.** `otwa_create_snapshot` now allows at most **2** snapshots per server (was 10). The limit is enforced API-side, which returns a `validation_failed` error when full — delete one with `otwa_delete_snapshot` first. Tool description + docs updated to match.

## 0.4.0 — 2026-05-31

- **New: server snapshots.** Four tools for the full snapshot lifecycle, backed by real vSphere snapshots:
  - `otwa_list_snapshots` (scope: `servers:read`) — list a server's point-in-time disk snapshots.
  - `otwa_create_snapshot` (scope: `servers:write`) — capture a disk snapshot (max 10/server).
  - `otwa_revert_snapshot` (scope: `servers:destroy`) — roll the disk back to a snapshot. DESTRUCTIVE; guarded by `confirm` + `iAcknowledgeDataLoss` + an `expectedLabel` typo-guard (same pattern as `otwa_destroy_server`).
  - `otwa_delete_snapshot` (scope: `servers:write`) — remove a snapshot; non-destructive to live data, single `confirm` flag.
- Brings the toolset to 30 tools.

## 0.3.0 — 2026-05-26

- **🔧 Fix: default API base now includes `/api` global-prefix** (`https://api.otwa.cloud/api`). otwa-cloud-api uses NestJS `setGlobalPrefix('api')` so every endpoint is under `/api/v1/*`. v0.1.x + v0.2.0 shipped with the prefix missing — every stdio tool call 404'd. Latent bug closed.
- **Optional fire-and-forget telemetry** for tool calls. Posts `{toolName, transport, success, errorCode?, durationMs, clientLabel?}` to `api.otwa.cloud/api/v1/integrations/mcp/usage` after every invocation, using the caller's own API key.
  - **Hosted** (`mcp.otwa.cloud`): always on. We already see every request server-side; logging metadata has no privacy delta.
  - **stdio**: OFF by default. Set `OTWA_TELEMETRY=1` to opt in. The local CLI never makes surprise network calls without an explicit env flip.
- Single integration point: `instrumentRegisterTool()` in `_register.ts` monkey-patches `server.registerTool` so every tool — current and future — is auto-instrumented. Per-surface tool files don't need to know about telemetry at all.
- Failure classification: `classifyErrorFromResult()` maps `isError: true` results back to typed codes (`unauthorized | forbidden | payment_required | not_found | conflict | validation_failed | rate_limited | upstream_error | error`) so dashboard counters bucket failures meaningfully.

> v0.2.0 tag exists on GitHub but never published to npm (Actions outage 2026-05-26 dropped the event). v0.3.0 supersedes it with all 0.2.0 content + the prefix fix above.

## 0.2.0 — 2026-05-26

- New tool `otwa_get_reseller_state` (scope: `account:read`) — returns reseller tier, discount %, rolling 30-day GMV, and next-tier progression. Useful for resellers asking the AI "how close am I to the next tier?"
- Expanded README install instructions: now covers Claude Code, **Claude Desktop**, Cursor, Windsurf, **VS Code (Copilot Agent Mode)**, Zed, Continue, and **OpenCode**.
- Added README status badges: npm version, CI, license, Node engines, MCP transport.
- Added vitest scaffold under `test/` — 16 smoke tests for `_helpers`, `errors`, and the full tool-registration surface. CI now runs `pnpm test` on every push (Node 20 + 22 matrix).

## 0.1.1 — 2026-05-25

- Renamed bin entries from `otwa-mcp` / `otwa-mcp-http` to `mcp-server` / `mcp-server-http` so the unscoped package name matches the default bin — this makes `npx -y @otwa/mcp-server` resolve correctly (npx requires the bin name to match the unscoped package name when multiple bins exist).
- Help text now references `npx @otwa/mcp-server` instead of the old `otwa-mcp` binary.

## 0.1.0 — 2026-05-25

Initial release.

- 20 tools covering account, catalog, servers (CRUD + power + reinstall + stats + SSO), networking PTR, billing (read-only), wallet (read-only) and webhooks.
- Bearer-key auth against `https://api.otwa.cloud/v1/*`.
- Idempotency-Key auto-generation for `create_server` and `reinstall_server`.
- Three-layer safety on destructive operations: `confirm` flag, `expectedLabel` typo-guard, backend scope enforcement.
- Stdio transport; remote HTTP transport planned for 0.2.
