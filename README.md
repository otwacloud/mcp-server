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

Go to [otwa.cloud/dashboard/api](https://otwa.cloud/dashboard/api)
and create a key with the scopes you want the AI to use.

Recommended starter scopes:

| Scope | Why |
|---|---|
| `account:read` | Read account info, product catalogue, regions |
| `servers:read` | List servers, view stats, view credentials |
| `servers:write` | Create servers, change power state, rename, reset password |
| `billing:read` | Read invoices and wallet balance |

Opt-in scopes for the other surfaces: `webhooks:read` / `webhooks:write`,
`domains:read` / `domains:write` (register, transfer and renew spend money),
`bgp:read` / `bgp:write` (ordering a session spends money).

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

87 tools across eleven surfaces:

### Account & catalogue (read-only, `account:read`)
- `otwa_account` — current account, balance, tier
- `otwa_list_products` — available plans with prices
- `otwa_list_regions` — deploy regions
- `otwa_list_os_templates` — OS images
- `otwa_list_iso_library` — bootable custom ISOs (deploy with `os: "custom-iso"`)

### Servers
- `otwa_list_servers` — list all servers *(servers:read)*
- `otwa_get_server` — full detail for one server *(servers:read)*
- `otwa_get_server_credentials` — SSH credentials *(servers:read, sensitive)*
- `otwa_get_server_stats` — live CPU/RAM/disk metrics *(servers:read)*
- `otwa_get_server_stats_history` — CPU/memory/network/disk over 1h, 24h or 7d *(servers:read)*
- `otwa_list_plan_options` — same-disk plans a server can resize to *(servers:read)*
- `otwa_create_server` — provision new server *(servers:write)*
- `otwa_rename_server` — change label *(servers:write)*
- `otwa_power_server` — start/stop/reboot *(servers:write)*
- `otwa_change_server_plan` — resize vCPU/RAM (change plan, reboots) *(servers:write)*
- `otwa_reset_server_password` — rotate root password *(servers:write)*
- `otwa_reinstall_server` — wipe and reinstall OS *(servers:destroy)*
- `otwa_destroy_server` — permanently terminate *(servers:destroy)*
- `otwa_list_snapshots` — list a server's disk snapshots *(servers:read)*
- `otwa_create_snapshot` — capture a disk snapshot, max 2/server *(servers:write)*
- `otwa_revert_snapshot` — roll the disk back to a snapshot *(servers:destroy)*
- `otwa_delete_snapshot` — remove a snapshot *(servers:write)*
- `otwa_extend_server_billing` — pay a server forward to a date, pro rata; `confirm: true` *(servers:write)*
- `otwa_get_dashboard_sso` — one-time sign-in link: without an id, your dashboard; with a server id, ONLY that server's web console (safe to hand to the machine's end user) *(account:read / servers:read)*

### Add-ons
Extra IPs, /24 class blocks, the **SEO IP Pack** (7 dedicated IPs each from a
different /24, for SEO hosting and sender-reputation isolation) and backups.
Only **one add-on per type** can be active at a time, so changing tier is a
remove followed by a purchase.
- `otwa_list_addons` — add-ons offered by the server's plan, with the price this
  key is charged, `retailPrice`, the prorated amount, stock, and
  `owned` / `ownedByType` *(servers:read)*
- `otwa_purchase_addon` — attach one; charges the wallet immediately and raises
  the recurring price, so it requires `confirm: true` *(servers:write)*
- `otwa_remove_addon` — cancel one. No prorated refund, and IP addresses stop
  routing at once *(servers:write)*

### Capacity pools
Buy a block of vCPU / RAM / disk / IPv4 **once**, then build as many servers
inside it as the quota allows — **every server in a pool is free**, has no
monthly price of its own and never renews. Units are sold in steps of 1 vCPU,
2 GB RAM, 100 GB disk and **16 IPs**, so `ram2gb: 16` means 32 GB.
Each pool also gets its own private network segment at no charge.

- `otwa_list_pool_products` — pool products with per-unit prices and bounds *(servers:read)*
- `otwa_quote_pool` — price a selection; nothing is charged *(servers:read)*
- `otwa_list_pools` — pools on the account *(servers:read)*
- `otwa_get_pool` — one pool with live `usage` and the `policy` block *(servers:read)*
- `otwa_get_pool_pricing` — the unit rates this pool was **sold** at, which is
  what a resize is priced from *(servers:read)*
- `otwa_create_pool` — buy one; debits the wallet immediately, so `confirm: true` *(servers:write)*
- `otwa_quote_pool_resize` — price a new shape, including the prorated
  `chargeNow` *(servers:read)*
- `otwa_resize_pool` — apply it. **Growing is a purchase**; shrinking is not
  refunded. Requires `confirm: true` *(servers:write)*
- `otwa_list_pool_ips` — the pool's IPv4 block: holders, PTRs, free addresses *(servers:read)*
- `otwa_assign_pool_ips` — assign / move / return addresses in one batch. Free,
  and rate limited to 6 calls per minute *(servers:write)*
- `otwa_get_pool_usage` — what the pool's servers hold right now *(servers:read)*
- `otwa_suspend_pool` — power off every server inside; the pool keeps its
  resources and keeps billing *(servers:write)*
- `otwa_restore_pool` — undo your own suspension *(servers:write)*
- `otwa_extend_pool_billing` — pay a pool forward to a date, pro rata;
  `confirm: true` *(servers:write)*
