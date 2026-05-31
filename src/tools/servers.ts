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
      title: 'Get current root credentials for a server',
      description:
        'Returns the SSH username, root password, IP and port for a server. SENSITIVE — never paste the ' +
        'password into a chat transcript; instead summarise that credentials are available and offer to ' +
        'open the dashboard via otwa_get_dashboard_sso.',
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
        'Returns the latest CPU / RAM / disk / network metrics for a server. Numbers come from vSphere ' +
        'and are seconds-fresh.',
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
        '`os` and `osTemplate` come from the real catalogue, never guessed.',
      inputSchema: {
        productId: z
          .string()
          .uuid()
          .describe('Product UUID. Required. Source: otwa_list_products → field `id`.'),
        os: z
          .string()
          .min(1)
          .max(64)
          .describe('OS family slug — e.g. "ubuntu", "debian", "rocky". Source: otwa_list_os_templates → `family`.'),
        osTemplate: z
          .string()
          .min(1)
          .max(128)
          .describe('Specific OS template id — e.g. "ubuntu-22.04-x64". Source: otwa_list_os_templates → `id`.'),
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
          .describe('Optional list of addon ids — e.g. extra IPs, backups. Look these up via otwa_list_addons-equivalent later.'),
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
        'non-destructive — a good restore point to take before a risky change. Max 10 snapshots per ' +
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
    'otwa_reset_server_password',
    {
      title: 'Reset a server root password',
      description:
        'Generates a new root password and pushes it into the VM via vSphere guest ops. The new password ' +
        'is returned in the response — SENSITIVE, summarise rather than echoing into the chat. ' +
        'Existing SSH sessions are not killed, but anyone using the old password is locked out.',
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
          .describe('Optional server UUID. If provided, lands on /dashboard/servers/<id>.'),
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
