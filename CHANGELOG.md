# Changelog

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