- `otwa_terminate_pool` — tear down. Powers off every server inside (preserved,
  not destroyed), returns all IPs, no refund *(servers:destroy)*

Build into a pool with `otwa_create_server` + `poolId`. That call takes an
optional `ipCount` — how many of the pool's own addresses the server gets.
**`ipCount: 0` is private-only: no public interface, no default route and no
internet at all** (we do not NAT), reachable on the pool's private network and
through the web console. Linux only.

### Networking
- `otwa_list_server_ips` — IPs on a server *(servers:read)*
- `otwa_set_ptr` — set reverse DNS *(servers:write)*
- `otwa_delete_ptr` — clear reverse DNS *(servers:write)*

### Billing (read-only)
- `otwa_list_invoices` *(billing:read)*
- `otwa_get_invoice` *(billing:read)*
- `otwa_get_invoice_pdf` — the invoice document as an attachment *(billing:read)*
- `otwa_list_transactions` *(billing:read)*
- `otwa_get_wallet_balance` *(billing:read)*
- `otwa_get_deposit_address` — USDT deposit address on TRON or Arbitrum *(billing:read)*
- `otwa_list_wallet_transactions` — on-chain deposits *(billing:read)*

### Webhooks
- `otwa_list_webhook_events` — every event name a subscription can use *(webhooks:read)*
- `otwa_list_webhooks` *(webhooks:read)*
- `otwa_get_webhook` *(webhooks:read)*
- `otwa_create_webhook` *(webhooks:write)*
- `otwa_update_webhook` — URL, events, description, pause/resume *(webhooks:write)*
- `otwa_rotate_webhook_secret` — new signing secret, shown once *(webhooks:write)*
- `otwa_list_webhook_deliveries` — recent attempts with the receiver's status *(webhooks:read)*
- `otwa_redeliver_webhook` *(webhooks:write)*
- `otwa_delete_webhook` *(webhooks:write)*

### Domains
Register, transfer and renew debit the wallet and require `confirm: true`.
- `otwa_list_tld_pricing` — every TLD with register/renew/transfer price *(domains:read)*
- `otwa_check_domain` — live availability + price *(domains:read)*
- `otwa_get_whois_contact` / `otwa_set_whois_contact` — registrant contact *(domains:read / domains:write)*
- `otwa_list_domains`, `otwa_get_domain` *(domains:read)*
- `otwa_register_domain`, `otwa_transfer_domain`, `otwa_renew_domain` *(domains:write)*
- `otwa_set_domain_nameservers`, `otwa_set_domain_lock`, `otwa_set_domain_auto_renew` *(domains:write)*
- `otwa_send_domain_authcode` — emails the transfer code to the registrant *(domains:write)*
- `otwa_list_dns_records`, `otwa_export_dns_zone` *(domains:read)*
- `otwa_set_dns_record`, `otwa_delete_dns_record`, `otwa_import_dns_zone` *(domains:write)*

### BGP
- `otwa_get_bgp_pricing`, `otwa_list_bgp_sessions`, `otwa_get_bgp_session` *(bgp:read)*
- `otwa_create_bgp_session` — order; debits the monthly price, `confirm: true` *(bgp:write)*
- `otwa_add_bgp_prefix`, `otwa_remove_bgp_prefix` *(bgp:write)*
- `otwa_terminate_bgp_session` — withdraw everything, stop billing *(bgp:write)*

### Reseller
- `otwa_get_reseller_state` — reseller tier, discount, rolling 30-day GMV, next-tier progression *(account:read)*

## Safety

Destructive tools (`otwa_destroy_server`, `otwa_reinstall_server`, `otwa_revert_snapshot`, `otwa_terminate_pool`) require:

1. **`confirm: true`** and **`iAcknowledgeDataLoss: true`** in the tool call
2. **`expectedLabel`** matching the current label (typo-guard, on `otwa_destroy_server` and `otwa_terminate_pool`)
3. **`servers:destroy` scope** on the API key, enforced server-side

Tools that **spend money** (`otwa_purchase_addon`, `otwa_create_pool`,
`otwa_resize_pool`, `otwa_register_domain`, `otwa_transfer_domain`,
`otwa_renew_domain`, `otwa_create_bgp_session`, `otwa_extend_server_billing`,
`otwa_extend_pool_billing`) require `confirm: true` separately. Show the user the
amount first: pool and add-on prices come from the quoting tools (produced by the
same code that takes the money), domain prices from `otwa_check_domain` /
`otwa_list_tld_pricing`, and the BGP price from `otwa_get_bgp_pricing`.

Medium-risk tools (`otwa_power_server` for stop/reboot, `otwa_reset_server_password`,
`otwa_delete_webhook`, `otwa_rotate_webhook_secret`, `otwa_suspend_pool`,
`otwa_set_domain_nameservers`, `otwa_set_domain_lock`, `otwa_delete_dns_record`,
`otwa_import_dns_zone`, `otwa_remove_bgp_prefix`, `otwa_terminate_bgp_session`)
require **`confirm: true`** only.

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
[/dashboard/api](https://otwa.cloud/dashboard/api)
and create a new one.

**"Refusing to destroy server X: expectedLabel does not match"** — Safety guard
firing. Re-fetch the server label via `otwa_get_server`, confirm with the user,
and call again.

## License

MIT — see [LICENSE](LICENSE). Source on GitHub:
[github.com/otwacloud/mcp-server](https://github.com/otwacloud/mcp-server).
The published npm tarball ships plain, unminified JavaScript that mirrors
the repo at the same tag.
