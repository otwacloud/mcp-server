# Changelog

## 0.1.0 — unreleased

Initial release.

- 20 tools covering account, catalog, servers (CRUD + power + reinstall + stats + SSO), networking PTR, billing (read-only), wallet (read-only) and webhooks.
- Bearer-key auth against `https://api.otwa.cloud/v1/*`.
- Idempotency-Key auto-generation for `create_server` and `reinstall_server`.
- Three-layer safety on destructive operations: `confirm` flag, `expectedLabel` typo-guard, backend scope enforcement.
- Stdio transport; remote HTTP transport planned for 0.2.
