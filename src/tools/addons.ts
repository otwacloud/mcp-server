import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OtwaClient } from '../client/http';
import { OtwaApiError } from '../client/errors';
import { jsonResult, safeHandler } from './_helpers';

/** Add-on tools: extra IPs, /24 class blocks, the SEO IP Pack, and backups.
 *
 *  These exist because otwa_create_server accepts an `addons` array but nothing
 *  here could ever tell the model what a valid add-on id was — its own
 *  description pointed at a tool that did not exist. Ordering blind is exactly
 *  how a customer ends up paying for the wrong thing. */
export function registerAddonTools(server: McpServer, client: OtwaClient): void {
  server.registerTool(
    'otwa_list_addons',
    {
      title: "List a server's available add-ons",
      description:
        "Returns every add-on offered by this server's plan — extra IPs, /24 class blocks, the SEO IP Pack " +
        '(7 dedicated IPs each from a DIFFERENT /24, for SEO hosting and sender-reputation isolation), and ' +
        'backups. Each entry carries id, name, type, `price` (what this API key is charged monthly, ' +
        'reseller discount already applied), `retailPrice`, `proratedPrice` (charged immediately, based on ' +
        'days left in the cycle), `owned`, and `ownedByType`. ' +
        'ONLY ONE add-on per type can be active at a time, so treat `ownedByType: true` as "not orderable ' +
        'until the current one is removed". Stock-limited add-ons (the SEO IP Pack) also carry `available` ' +
        'and a `stockNote`. Featured add-ons come first. Use these ids with otwa_purchase_addon, ' +
        'otwa_remove_addon, or the `addons` array of otwa_create_server.',
      inputSchema: {
        id: z.string().describe('Server UUID. Retrieve via otwa_list_servers.'),
      },
    },
    safeHandler(async ({ id }) => {
      const res = await client.request(`/v1/servers/${encodeURIComponent(id)}/addons`);
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_purchase_addon',
    {
      title: 'Purchase an add-on for a server',
      description:
        'Attaches an add-on to an already-running server. The prorated amount is charged to the wallet ' +
        'IMMEDIATELY and the full monthly price joins every future renewal — call otwa_list_addons first ' +
        'and show the user both numbers before confirming. For IP add-ons the addresses are routed to the ' +
        'VM but the customer must configure them inside the guest OS themselves. ' +
        'The SEO IP Pack allocates 7 IPs each from a different /24 and fails with 400 if distinct-subnet ' +
        'stock is short. Also 400s when an add-on of the same type is already active (remove it first via ' +
        'otwa_remove_addon) or the wallet balance is insufficient.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
        addonId: z.string().describe('Add-on id from otwa_list_addons — e.g. the SEO IP Pack.'),
        confirm: z
          .boolean()
          .optional()
          .describe('Required `true`. Confirms the user approved the prorated charge AND the new recurring price.'),
      },
    },
    safeHandler(async ({ id, addonId, confirm }) => {
      if (confirm !== true) {
        throw new OtwaApiError(
          'Purchasing an add-on charges the wallet immediately and raises the recurring monthly price. ' +
            'Show the user the prorated and monthly amounts from otwa_list_addons, then re-call with `confirm: true`.',
          400,
          'confirmation_required',
        );
      }
      const res = await client.request(`/v1/servers/${encodeURIComponent(id)}/addons`, {
        method: 'POST',
        body: { addonId },
        timeoutMs: 60_000,
      });
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_remove_addon',
    {
      title: 'Remove an add-on from a server',
      description:
        'Cancels an active add-on: its price leaves the recurring total from the NEXT renewal onward. ' +
        'There is NO prorated refund for the current cycle. ' +
        'For IP add-ons this is disruptive and immediate — the addresses are released back to the pool and ' +
        'stop routing to the VM at once, so anything bound to them in the guest OS (sites, SSL, mail) ' +
        'breaks. Tell the user to unconfigure them first. Use the add-on id from otwa_list_addons or the ' +
        "server's own metadata.",
      inputSchema: {
        id: z.string().describe('Server UUID.'),
        addonId: z.string().describe('Add-on id currently active on the server.'),
        confirm: z
          .literal(true)
          .describe('Must be exactly `true`. The user has been told the IPs stop working immediately and no refund is issued.'),
      },
    },
    safeHandler(async ({ id, addonId }) => {
      const res = await client.request(
        `/v1/servers/${encodeURIComponent(id)}/addons/${encodeURIComponent(addonId)}`,
        { method: 'DELETE', timeoutMs: 60_000 },
      );
      return jsonResult(res);
    }),
  );
}
