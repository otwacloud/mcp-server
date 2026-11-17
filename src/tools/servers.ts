import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OtwaClient } from '../client/http';
import { OtwaApiError } from '../client/errors';
import type {
  CredentialsResponse,
  ServerDetail,
  ServerSummary,
  SsoResponse,
} from '../client/types';
import { destructiveConfirm, mediumConfirm } from '../guards/confirm';
import { jsonResult, safeHandler, textResult } from './_helpers';

const HOSTNAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
const LABEL_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/;

export function registerServerTools(server: McpServer, client: OtwaClient): void {
  // ── Reads ───────────────────────────────────────────────────────────────
  server.registerTool(
    'otwa_list_servers',
    {
      title: 'List all servers on this account',
      description:
        'Returns every server the account owns, with id, label, status, region, primary IP, and any ' +
        'additional IPs. Use the `id` field as input to per-server tools.',
      inputSchema: {},
    },
    safeHandler(async () => {
      const servers = await client.request<ServerSummary[]>('/v1/servers');
      return jsonResult(servers);
    }),
  );

  server.registerTool(
    'otwa_get_server',
    {
      title: 'Get a server by id',
      description:
        'Returns full detail for a server: status, specs (vCPU/RAM/disk/bandwidth), region, OS, primary ' +
        'IP, gateway, and any additional IPs. Always call this before any destructive operation so the ' +
        'user can confirm against the current label.',
      inputSchema: {
        id: z.string().describe('Server UUID. Retrieve via otwa_list_servers.'),
      },
    },
    safeHandler(async ({ id }) => {
      const server = await client.request<ServerDetail>(`/v1/servers/${encodeURIComponent(id)}`);
      return jsonResult(server);
    }),
  );

  server.registerTool(
    'otwa_get_server_credentials',
    {
      title: 'Get current login credentials for a server',
      description:
        'Returns the login credentials for a server: Linux gives a root SSH login; Windows gives an RDP ' +
        'login whose admin username is per-template (Administrator on Windows Server, OtwaCloud on ' +
        'Windows 11) — use the returned `username` field. SENSITIVE — never paste the password into a ' +
        'chat transcript; instead summarise that credentials are available and offer to open the ' +
        'dashboard via otwa_get_dashboard_sso.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
      },
    },
    safeHandler(async ({ id }) => {
      const creds = await client.request<CredentialsResponse>(
        `/v1/servers/${encodeURIComponent(id)}/credentials`,
      );
      return jsonResult(creds);
    }),
  );

  server.registerTool(
    'otwa_get_server_stats',
    {
      title: 'Get live VM stats for a server',
      description:
        'Returns a server\'s power state plus the latest CPU / RAM / disk / network metrics. Numbers come ' +
        'from vSphere and are seconds-fresh. `powerState` is always present for a provisioned server; the ' +
        '`live` metrics block is null when the guest agent (VMware Tools) is quiet — that means "running, no ' +
        'telemetry", not offline. A stopped server returns powerState POWERED_OFF with live null.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
      },
    },
    safeHandler(async ({ id }) => {
      const stats = await client.request(`/v1/servers/${encodeURIComponent(id)}/stats`);
      return jsonResult(stats);
    }),
  );

  server.registerTool(
    'otwa_get_server_stats_history',
    {
      title: 'Get a server\'s usage history',
      description:
        'CPU %, memory %, network rx/tx and disk read/write over time, from the hypervisor\'s own statistics. ' +
        '`range`: 1h (20-second samples), 24h (5-minute), 7d (30-minute). Gaps are null. A metric not kept at ' +
        'that resolution is `false` in `available`; then `netTotal` / `diskTotal` carry the combined rate ' +
        '(typical for 24h and 7d). Summarise peaks and averages for the user rather than dumping every point.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
        range: z.enum(['1h', '24h', '7d']).optional().describe('Window, default 1h.'),
      },
    },
    safeHandler(async ({ id, range }) => {
      const res = await client.request(`/v1/servers/${encodeURIComponent(id)}/stats/history`, {
        query: { range: range ?? '1h' },
      });
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_extend_server_billing',
    {
      title: 'Pay a server forward to a date',
      description:
        'Moves the server\'s paid-through date forward to `until`, charged pro rata from the wallet. For ' +
        'resellers keeping our cycle ahead of their own customer\'s. A date the cycle already reaches is a ' +
        'no-op, so a retry never charges twice. `until` may be at most 45 days past the later of now and the ' +
        'current cycle end. Requires `servers:write`.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
        until: z.string().datetime({ offset: true }).describe('ISO-8601 timestamp, e.g. 2026-12-31T00:00:00Z.'),
        confirm: z
          .boolean()
          .optional()
          .describe('Required `true`. The user approved a pro-rata charge to the wallet.'),
      },
    },
    safeHandler(async ({ id, until, confirm }) => {
      if (confirm !== true) {
        throw new OtwaApiError(
          'Extending billing charges the wallet pro rata. Tell the user, get approval, then re-call with `confirm: true`.',
          400,
          'confirmation_required',
        );
      }
      const res = await client.request(`/v1/servers/${encodeURIComponent(id)}/billing/extend`, {
        method: 'POST',
        body: { until },
      });
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_list_plan_options',
    {
      title: 'List the plans a server can resize to',
      description:
        'Returns the plans this server can switch to — plans in the SAME product family with the SAME disk ' +
        'size (a plan change never alters disk). Response has `current` (the active plan) and `options` ' +
        '(switchable plans, cheapest first) each with id/name/vcpu/ramMb/diskGb/monthlyPrice. Pass an ' +
        'option `id` to otwa_change_server_plan. Empty `options` means the server has no same-disk plans to ' +
        'move to (only the Cloud Router S/M/L line supports this today).',
      inputSchema: {
        id: z.string().describe('Server UUID. Retrieve via otwa_list_servers.'),
      },
    },
    safeHandler(async ({ id }) => {
      const res = await client.request(`/v1/servers/${encodeURIComponent(id)}/plan-options`);
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_list_snapshots',
    {
      title: "List a server's snapshots",
      description:
        "Returns the point-in-time disk snapshots for a server: id, name, createTime, power state when " +
        "taken, and whether it's the current one. Pass a snapshot `id` to otwa_revert_snapshot or " +
        'otwa_delete_snapshot.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
      },
    },
    safeHandler(async ({ id }) => {
      const snaps = await client.request(`/v1/servers/${encodeURIComponent(id)}/snapshots`);
      return jsonResult(snaps);
    }),
  );

  // ── Create ──────────────────────────────────────────────────────────────
  server.registerTool(
    'otwa_create_server',
    {
      title: 'Provision a new server',
      description:
        'Creates and provisions a new server on otwa.cloud. The customer is billed immediately for the ' +
        'first month — quote the monthly price from otwa_list_products and get explicit confirmation ' +
        'before calling. Always call otwa_list_products + otwa_list_os_templates first so productId, ' +
        '`os` and `osTemplate` come from the real catalogue, never guessed.\n\n' +
        'EXCEPTION — capacity pools: pass `poolId` and the server is FREE. It is checked against the ' +
        "pool's quota instead of the wallet, is never charged and never renews, so there is no price to " +
        'quote and no confirmation to collect. List pools with otwa_list_pools and check what still ' +
        'fits with otwa_get_pool (quota minus usage) before choosing a plan.',
      inputSchema: {
        productId: z
          .string()
          .uuid()
          .describe('Product UUID. Required. Source: otwa_list_products → field `id`.'),
        os: z
          .string()
          .min(1)
          .max(64)
          .describe('OS family slug — e.g. "ubuntu", "debian", "rocky" (source: otwa_list_os_templates → `family`). For a custom-ISO deploy use the literal "custom-iso".'),
        osTemplate: z
          .string()
          .min(1)
          .max(128)
          .describe('Specific OS template id — e.g. "ubuntu-22.04-x64" (source: otwa_list_os_templates → `id`). For a custom-ISO deploy (os="custom-iso") set this to the ISO `id` from otwa_list_iso_library.'),
        region: z
          .string()
          .max(64)
          .optional()
          .describe('Optional region slug. Source: otwa_list_regions → `slug`. Omit to let the platform pick.'),
        label: z
          .string()
          .min(1)
          .max(64)
          .regex(LABEL_REGEX, 'Label must start with alphanumeric and contain only letters/numbers/spaces/-/_')
          .optional()
          .describe('Human-readable label shown in the dashboard, e.g. "prod-api-01".'),
        hostname: z
          .string()
          .min(1)
          .max(63)
          .regex(HOSTNAME_REGEX, 'Hostname must be DNS-compatible (alphanumeric and hyphens, no leading/trailing hyphen).')
          .optional()
          .describe('Optional DNS-compatible hostname (≤63 chars, no underscores). Defaults to a generated value.'),
        addons: z
          .array(z.string())
          .optional()
          .describe(
            'Optional add-on ids to order WITH the server — extra IPs, a /24 class block, the SEO IP Pack, ' +
            'backups. Each is charged on top of the plan price, immediately and on every renewal. ' +
            'At most one per type. Do NOT guess ids: they are per-plan, so call otwa_list_addons on any ' +
            'server of the same plan (or read the plan from otwa_list_products) and quote the prices to the ' +
            'user first. Add-ons can also be attached later with otwa_purchase_addon. ' +
            'REFUSED on a pool build (`poolId` set): extra IPs and disk come from the pool quota, so ' +
            'buying them per-server would charge twice for the same capacity — resize the pool instead.',
          ),
        poolId: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Build this server inside a capacity pool you already own (id from otwa_list_pools). The ' +
            'server is then FREE: no charge now, no monthly price, no renewal — the pool was paid for ' +
            'once and this machine draws on its quota. Fails with 400 if the pool has no room left; ' +
            'check with otwa_get_pool first.',
          ),
        ipCount: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            "Pool builds only: how many of the pool's own public IPv4 addresses this server gets. " +
            'Defaults to 1. A standalone server always gets exactly one and ignores this. ' +
            '⚑ `0` means PRIVATE-ONLY: no public interface, no default route, and because we do not NAT, ' +
            'NO INTERNET AT ALL — it cannot fetch packages or updates. It is reachable from the other ' +
            "servers in the pool on the pool's private network, and by you through the web console. " +
            'Tell the user that explicitly before using 0. Linux only — Windows, RouterOS and custom-ISO ' +
            'deploys are refused, because their address is set over RDP or typed at the console.',
          ),
      },
    },
    safeHandler(async (args) => {
      const created = await client.request('/v1/servers', {
        method: 'POST',
        body: args,
        idempotent: true,
        timeoutMs: 90_000,
      });
      return jsonResult(created);
    }),
  );

  server.registerTool(
    'otwa_create_snapshot',
    {
      title: 'Create a server snapshot',
      description:
        "Captures a point-in-time snapshot of the server's disk (memory not included). Fast and " +
        'non-destructive — a good restore point to take before a risky change. Max 2 snapshots per ' +
        'server; if full, delete an old one with otwa_delete_snapshot first.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
        name: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe('Optional snapshot name. Defaults to a timestamp.'),
        description: z
          .string()
          .max(255)
          .optional()
          .describe('Optional description, e.g. "before the kernel upgrade".'),
      },
    },
    safeHandler(async ({ id, name, description }) => {
      const res = await client.request(`/v1/servers/${encodeURIComponent(id)}/snapshots`, {
        method: 'POST',
        body: { name, description },
        timeoutMs: 120_000,
      });
      return jsonResult(res);
    }),
  );

  // ── Updates ─────────────────────────────────────────────────────────────
  server.registerTool(
    'otwa_rename_server',
    {
      title: 'Rename a server',
      description: 'Changes the human-readable label of a server. Cosmetic — does not affect hostname or DNS.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
        label: z
          .string()
          .min(1)
          .max(64)
          .regex(LABEL_REGEX, 'Label must start with alphanumeric and contain only letters/numbers/spaces/-/_'),
      },
    },
    safeHandler(async ({ id, label }) => {
      const res = await client.request(`/v1/servers/${encodeURIComponent(id)}/label`, {
        method: 'PATCH',
        body: { label },
      });
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_power_server',
    {
      title: 'Power on / off / reboot a server',
      description:
        'Changes the power state of a server. `start` is safe; `stop` is a hard power-off (no clean ' +
        "shutdown — the guest OS isn't signalled, the VM is killed); `reboot` is a hard reset. " +
        'For `stop` and `reboot`, confirm with the user first because in-flight writes can be lost.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
        action: z
          .enum(['start', 'stop', 'reboot'])
          .describe('Power action: start | stop | reboot.'),
        confirm: z
          .boolean()
          .optional()
          .describe('Required `true` for stop/reboot. Confirms the user has been warned about possible data loss.'),
      },
    },
    safeHandler(async ({ id, action, confirm }) => {
      if ((action === 'stop' || action === 'reboot') && confirm !== true) {
        throw new OtwaApiError(
          `The "${action}" action is a hard ${action === 'stop' ? 'power-off' : 'reset'} and may lose in-flight writes. ` +
            'Re-call this tool with `confirm: true` once the user has explicitly approved it.',
          400,
          'confirmation_required',
        );
      }
      const res = await client.request(
        `/v1/servers/${encodeURIComponent(id)}/power/${encodeURIComponent(action)}`,
        { method: 'POST' },
      );
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_change_server_plan',
    {
      title: 'Change a server plan (resize vCPU/RAM)',
      description:
        'Switches a server to another plan in the SAME family with the SAME disk size — an in-place ' +
        'vCPU/RAM resize (e.g. Cloud Router S → M). The server REBOOTS (~1 minute) to apply the new ' +
        'resources; disk is never changed. Only the recurring price changes: no proration is charged on an ' +
        'up-switch and no credit is issued on a down-switch — the next renewal bills the new plan. Call ' +
        'otwa_list_plan_options first to get valid target `productId`s, and confirm with the user before ' +
        'passing `confirm: true` (it causes a reboot).',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
        productId: z.string().describe('Target plan id — an option `id` from otwa_list_plan_options.'),
        confirm: z
          .boolean()
          .optional()
          .describe('Required `true`. Confirms the user accepts the ~1-minute reboot and the new recurring price.'),
      },
    },
    safeHandler(async ({ id, productId, confirm }) => {
      if (confirm !== true) {
        throw new OtwaApiError(
          'Changing the plan reboots the server (~1 minute) and changes the recurring price. ' +
            'Re-call this tool with `confirm: true` once the user has explicitly approved it.',
          400,
          'confirmation_required',
        );
      }
      const res = await client.request(`/v1/servers/${encodeURIComponent(id)}/change-plan`, {
        method: 'POST',
        body: { productId },
        timeoutMs: 60_000,
      });
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_reset_server_password',
    {
      title: 'Reset a server admin password',
      description:
        'Generates a new admin password (root on Linux, the per-template admin user on Windows) and pushes ' +
        'it into the VM via vSphere guest ops. The new password is returned in the response — SENSITIVE, ' +
        'summarise rather than echoing into the chat. Existing sessions are not killed, but anyone using ' +
        'the old password is locked out.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
        ...mediumConfirm,
      },
    },
    safeHandler(async ({ id }) => {
      const res = await client.request(`/v1/servers/${encodeURIComponent(id)}/password-reset`, {
        method: 'POST',
        timeoutMs: 60_000,
      });
      return jsonResult(res);
    }),
  );

  // ── Destructive ─────────────────────────────────────────────────────────
  server.registerTool(
    'otwa_reinstall_server',
    {
      title: 'Reinstall a server with a new OS',
      description:
        'Wipes the disk and rebuilds the server from a different OS template. PRESERVES id, label, ' +
        'region, IP and addons; DESTROYS everything on disk. Costs nothing. Requires the API key to ' +
        'carry the `servers:destroy` scope.\n\n' +
        'SAFETY: Before calling, (1) call otwa_get_server and show the user the current label and IP, ' +
        '(2) explicitly tell them the disk will be wiped, (3) wait for confirmation in chat.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
        os: z.string().min(1).describe('Target OS family slug from otwa_list_os_templates.'),
        osTemplate: z.string().min(1).describe('Target OS template id from otwa_list_os_templates.'),
        ...destructiveConfirm,
      },
    },
    safeHandler(async ({ id, os, osTemplate }) => {
      const res = await client.request(`/v1/servers/${encodeURIComponent(id)}/reinstall`, {
        method: 'POST',
        body: { os, osTemplate },
        idempotent: true,
        timeoutMs: 90_000,
      });
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_revert_snapshot',
    {
      title: 'Revert a server to a snapshot',
      description:
        "Rolls the server's disk back to a snapshot. DESTRUCTIVE — everything written since the snapshot " +
        'was taken is lost, and the server may reboot. Requires the API key to carry the ' +
        '`servers:destroy` scope.\n\n' +
        'SAFETY: Before calling, (1) call otwa_list_snapshots and otwa_get_server and show the user the ' +
        'target snapshot plus the current label, (2) wait for explicit confirmation in chat, (3) pass ' +
        '`expectedLabel` matching the current label as a typo-guard.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
        snapshotId: z
          .string()
          .describe('Snapshot id from otwa_list_snapshots, e.g. "snapshot-1234".'),
        expectedLabel: z
          .string()
          .describe(
            "The server's CURRENT label (from otwa_get_server). The call fails if this does not match — " +
              'a typo-guard against reverting the wrong server.',
          ),
        ...destructiveConfirm,
      },
    },
    safeHandler(async ({ id, snapshotId, expectedLabel }) => {
      const current = await client.request<ServerDetail>(`/v1/servers/${encodeURIComponent(id)}`);
      const actualLabel = current.label || '';
      if (actualLabel.trim() !== expectedLabel.trim()) {
        throw new OtwaApiError(
          `Refusing to revert server ${id}: expectedLabel "${expectedLabel}" does not match the current ` +
            `label "${actualLabel}". Re-fetch via otwa_get_server, confirm with the user, and call again.`,
          400,
          'label_mismatch',
        );
      }
      const res = await client.request(
        `/v1/servers/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshotId)}/revert`,
        { method: 'POST', timeoutMs: 120_000 },
      );
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_delete_snapshot',
    {
      title: 'Delete a server snapshot',
      description:
        'Removes a snapshot and frees its delta disk. Non-destructive to your running data — the live ' +
        'disk is unaffected. Confirm with the user first.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
        snapshotId: z.string().describe('Snapshot id from otwa_list_snapshots.'),
        ...mediumConfirm,
      },
    },
    safeHandler(async ({ id, snapshotId }) => {
      const res = await client.request(
        `/v1/servers/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshotId)}`,
        { method: 'DELETE', timeoutMs: 120_000 },
      );
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_destroy_server',
    {
      title: 'Permanently destroy a server',
      description:
        'Terminates a server permanently. Disk is wiped, IPs are released, billing stops. CANNOT BE ' +
        'UNDONE. Requires the API key to carry the `servers:destroy` scope.\n\n' +
        'SAFETY: Before calling, (1) call otwa_get_server and show the user the current label, IP and ' +
        'specs, (2) wait for explicit confirmation in chat, (3) pass `expectedLabel` matching the ' +
        'current label as a typo-guard. If labels differ, the call will be rejected.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
        expectedLabel: z
          .string()
          .describe(
            "The server's CURRENT label (from otwa_get_server). The call fails if this does not match — " +
              'a typo-guard against destroying the wrong server.',
          ),
        ...destructiveConfirm,
      },
    },
    safeHandler(async ({ id, expectedLabel }) => {
      const current = await client.request<ServerDetail>(`/v1/servers/${encodeURIComponent(id)}`);
      const actualLabel = current.label || '';
      if (actualLabel.trim() !== expectedLabel.trim()) {
        throw new OtwaApiError(
          `Refusing to destroy server ${id}: expectedLabel "${expectedLabel}" does not match the ` +
            `current label "${actualLabel}". Re-fetch via otwa_get_server, confirm with the user, ` +
            'and call again with the correct expectedLabel.',
          400,
          'label_mismatch',
        );
      }
      const res = await client.request(`/v1/servers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      return jsonResult(res);
    }),
  );

  // ── SSO (handoff to dashboard) ──────────────────────────────────────────
  server.registerTool(
    'otwa_get_dashboard_sso',
    {
      title: 'Issue a 5-minute SSO link into the otwa.cloud dashboard',
      description:
        'Returns a short-lived URL that signs the user into the otwa.cloud dashboard, optionally to a ' +
        "specific path. Use this to hand off to the web UI for anything the MCP doesn't expose — noVNC " +
        'console, billing top-up, advanced settings.',
      inputSchema: {
        id: z
          .string()
          .optional()
          .describe(
            "Optional server UUID. If provided, the link opens ONLY that server's web console " +
              '(no dashboard, billing or other servers) and `next` is ignored.',
          ),
        next: z
          .string()
          .optional()
          .describe('Optional dashboard path to land on, e.g. "/dashboard/billing". Must start with "/".'),
      },
    },
    safeHandler(async ({ id, next }) => {
      const path = id ? `/v1/servers/${encodeURIComponent(id)}/sso` : '/v1/sso';
      const res = await client.request<SsoResponse>(path, {
        method: 'POST',
        body: next ? { next } : {},
      });
      return textResult(
        `Dashboard SSO link (valid ${res.expiresIn} seconds): ${res.url}\n\n` +
          'Share this URL with the user; it auto-logs them in. Do not store or reuse it — it expires.',
      );
    }),
  );
}
