import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OtwaClient } from '../client/http';
import { OtwaApiError } from '../client/errors';
import { destructiveConfirm, mediumConfirm } from '../guards/confirm';
import { jsonResult, safeHandler } from './_helpers';

const LABEL_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/;

/** The four things a pool is sold in, in the units the API takes. Repeated in
 *  every schema description because the units are the one thing a model gets
 *  wrong here: `ram2gb: 16` is 32 GB, not 16. */
const UNITS = {
  vcpu: z.number().int().min(0).describe('vCPU count. Sold one at a time, so this IS the number of cores.'),
  ram2gb: z.number().int().min(0).describe('Memory in 2 GB BLOCKS — 16 means 32 GB, not 16 GB. Sold in 2 GB steps.'),
  disk100: z.number().int().min(0).describe('Storage in 100 GB BLOCKS — 10 means 1000 GB. Sold in 100 GB steps.'),
  ip16: z.number().int().min(0).describe('Public IPv4 in BLOCKS OF 16 — 1 means 16 addresses. Minimum 1: a pool with no addresses can host nothing, because every server takes at least one unless it is built private-only.'),
};

/** Capacity-pool tools.
 *
 *  A pool inverts the normal product: the customer buys a block of
 *  vCPU/RAM/disk/IPs ONCE, and every server built inside it is free and never
 *  renews. That inversion is the thing to keep straight in every description —
 *  a model that treats a pool as "a big server" will quote the wrong number,
 *  and one that treats a pool server as billable will tell the user they are
 *  paying twice for the same capacity.
 *
 *  ⚑ Two money paths exist here and only two: buying a pool, and GROWING one.
 *  Both are gated behind an explicit confirm because both debit the wallet
 *  immediately. Everything else — assigning the pool's own addresses, building
 *  servers into it — is free by design, and saying so is part of the tool's job. */
