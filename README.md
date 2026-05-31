# @otwa/mcp-server

[![npm version](https://img.shields.io/npm/v/@otwa/mcp-server.svg?style=flat)](https://www.npmjs.com/package/@otwa/mcp-server)
[![CI](https://github.com/otwacloud/mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/otwacloud/mcp-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/node/v/@otwa/mcp-server.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-blue.svg)](https://modelcontextprotocol.io)

Official Model Context Protocol server for [otwa.cloud](https://otwa.cloud).
Provision and manage servers from Claude Code, Claude Desktop, Cursor, Windsurf,
VS Code, Zed, Continue, OpenCode, or any other MCP-capable AI tool — just by
talking to it.

```
> "Spin up a 4 vCPU Ubuntu 22 box in Frankfurt called prod-api-01"

Claude → calls otwa_list_products, otwa_list_os_templates, otwa_list_regions
       → quotes the monthly price, asks you to confirm
       → calls otwa_create_server
       → returns the new server's IP and SSH credentials
```

## Two ways to use this

| Option | Best for | Install |
|---|---|---|
| **Hosted (no install)** | Anyone with an MCP client that supports remote HTTP | Just add `https://mcp.otwa.cloud/mcp` to your client config with `Authorization: Bearer otwa_…` |
| **Local stdio** | Older MCP clients, offline use, total control over the binary | `npx -y @otwa/mcp-server` — full instructions below |

### Hosted endpoint (recommended)

```
URL:     https://mcp.otwa.cloud/mcp
Auth:    Authorization: Bearer otwa_…           (API key)
   OR    Authorization: Bearer otwa_at_…        (OAuth 2.0 device-code, RFC 8628)
Health:  GET https://mcp.otwa.cloud/healthz
```

The hosted server is stateless — every request is authenticated independently. No session state lives on `mcp.otwa.cloud`, so a leaked session id is useless. Both API keys and OAuth tokens are first-class — pick what your client supports.

### OAuth 2.0 device-code flow

Spec-compliant MCP clients can discover authorization automatically:

| Endpoint | Spec |
|---|---|
| `GET https://mcp.otwa.cloud/.well-known/oauth-protected-resource` | RFC 9728 |
| `GET https://api.otwa.cloud/.well-known/oauth-authorization-server` | RFC 8414 |
| `POST https://api.otwa.cloud/api/oauth/register` (DCR, no auth) | RFC 7591 |
| `POST https://api.otwa.cloud/api/oauth/device/code` | RFC 8628 §3.1 |
| `POST https://api.otwa.cloud/api/oauth/token` | RFC 8628 §3.4 |
| `POST https://api.otwa.cloud/api/oauth/revoke` | RFC 7009 |

Flow:
1. Client POSTs to `/oauth/register` with `client_name + scope` → gets a `client_id`.
2. POSTs to `/oauth/device/code` → receives `user_code` (XXXX-YYYY) + `verification_uri=https://otwa.cloud/oauth/device`.
3. User opens the URI, signs in, approves the requested scopes.
4. Client polls `/oauth/token` at the returned interval → receives `otwa_at_…` access + `otwa_rt_…` refresh tokens.
5. Use as `Authorization: Bearer otwa_at_…` against `/mcp` or any `/api/v1/*` endpoint.
6. Before access expires, refresh: POST `/oauth/token` with `grant_type=refresh_token` + the `otwa_rt_…` value → fresh pair. Refresh tokens are single-use — replaying one fails with `invalid_grant`.
7. User can revoke any time at [dashboard/api](https://otwa.cloud/dashboard/api) → OAuth grants tab.

A 401 from `/mcp` includes `WWW-Authenticate: Bearer realm="otwa-mcp", resource_metadata="…"` per RFC 9728 §5.3 to point clients at the discovery URL.

## Quick start (local stdio)

### 1. Generate an API key

Go to [otwa.cloud/dashboard/settings/api-keys](https://otwa.cloud/dashboard/settings/api-keys)
and create a key with the scopes you want the AI to use.

Recommended starter scopes:

| Scope | Why |
|---|---|
| `account:read` | Read account info, product catalogue, regions |
| `servers:read` | List servers, view stats, view credentials |
| `servers:write` | Create servers, change power state, rename, reset password |
| `billing:read` | Read invoices and wallet balance |

Leave **`servers:destroy` unchecked** unless you really want the AI to be able
to permanently delete servers — even with confirmation guards, scope-level
denial is the strongest defence.

Copy the `otwa_…` key shown once on the dashboard; it cannot be re-displayed.

### 2. Install in your AI client

#### Claude Code

```bash
claude mcp add otwa npx -y @otwa/mcp-server
claude mcp env otwa OTWA_API_KEY=otwa_xxxxxxxxxxxxxxxxxxxx
```

#### Claude Desktop

Add to your `claude_desktop_config.json`
(`~/Library/Application Support/Claude/` on macOS,
`%APPDATA%\Claude\` on Windows):

```json
{
  "mcpServers": {
    "otwa": {
      "command": "npx",
      "args": ["-y", "@otwa/mcp-server"],
      "env": {
        "OTWA_API_KEY": "otwa_xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

#### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "otwa": {
      "command": "npx",
      "args": ["-y", "@otwa/mcp-server"],
      "env": {
        "OTWA_API_KEY": "otwa_xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

#### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "otwa": {
      "command": "npx",
      "args": ["-y", "@otwa/mcp-server"],
      "env": {
        "OTWA_API_KEY": "otwa_xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

#### VS Code (Copilot Agent Mode)

Add to `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "otwa": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@otwa/mcp-server"],
      "env": {
        "OTWA_API_KEY": "otwa_xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

#### Zed

Add to `~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "otwa": {
      "command": {
        "path": "npx",
        "args": ["-y", "@otwa/mcp-server"],
        "env": { "OTWA_API_KEY": "otwa_xxxxxxxxxxxxxxxxxxxx" }
      }
    }
  }
}
```

#### Continue

Add to `~/.continue/config.json` under `experimental.modelContextProtocolServers`:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "@otwa/mcp-server"],
          "env": { "OTWA_API_KEY": "otwa_xxxxxxxxxxxxxxxxxxxx" }
        }
      }
    ]
  }
}
```

#### OpenCode

Add to `opencode.json` (or `opencode.jsonc`) in your config directory:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "otwa": {
      "type": "local",
      "command": ["npx", "-y", "@otwa/mcp-server"],
      "environment": { "OTWA_API_KEY": "otwa_xxxxxxxxxxxxxxxxxxxx" },
      "enabled": true
    }
  }
}
```

### 3. Try it

Restart your client and ask:

- *"What's on my otwa.cloud account?"*
- *"List my servers"*
- *"How much would a 4 vCPU plan cost per month?"*
- *"Create a new Ubuntu 22 server and call it test-box-1"*

## Tools

30 tools across seven surfaces:

### Account & catalogue (read-only, `account:read`)
- `otwa_account` — current account, balance, tier
- `otwa_list_products` — available plans with prices
- `otwa_list_regions` — deploy regions
- `otwa_list_os_templates` — OS images

### Servers
- `otwa_list_servers` — list all servers *(servers:read)*
- `otwa_get_server` — full detail for one server *(servers:read)*
- `otwa_get_server_credentials` — SSH credentials *(servers:read, sensitive)*
- `otwa_get_server_stats` — live CPU/RAM/disk metrics *(servers:read)*
- `otwa_create_server` — provision new server *(servers:write)*
- `otwa_rename_server` — change label *(servers:write)*
- `otwa_power_server` — start/stop/reboot *(servers:write)*
- `otwa_reset_server_password` — rotate root password *(servers:write)*
- `otwa_reinstall_server` — wipe and reinstall OS *(servers:destroy)*
- `otwa_destroy_server` — permanently terminate *(servers:destroy)*
- `otwa_list_snapshots` — list a server's disk snapshots *(servers:read)*
- `otwa_create_snapshot` — capture a disk snapshot, max 10/server *(servers:write)*
- `otwa_revert_snapshot` — roll the disk back to a snapshot *(servers:destroy)*
- `otwa_delete_snapshot` — remove a snapshot *(servers:write)*
- `otwa_get_dashboard_sso` — 5-min SSO link to dashboard *(servers:read or account:read)*

### Networking
- `otwa_list_server_ips` — IPs on a server *(servers:read)*
- `otwa_set_ptr` — set reverse DNS *(servers:write)*
- `otwa_delete_ptr` — clear reverse DNS *(servers:write)*

### Billing (read-only)
- `otwa_list_invoices` *(billing:read)*
- `otwa_get_invoice` *(billing:read)*
- `otwa_list_transactions` *(billing:read)*
- `otwa_get_wallet_balance` *(billing:read)*

### Webhooks
- `otwa_list_webhooks` *(webhooks:read)*
- `otwa_create_webhook` *(webhooks:write)*
- `otwa_delete_webhook` *(webhooks:write)*

### Reseller
- `otwa_get_reseller_state` — reseller tier, discount, rolling 30-day GMV, next-tier progression *(account:read)*

## Safety

Destructive tools (`otwa_destroy_server`, `otwa_reinstall_server`, `otwa_revert_snapshot`) require:

1. **`confirm: true`** and **`iAcknowledgeDataLoss: true`** in the tool call
2. **`expectedLabel`** matching the server's current label (typo-guard, only on destroy)
3. **`servers:destroy` scope** on the API key, enforced server-side

Medium-risk tools (`otwa_power_server` for stop/reboot, `otwa_reset_server_password`,
`otwa_delete_webhook`) require **`confirm: true`** only.

`otwa_create_server` and `otwa_reinstall_server` use auto-generated idempotency
keys so transient LLM retries cannot double-provision or double-bill.

## Environment variables

| Var | Required? | Default | Description |
|---|---|---|---|
| `OTWA_API_KEY` | yes | — | Your `otwa_…` API key |
| `OTWA_API_BASE` | no | `https://api.otwa.cloud` | API base URL (override for staging) |
| `OTWA_TELEMETRY` | no | off | Set to `1` to opt in to anonymous usage pings |

## Troubleshooting

**"OTWA_API_KEY is not set"** — Restart your editor after setting the env var.
Some clients only read env on cold-start.

**"API key is missing required scope(s): servers:destroy"** — Your key wasn't
granted that scope. Revoke it at
[/dashboard/settings/api-keys](https://otwa.cloud/dashboard/settings/api-keys)
and create a new one.

**"Refusing to destroy server X: expectedLabel does not match"** — Safety guard
firing. Re-fetch the server label via `otwa_get_server`, confirm with the user,
and call again.

## License

MIT — see [LICENSE](LICENSE). Source on GitHub:
[github.com/otwacloud/mcp-server](https://github.com/otwacloud/mcp-server).
The published npm tarball ships plain, unminified JavaScript that mirrors
the repo at the same tag.
