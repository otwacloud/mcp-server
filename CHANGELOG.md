# Changelog

## 0.8.0 — 2026-08-18

- **New surface: capacity pools — 11 tools.** Pools had existed on the API and in the dashboard since 2026-08-16 and were reachable from here only by their side effect (a server built into one). You can now list the pool products and their per-unit prices (`otwa_list_pool_products`), price a shape without buying it (`otwa_quote_pool`), buy one (`otwa_create_pool`), list and inspect what you own (`otwa_list_pools`, `otwa_get_pool`), read the rates a pool was **sold** at (`otwa_get_pool_pricing`), price and apply a resize (`otwa_quote_pool_resize`, `otwa_resize_pool`), manage the pool's own IPv4 block (`otwa_list_pool_ips`, `otwa_assign_pool_ips`) and tear one down (`otwa_terminate_pool`). Tool count is now 47.
- **The two money paths are gated and quotable.** `otwa_create_pool` and `otwa_resize_pool` both require `confirm: true`, and each has a quoting tool beside it that returns the exact figure the write will charge — including the prorated `chargeNow` on a resize, because **growing a pool is a purchase** while shrinking is not refunded. `otwa_terminate_pool` takes the full destructive guard plus an `expectedLabel` typo-guard, since it powers off every server in the pool at once.
- **`otwa_create_server` now documents `poolId` and `ipCount`.** A server built into a pool is FREE — checked against the pool's quota rather than the wallet, never charged, never renewed — so there is no price to quote for it, and add-ons are refused on it. `ipCount` chooses how many of the pool's own addresses it gets; **`ipCount: 0` is a private-only machine with no public interface, no default route and no internet at all**, which is what lets a pool run more servers than it has addresses.
- Unit descriptions spell out the block sizes everywhere they appear, because they are the easy thing to get wrong: `ram2gb` counts 2 GB blocks and `ip16` counts blocks of sixteen addresses.

## 0.7.0 — 2026-08-16

- **New tools: `otwa_list_addons` (`servers:read`), `otwa_purchase_addon` and `otwa_remove_addon` (`servers:write`)** — the add-on surface was entirely missing. `otwa_create_server` accepted an `addons` array while nothing here could tell you what a valid add-on id was; its own description pointed at an `otwa_list_addons`-equivalent that did not exist, so add-ons could only be ordered by guessing. `otwa_list_addons` returns extra IPs, /24 class blocks, the SEO IP Pack (7 dedicated IPs each from a different /24) and backups, with the wholesale price this key is charged, `retailPrice`, the prorated amount, and `owned` / `ownedByType` — only one add-on per type can be active. `otwa_purchase_addon` requires `confirm: true` because it charges the wallet immediately and raises the recurring price. `otwa_remove_addon` cancels one: no prorated refund, and for IP add-ons the addresses stop routing at once. `otwa_create_server`'s `addons` description now explains how to look ids up instead of naming a phantom tool. Tool count is now 36.

## 0.6.0 — 2026-07-07

- **New tools: `otwa_list_plan_options` (`servers:read`) + `otwa_change_server_plan` (`servers:write`)** — resize a server in place. `otwa_list_plan_options` returns the plans a server can switch to (same product family, same disk size). `otwa_change_server_plan` switches to one of them, applying a new vCPU/RAM allocation — the server reboots (~1 min) and disk is never changed. Only the recurring price changes (no proration on up-switch, no credit on down-switch). `otwa_change_server_plan` requires `confirm: true` because it reboots. Powers the new Cloud Router (MikroTik CHR) line, where you move between Router S/M/L. Tool count is now 33.

## 0.5.0 — 2026-06-28

- **New tool: `otwa_list_iso_library`** (`account:read`) — lists the ready-to-boot custom ISO images (MikroTik RouterOS, VyOS, FreeBSD, etc.). To deploy one, call `otwa_create_server` with `os: "custom-iso"` and `osTemplate` set to the ISO `id` from this tool. `otwa_create_server`'s `os`/`osTemplate` descriptions now document the custom-ISO path. Tool count is now 31.

## 0.4.3 — 2026-06-22

- **Docs: `otwa_get_server_stats` reports power state independently of telemetry.** The tool description now clarifies that `powerState` is always present for a provisioned server (read from the hypervisor, independent of the guest agent), while the `live` metrics block is `null` when the guest agent (VMware Tools) is quiet — meaning "running, no telemetry", **not** offline. A stopped server returns `powerState: POWERED_OFF` with `live: null`. Description-only; response shape and behavior unchanged. (Pairs with the otwa-cloud-api `/servers/:id/stats` hardening that always surfaces `powerState` and never nulls the whole response on a single sub-call failure.)

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