export function registerPoolTools(server: McpServer, client: OtwaClient): void {
  // ── Catalogue + quoting ─────────────────────────────────────────────────
  server.registerTool(
    'otwa_list_pool_products',
    {
      title: 'List capacity-pool products and their unit prices',
      description:
        'Returns the capacity-pool products that can be bought, each with its per-unit prices and the ' +
        'slider bounds those units may fall between. A capacity pool is a block of vCPU / RAM / disk / ' +
        'IPv4 bought ONCE — servers built inside it are FREE, carry no monthly price of their own and ' +
        'never appear on a renewal. Units are sold in steps: 1 vCPU, 2 GB RAM, 100 GB disk, 16 IPs, so ' +
        '`per2gbRamUsd` is the price of TWO gigabytes and `per16IpUsd` the price of SIXTEEN addresses. ' +
        'Use the `id` with otwa_quote_pool and otwa_create_pool. Bounds are enforced server-side — a ' +
        'selection outside them is refused, not clamped.',
      inputSchema: {},
    },
    safeHandler(async () => {
      const res = await client.request('/v1/pools/catalogue');
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_quote_pool',
    {
      title: 'Price a capacity-pool selection',
      description:
        'Returns the monthly price for a pool shape, with a per-unit breakdown. Nothing is charged and ' +
        'nothing is created. ALWAYS call this and show the user the monthly figure before ' +
        'otwa_create_pool — the purchase recomputes the price server-side, so a number worked out by ' +
        'multiplying the unit prices yourself may not be the number taken. Note the units: `ram2gb` and ' +
        '`disk100` and `ip16` are counts of BLOCKS, not gigabytes or addresses.',
      inputSchema: {
        productId: z.string().describe('Pool product id from otwa_list_pool_products.'),
        ...UNITS,
      },
    },
    safeHandler(async ({ productId, vcpu, ram2gb, disk100, ip16 }) => {
      const res = await client.request('/v1/pools/quote', {
        method: 'POST',
        body: { productId, vcpu, ram2gb, disk100, ip16 },
      });
      return jsonResult(res);
    }),
  );

  // ── Reads ───────────────────────────────────────────────────────────────
  server.registerTool(
    'otwa_list_pools',
    {
      title: 'List capacity pools on this account',
      description:
        'Returns every capacity pool the account owns that has not been terminated, with its quotas ' +
        '(vcpuQuota / ramMbQuota / diskGbQuota / ipQuota), status, monthly price and billing cycle end. ' +
        'A pool in `suspended_unpaid` has had every server inside it powered off for non-payment — ' +
        'topping the wallet up and waiting for the next billing run restores them to the state they ' +
        'were in. Use the `id` with the other pool tools, and as `poolId` on otwa_create_server to ' +
        'build a free server inside one.',
      inputSchema: {},
    },
    safeHandler(async () => {
      const res = await client.request('/v1/pools');
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_get_pool',
    {
      title: 'Get a capacity pool with its live usage',
      description:
        'Returns one pool plus a `usage` block — the vCPU, RAM, disk, IPs and server count currently ' +
        'committed inside it — and a `policy` block. Usage counts PROVISIONED resources, not live ' +
        'consumption: a powered-off server still holds its allocation, because the customer is entitled ' +
        'to switch it back on. Subtract usage from quota to answer "what will still fit". ' +
        '⚑ Read `policy.vcpuOvercommit` rather than assuming a ratio — vCPU may be committed beyond the ' +
        'quota by that factor, and it is a server setting that can change.',
      inputSchema: {
        id: z.string().describe('Pool id from otwa_list_pools.'),
      },
    },
    safeHandler(async ({ id }) => {
      const res = await client.request(`/v1/pools/${encodeURIComponent(id)}`);
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_get_pool_pricing',
    {
      title: "Get the unit rates a pool was sold at",
      description:
        'Returns the per-unit prices and bounds THIS pool was bought at, which is what a resize is ' +
        'priced from — never the current catalogue. If the catalogue has changed since, these differ ' +
        'from otwa_list_pool_products, and these are the ones that apply. Use them to work out what a ' +
        'proposed shape costs, then confirm the real figure with otwa_quote_pool_resize.',
      inputSchema: {
        id: z.string().describe('Pool id.'),
      },
    },
    safeHandler(async ({ id }) => {
      const res = await client.request(`/v1/pools/${encodeURIComponent(id)}/pricing`);
      return jsonResult(res);
    }),
  );

  // ── Purchase ────────────────────────────────────────────────────────────
  server.registerTool(
    'otwa_create_pool',
    {
      title: 'Buy and provision a capacity pool',
      description:
        'Buys a capacity pool. The FULL monthly price is debited from the wallet immediately, the ' +
        'hypervisor resource pool is created with hard CPU and memory ceilings, the IPv4 block is ' +
        'reserved, and the pool gets its own private network segment (free) that its servers can talk ' +
        'to each other on. ' +
        'Call otwa_quote_pool first and show the user the monthly price — this endpoint recomputes it ' +
        'server-side and charges that, so quoting from your own arithmetic risks surprising them. ' +
        '400s if the wallet cannot cover it or the selection is outside the product bounds. ' +
        'Afterwards, build free servers into it with otwa_create_server + `poolId`.',
      inputSchema: {
        productId: z.string().describe('Pool product id from otwa_list_pool_products.'),
        label: z
          .string()
          .min(1)
          .max(64)
          .regex(LABEL_REGEX, 'Label must start with alphanumeric and contain only letters/numbers/spaces/-/_')
          .optional()
          .describe('Human-readable name for the pool, e.g. "prod-cluster".'),
        region: z.string().max(64).optional().describe('Optional region slug — source: the product\'s `regions`.'),
        ...UNITS,
        // Optional in the schema, required at runtime — deliberately. A schema
        // violation tells the model "invalid input"; this tells it what to do
        // instead, which is the difference between recovering and retrying.
        confirm: z
          .boolean()
          .optional()
          .describe('Required `true`. The user has been shown the monthly price from otwa_quote_pool and approved the immediate charge.'),
      },
    },
    safeHandler(async ({ productId, label, region, vcpu, ram2gb, disk100, ip16, confirm }) => {
      if (confirm !== true) {
        throw new OtwaApiError(
          'Buying a capacity pool debits the wallet immediately for the full monthly price. ' +
            'Call otwa_quote_pool with this exact selection, show the user the monthly figure, ' +
            'then re-call with `confirm: true`.',
          400,
          'confirmation_required',
        );
      }
      const res = await client.request('/v1/pools', {
        method: 'POST',
        body: { productId, label, region, vcpu, ram2gb, disk100, ip16 },
        idempotent: true,
        timeoutMs: 120_000,
      });
      return jsonResult(res);
    }),
  );

  // ── Resize ──────────────────────────────────────────────────────────────
  server.registerTool(
    'otwa_quote_pool_resize',
    {
      title: 'Price a pool resize without applying it',
      description:
        'Prices a new shape for an existing pool. Nothing is charged. Returns `previousMonthly`, the new ' +
        '`monthly`, the `delta`, and `chargeNow` — the prorated amount that would be taken immediately ' +
        'for the days left in the current cycle. The same code produces this figure and takes the money ' +
        'in otwa_resize_pool, so it is the number to show the user. ' +
        'Takes the WHOLE shape in absolute units, not deltas: to add 8 vCPU to a 16-vCPU pool, send 24.',
      inputSchema: {
        id: z.string().describe('Pool id.'),
        ...UNITS,
      },
    },
    safeHandler(async ({ id, vcpu, ram2gb, disk100, ip16 }) => {
      const res = await client.request(`/v1/pools/${encodeURIComponent(id)}/resize-quote`, {
        method: 'POST',
        body: { vcpu, ram2gb, disk100, ip16 },
      });
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_resize_pool',
    {
      title: 'Resize a capacity pool',
      description:
        'Changes a pool\'s shape. Takes the WHOLE shape in absolute units, never deltas. ' +
        '**Growing a pool is a purchase**: the new shape is re-priced at the rates the pool was SOLD at ' +
        '(not today\'s catalogue) and the difference is charged to the wallet immediately, prorated for ' +
        'the days left in the cycle — so call otwa_quote_pool_resize first and show the user both the ' +
        'immediate charge and the new monthly. Shrinking is NOT refunded; the lower price applies from ' +
        'the next renewal. ' +
        'Refuses to shrink below what the pool\'s servers already hold (delete servers first) and 400s ' +
        'if the balance will not cover an increase.',
      inputSchema: {
        id: z.string().describe('Pool id.'),
        ...UNITS,
        confirm: z
          .boolean()
          .optional()
          .describe('Required `true`. The user has seen `chargeNow` and the new monthly price from otwa_quote_pool_resize and approved them.'),
      },
    },
    safeHandler(async ({ id, vcpu, ram2gb, disk100, ip16, confirm }) => {
      if (confirm !== true) {
        throw new OtwaApiError(
          'Growing a pool charges the wallet immediately and changes the recurring monthly price. ' +
            'Call otwa_quote_pool_resize with this exact shape, show the user `chargeNow` and the new ' +
            'monthly, then re-call with `confirm: true`. (Shrinking is not refunded, so confirm that too.)',
          400,
          'confirmation_required',
        );
      }
      const res = await client.request(`/v1/pools/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { vcpu, ram2gb, disk100, ip16 },
        timeoutMs: 120_000,
      });
      return jsonResult(res);
    }),
  );

  // ── The pool's own IP block ─────────────────────────────────────────────
  server.registerTool(
    'otwa_list_pool_ips',
    {
      title: "List the pool's IPv4 block",
      description:
        'Returns every address the pool owns: its gateway, netmask, CIDR, current PTR, and which server ' +
        'holds it. `assignedTo: null` means the address is free inside the block and can be handed to a ' +
        'server at no cost. `isPrimary` marks the address the server\'s guest OS is configured with and ' +
        'that appears on its credentials. ' +
        'These addresses were bought with the pool, so none of them is billed separately — to get MORE ' +
        'of them, resize the pool\'s `ip16`, do not buy an IP add-on (add-ons are refused on pool servers).',
      inputSchema: {
        id: z.string().describe('Pool id.'),
      },
    },
    safeHandler(async ({ id }) => {
      const res = await client.request(`/v1/pools/${encodeURIComponent(id)}/ips`);
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_assign_pool_ips',
    {
      title: "Assign, move or return addresses in the pool's block",
      description:
        'Moves addresses around inside the pool\'s own block, in one batch. Each change names an `ip` ' +
        'and the `serverId` to hand it to; `serverId: null` returns it to the block. FREE — the block ' +
        'was bought with the pool, so nothing here touches the wallet. ' +
        'Addresses only ever move between the pool and the servers inside it: there is no path to or ' +
        'from the global address pool, and naming a server outside this pool refuses the WHOLE batch ' +
        'with nothing written. ' +
        '⚑ Two things this does NOT do. It does not configure the address inside the guest OS — after ' +
        'assigning one, the user must add it in the VM. And moving an address AWAY is immediately ' +
        'disruptive: it stops routing at once, so anything bound to it (sites, TLS, mail) breaks. ' +
        'Send every change in ONE call rather than one call per address: each call reprograms the ' +
        'router, and the endpoint allows only 6 per minute.',
      inputSchema: {
        id: z.string().describe('Pool id.'),
        changes: z
          .array(
            z.object({
              ip: z.string().describe('IPv4 address that belongs to this pool — source: otwa_list_pool_ips.'),
              serverId: z
                .string()
                .nullable()
                .describe('Server to hand the address to. Must be a server INSIDE this pool. `null` returns it to the block.'),
            }),
          )
          .min(1)
          .max(256)
          .describe('The whole set of changes to apply at once. Validated as a unit — one bad entry refuses all of them.'),
        confirm: z
          .literal(true)
          .describe('Must be exactly `true`. Moving an address away from a server breaks anything bound to it immediately — the user has been told.'),
      },
    },
    safeHandler(async ({ id, changes }) => {
      const res = await client.request(`/v1/pools/${encodeURIComponent(id)}/ips/apply`, {
        method: 'POST',
        body: { changes },
        timeoutMs: 120_000,
      });
      return jsonResult(res);
    }),
  );

  // ── Live usage + lifecycle ──────────────────────────────────────────────
  server.registerTool(
    'otwa_get_pool_usage',
    {
      title: 'Get a capacity pool\'s live usage',
      description:
        'What the servers inside the pool hold right now: vcpuUsed, ramMbUsed, diskGbUsed, ipsUsed and vmCount. ' +
        'Compare with the pool\'s quotas (otwa_get_pool) to say how much room is left.',
      inputSchema: { id: z.string().describe('Pool id.') },
    },
    safeHandler(async ({ id }) => jsonResult(await client.request(`/v1/pools/${encodeURIComponent(id)}/usage`))),
  );

  server.registerTool(
    'otwa_suspend_pool',
    {
      title: 'Suspend a capacity pool',
      description:
        'Powers off every server inside the pool and records each one\'s power state so a restore puts it back. ' +
        'Nothing is released and the pool KEEPS BILLING — this is a pause, not a teardown. Only you can lift ' +
        'a suspension made this way (otwa_restore_pool). Requires `servers:write`.',
      inputSchema: { id: z.string().describe('Pool id.'), ...mediumConfirm },
    },
    safeHandler(async ({ id }) =>
      jsonResult(
        await client.request(`/v1/pools/${encodeURIComponent(id)}/suspend`, { method: 'POST', timeoutMs: 180_000 }),
      ),
    ),
  );

  server.registerTool(
    'otwa_restore_pool',
    {
      title: 'Restore a suspended capacity pool',
      description:
        'Brings a pool you suspended back: each server returns to the power state it had, so one that was off ' +
        'stays off. A pool suspended for an unpaid renewal cannot be restored here — topping up the wallet ' +
        'restores it automatically; one suspended by an administrator needs support. Requires `servers:write`.',
      inputSchema: { id: z.string().describe('Pool id.') },
    },
    safeHandler(async ({ id }) =>
      jsonResult(
        await client.request(`/v1/pools/${encodeURIComponent(id)}/restore`, { method: 'POST', timeoutMs: 180_000 }),
      ),
    ),
  );

  server.registerTool(
    'otwa_extend_pool_billing',
    {
      title: 'Pay a capacity pool forward to a date',
      description:
        'Moves the pool\'s paid-through date forward to `until`, charged pro rata from the wallet. A date the ' +
        'cycle already reaches is a no-op, so a retry never charges twice. At most 45 days past the later of ' +
        'now and the current cycle end. Requires `servers:write`.',
      inputSchema: {
        id: z.string().describe('Pool id.'),
        until: z.string().datetime({ offset: true }).describe('ISO-8601 timestamp, e.g. 2026-12-31T00:00:00Z.'),
        confirm: z.boolean().optional().describe('Required `true`. The user approved a pro-rata charge to the wallet.'),
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
      return jsonResult(
        await client.request(`/v1/pools/${encodeURIComponent(id)}/billing/extend`, { method: 'POST', body: { until } }),
      );
    }),
  );

  // ── Teardown ────────────────────────────────────────────────────────────
  server.registerTool(
    'otwa_terminate_pool',
    {
      title: 'Terminate a capacity pool',
      description:
        'Tears a pool down. Every server inside it is POWERED OFF — they are preserved rather than ' +
        'destroyed — all IPv4 addresses are returned, the private network segment is deleted and the ' +
        'hypervisor pool is removed. There is NO refund for the remainder of the cycle. ' +
        'Requires the `servers:destroy` scope.\n\n' +
        'SAFETY: Before calling, (1) call otwa_get_pool and read the user its label, quotas and how many ' +
        'servers are inside, (2) wait for explicit confirmation in chat, (3) pass `expectedLabel` ' +
        'matching the current label as a typo-guard. If labels differ, the call is rejected.',
      inputSchema: {
        id: z.string().describe('Pool id.'),
        expectedLabel: z
          .string()
          .describe(
            "The pool's CURRENT label (from otwa_get_pool). The call fails if this does not match — " +
              'a typo-guard against tearing down the wrong pool.',
          ),
        ...destructiveConfirm,
      },
    },
    safeHandler(async ({ id, expectedLabel }) => {
      const current = await client.request<{ label?: string }>(`/v1/pools/${encodeURIComponent(id)}`);
      const actualLabel = current.label || '';
      if (actualLabel.trim() !== expectedLabel.trim()) {
        throw new OtwaApiError(
          `Refusing to terminate pool ${id}: expectedLabel "${expectedLabel}" does not match the ` +
            `current label "${actualLabel}". Re-fetch via otwa_get_pool, confirm with the user, ` +
            'and call again with the correct expectedLabel.',
          400,
          'label_mismatch',
        );
      }
      const res = await client.request(`/v1/pools/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        timeoutMs: 180_000,
      });
      return jsonResult(res);
    }),
  );
}
