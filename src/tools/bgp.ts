import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OtwaClient } from '../client/http';
import { OtwaApiError } from '../client/errors';
import { mediumConfirm } from '../guards/confirm';
import { jsonResult, safeHandler } from './_helpers';

const sessionId = z.string().describe('BGP session id (UUID). Source: otwa_list_bgp_sessions.');
const CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^[0-9a-fA-F:]+\/\d{1,3}$/;
const enc = encodeURIComponent;

/** BGP session tools. Scopes: `bgp:read` / `bgp:write`.
 *
 *  ⚑ Ordering a session is the one money path (monthly price, debited at once)
 *  and ending one withdraws every announcement — both are confirmed. */
export function registerBgpTools(server: McpServer, client: OtwaClient): void {
  server.registerTool(
    'otwa_get_bgp_pricing',
    {
      title: 'Get the BGP session price',
      description: 'Monthly price of one BGP session for this account.',
      inputSchema: {},
    },
    safeHandler(async () => jsonResult(await client.request('/v1/bgp/pricing'))),
  );

  server.registerTool(
    'otwa_list_bgp_sessions',
    {
      title: 'List BGP sessions',
      description:
        'Every BGP session with status, live peerState (established = up), the server it runs on, the ' +
        'peering addresses (routerIp / customerIp / transitCidr, platformAsn) and the announced prefixes ' +
        'with their RPKI state.',
      inputSchema: {},
    },
    safeHandler(async () => jsonResult(await client.request('/v1/bgp/sessions'))),
  );

  server.registerTool(
    'otwa_get_bgp_session',
    {
      title: 'Get one BGP session',
      description:
        'One session. `routerIp`, `customerIp`, `transitCidr` and `platformAsn` are what the user configures ' +
        'on their side of the peering (e.g. in BIRD or FRR on the server).',
      inputSchema: { id: sessionId },
    },
    safeHandler(async ({ id }) => jsonResult(await client.request(`/v1/bgp/sessions/${enc(id)}`))),
  );

  server.registerTool(
    'otwa_create_bgp_session',
    {
      title: 'Order a BGP session',
      description:
        'Orders a BGP session on one of the account\'s servers and debits the monthly price at once (see ' +
        'otwa_get_bgp_pricing). The user needs their own public ASN and prefixes they are authorised to ' +
        'announce; each prefix is RPKI-checked and invalid ones come back in `rejected`. Show the price and ' +
        'get approval first. Requires `bgp:write`.',
      inputSchema: {
        serverId: z.string().describe('Server UUID the session peers with. Source: otwa_list_servers.'),
        label: z.string().min(1).max(64),
        customerAsn: z.string().regex(/^(AS)?\d{1,10}$/i, 'Numeric ASN, optionally "AS"-prefixed'),
        prefixes: z.array(z.string().regex(CIDR, 'IPv4 or IPv6 CIDR')).max(50).optional(),
        confirm: z
          .boolean()
          .optional()
          .describe('Required `true`. The user has seen the monthly price and approved the immediate charge.'),
      },
    },
    safeHandler(async ({ serverId, label, customerAsn, prefixes, confirm }) => {
      if (confirm !== true) {
        throw new OtwaApiError(
          'Ordering a BGP session debits the wallet immediately for the monthly price. Call ' +
            'otwa_get_bgp_pricing, show the user the price, then re-call with `confirm: true`.',
          400,
          'confirmation_required',
        );
      }
      return jsonResult(
        await client.request('/v1/bgp/sessions', {
          method: 'POST',
          body: { serverId, label, customerAsn, prefixes },
          idempotent: true,
          timeoutMs: 120_000,
        }),
      );
    }),
  );

  server.registerTool(
    'otwa_add_bgp_prefix',
    {
      title: 'Add a prefix to a BGP session',
      description:
        'Adds an IPv4 or IPv6 prefix to announce. It is RPKI-checked first and refused if invalid. Requires `bgp:write`.',
      inputSchema: {
        id: sessionId,
        prefix: z.string().regex(CIDR, 'IPv4 or IPv6 CIDR, e.g. 198.51.100.0/24'),
      },
    },
    safeHandler(async ({ id, prefix }) =>
      jsonResult(await client.request(`/v1/bgp/sessions/${enc(id)}/prefixes`, { method: 'POST', body: { prefix } })),
    ),
  );

  server.registerTool(
    'otwa_remove_bgp_prefix',
    {
      title: 'Remove a prefix from a BGP session',
      description: 'Withdraws and removes one announced prefix. Requires `bgp:write`.',
      inputSchema: {
        id: sessionId,
        prefixId: z.string().describe('Prefix id from the session\'s `prefixes`.'),
        ...mediumConfirm,
      },
    },
    safeHandler(async ({ id, prefixId }) =>
      jsonResult(
        await client.request(`/v1/bgp/sessions/${enc(id)}/prefixes/${enc(prefixId)}`, { method: 'DELETE' }),
      ),
    ),
  );

  server.registerTool(
    'otwa_terminate_bgp_session',
    {
      title: 'End a BGP session',
      description:
        'Withdraws every announcement, tears the peering down and stops billing. No refund for the rest of ' +
        'the month. Read the session to the user (otwa_get_bgp_session) and get explicit approval first. ' +
        'Requires `bgp:write`.',
      inputSchema: { id: sessionId, ...mediumConfirm },
    },
    safeHandler(async ({ id }) =>
      jsonResult(await client.request(`/v1/bgp/sessions/${enc(id)}`, { method: 'DELETE' })),
    ),
  );
}
