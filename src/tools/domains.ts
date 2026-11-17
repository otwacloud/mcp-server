import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OtwaClient } from '../client/http';
import { OtwaApiError } from '../client/errors';
import { mediumConfirm } from '../guards/confirm';
import { jsonResult, safeHandler } from './_helpers';

const DOMAIN_REGEX = /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i;
const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'] as const;

const domainId = z.string().describe('Domain id (UUID). Source: otwa_list_domains.');

/** Same contract as the pool purchase: optional in the schema so the model is
 *  told what to do instead of "invalid input", required `true` at runtime. */
const moneyConfirm = z
  .boolean()
  .optional()
  .describe('Required `true`. The user has been shown the price and approved the immediate wallet charge.');

function requireMoneyConfirm(confirm: boolean | undefined, what: string): void {
  if (confirm !== true) {
    throw new OtwaApiError(
      `${what} debits the wallet immediately. Show the user the price from otwa_list_tld_pricing ` +
        '(or otwa_check_domain), get their approval, then re-call with `confirm: true`.',
      400,
      'confirmation_required',
    );
  }
}

const enc = encodeURIComponent;

/** Domain registration + DNS tools. Scopes: `domains:read` / `domains:write`.
 *
 *  ⚑ Register, transfer and renew are the money paths — each debits the wallet
 *  and each is behind an explicit confirm. Everything else is free. */
export function registerDomainTools(server: McpServer, client: OtwaClient): void {
  // ── Catalogue + search ──────────────────────────────────────────────────
  server.registerTool(
    'otwa_list_tld_pricing',
    {
      title: 'List domain TLD prices',
      description:
        'Every TLD otwa.cloud sells, with the per-year register, renew and transfer price and the allowed ' +
        'registration period (minYears–maxYears). Requires `domains:read`.',
      inputSchema: {},
    },
    safeHandler(async () => jsonResult(await client.request('/v1/domains/pricing'))),
  );

  server.registerTool(
    'otwa_check_domain',
    {
      title: 'Check domain availability and price',
      description:
        'Live availability + price. `query` may be a bare name ("example" — checks the featured TLDs) or a ' +
        'full domain ("example.com" — that TLD first). Pass `tlds` to check exactly those. `available` is ' +
        'null when the registry gave no clear answer (`note` says why). `typedTldSold: false` means the TLD ' +
        'the user typed is not one we sell. Each result is a live registry lookup; the API allows 40 calls a ' +
        'minute, so do not loop over many names.',
      inputSchema: {
        query: z.string().min(1).max(253).describe('Name or full domain, e.g. "example" or "example.com".'),
        tlds: z.array(z.string()).max(20).optional().describe('Optional exact TLD list, e.g. ["com","net","io"].'),
        limit: z.number().int().min(1).max(20).optional().describe('How many TLDs to check when `tlds` is not given.'),
      },
    },
    safeHandler(async ({ query, tlds, limit }) =>
      jsonResult(
        await client.request('/v1/domains/check', {
          query: { q: query, tlds: tlds?.length ? tlds.join(',') : undefined, limit },
        }),
      ),
    ),
  );

  // ── Registrant contact ──────────────────────────────────────────────────
  server.registerTool(
    'otwa_get_whois_contact',
    {
      title: 'Get the registrant (WHOIS) contact',
      description:
        'The registrant contact used for new registrations and transfers. `_saved: false` means none is saved ' +
        'yet and the values are a pre-fill from the account profile — save one with otwa_set_whois_contact ' +
        'before registering.',
      inputSchema: {},
    },
    safeHandler(async () => jsonResult(await client.request('/v1/domains/whois-contact'))),
  );

  server.registerTool(
    'otwa_set_whois_contact',
    {
      title: 'Save the registrant (WHOIS) contact',
      description:
        'Saves the registrant contact for future registrations and transfers (existing domains keep theirs). ' +
        'Use the user\'s real details — registries require accurate contact data. Requires `domains:write`.',
      inputSchema: {
        firstName: z.string().min(1).max(64),
        lastName: z.string().min(1).max(64),
        orgName: z.string().max(128).optional(),
        email: z.string().email(),
        phone: z.string().regex(/^\+[0-9]{1,3}\.[0-9]{4,14}$/, 'phone must be +CC.NUMBER, e.g. +1.5555550100')
          .describe('International format with a dot after the country code: +CC.NUMBER, e.g. +90.5321234567.'),
        address1: z.string().min(1).max(128),
        address2: z.string().max(128).optional(),
        city: z.string().min(1).max(64),
        state: z.string().max(64).optional(),
        country: z.string().regex(/^[A-Za-z]{2}$/).describe('ISO-3166 alpha-2, e.g. US, DE, TR.'),
        postalCode: z.string().min(1).max(16),
      },
    },
    safeHandler(async (contact) =>
      jsonResult(await client.request('/v1/domains/whois-contact', { method: 'PATCH', body: contact })),
    ),
  );

  // ── Reads ───────────────────────────────────────────────────────────────
  server.registerTool(
    'otwa_list_domains',
    {
      title: 'List domains on this account',
      description:
        'Every domain with status (active, pending, transfer_pending, expired…), expiry, auto-renew, transfer ' +
        'lock and nameservers. Use the `id` with the other domain tools.',
      inputSchema: {},
    },
    safeHandler(async () => jsonResult(await client.request('/v1/domains'))),
  );

  server.registerTool(
    'otwa_get_domain',
    {
      title: 'Get one domain',
      description: 'One domain with status, dates, auto-renew, transfer lock and nameservers.',
      inputSchema: { id: domainId },
    },
    safeHandler(async ({ id }) => jsonResult(await client.request(`/v1/domains/${enc(id)}`))),
  );

  // ── Money paths ─────────────────────────────────────────────────────────
  server.registerTool(
    'otwa_register_domain',
    {
      title: 'Register a domain',
      description:
        'Registers a domain and debits the register price × years from the wallet at once (refunded ' +
        'automatically if the registry refuses). Before calling: (1) otwa_check_domain to confirm it is ' +
        'available and get the price, (2) make sure a registrant contact is saved (otwa_get_whois_contact), ' +
        '(3) show the user the total and get approval. Requires `domains:write`.',
      inputSchema: {
        domain: z.string().regex(DOMAIN_REGEX, 'Full domain name, e.g. example.com'),
        period: z.number().int().min(1).max(10).optional().describe('Years, default 1.'),
        confirm: moneyConfirm,
      },
    },
    safeHandler(async ({ domain, period, confirm }) => {
      requireMoneyConfirm(confirm, 'Registering a domain');
      return jsonResult(
        await client.request('/v1/domains', {
          method: 'POST', body: { domain, period }, idempotent: true, timeoutMs: 90_000,
        }),
      );
    }),
  );

  server.registerTool(
    'otwa_transfer_domain',
    {
      title: 'Transfer a domain in from another registrar',
      description:
        'Starts an inbound transfer with the auth (EPP) code from the current registrar and debits the ' +
        'transfer price. The domain reads `transfer_pending` until the registry completes it (usually up to ' +
        '5 days). The domain must be unlocked at the current registrar. Requires `domains:write`.',
      inputSchema: {
        domain: z.string().regex(DOMAIN_REGEX, 'Full domain name, e.g. example.com'),
        authCode: z.string().min(1).max(255).describe('Auth / EPP code from the current registrar.'),
        period: z.number().int().min(1).max(10).optional().describe('Years added on completion, default 1.'),
        confirm: moneyConfirm,
      },
    },
    safeHandler(async ({ domain, authCode, period, confirm }) => {
      requireMoneyConfirm(confirm, 'Transferring a domain in');
      return jsonResult(
        await client.request('/v1/domains/transfer-in', {
          method: 'POST', body: { domain, authCode, period }, idempotent: true, timeoutMs: 90_000,
        }),
      );
    }),
  );

  server.registerTool(
    'otwa_renew_domain',
    {
      title: 'Renew a domain',
      description:
        'Adds years to a domain at the renew price and debits the wallet at once (refunded if the registry ' +
        'refuses). Show the user the renew price × years first. Requires `domains:write`.',
      inputSchema: {
        id: domainId,
        period: z.number().int().min(1).max(10).optional().describe('Years, default 1.'),
        confirm: moneyConfirm,
      },
    },
    safeHandler(async ({ id, period, confirm }) => {
      requireMoneyConfirm(confirm, 'Renewing a domain');
      return jsonResult(
        await client.request(`/v1/domains/${enc(id)}/renew`, {
          method: 'POST', body: { period }, idempotent: true, timeoutMs: 90_000,
        }),
      );
    }),
  );

  // ── Settings ────────────────────────────────────────────────────────────
  server.registerTool(
    'otwa_set_domain_nameservers',
    {
      title: 'Set a domain\'s nameservers',
      description:
        'Replaces the delegation with 2–6 nameserver hostnames. Pointing a domain away from our nameservers ' +
        'means DNS records managed here stop answering for it — say so before changing it. Requires `domains:write`.',
      inputSchema: {
        id: domainId,
        nameservers: z.array(z.string().min(3).max(253)).min(2).max(6),
        ...mediumConfirm,
      },
    },
    safeHandler(async ({ id, nameservers }) =>
      jsonResult(await client.request(`/v1/domains/${enc(id)}/nameservers`, { method: 'PATCH', body: { nameservers } })),
    ),
  );

  server.registerTool(
    'otwa_set_domain_lock',
    {
      title: 'Lock or unlock a domain for transfer',
      description:
        'Turns the registry transfer lock on or off. Unlock only when the user is moving the domain to another ' +
        'registrar. Requires `domains:write`.',
      inputSchema: {
        id: domainId,
        locked: z.boolean(),
        ...mediumConfirm,
      },
    },
    safeHandler(async ({ id, locked }) =>
      jsonResult(await client.request(`/v1/domains/${enc(id)}/lock`, { method: 'PATCH', body: { locked } })),
    ),
  );

  server.registerTool(
    'otwa_set_domain_auto_renew',
    {
      title: 'Turn a domain\'s auto-renew on or off',
      description: 'When on, the domain renews from the wallet before it expires. Requires `domains:write`.',
      inputSchema: { id: domainId, enabled: z.boolean() },
    },
    safeHandler(async ({ id, enabled }) =>
      jsonResult(await client.request(`/v1/domains/${enc(id)}/auto-renew`, { method: 'PATCH', body: { enabled } })),
    ),
  );

  server.registerTool(
    'otwa_send_domain_authcode',
    {
      title: 'Email a domain\'s transfer auth code',
      description:
        'Emails the transfer auth code to the domain\'s registrant contact. The code is never returned to you. ' +
        'Requires `domains:write`.',
      inputSchema: { id: domainId },
    },
    safeHandler(async ({ id }) =>
      jsonResult(await client.request(`/v1/domains/${enc(id)}/send-authcode`, { method: 'POST' })),
    ),
  );

  // ── DNS ─────────────────────────────────────────────────────────────────
  server.registerTool(
    'otwa_list_dns_records',
    {
      title: 'List a domain\'s DNS records',
      description:
        'Every record in the zone on our nameservers. Names are relative (`@` = apex). `editable: false` marks ' +
        'records that cannot be changed here. `zoneExists: false` means the domain is not on our nameservers.',
      inputSchema: { id: domainId },
    },
    safeHandler(async ({ id }) => jsonResult(await client.request(`/v1/domains/${enc(id)}/dns/records`))),
  );

  server.registerTool(
    'otwa_set_dns_record',
    {
      title: 'Create or replace a DNS record set',
      description:
        'Writes ONE record set (name + type). `contents` is EVERY value of the set and REPLACES what is there — ' +
        'to add a second A record, list the existing one too (read otwa_list_dns_records first). ' +
        'MX values are "priority hostname" ("10 mail.example.com"), SRV "priority weight port target"; TXT may ' +
        'be given with or without quotes. No CNAME or NS at the apex (@). ' +
        'Requires `domains:write`.',
      inputSchema: {
        id: domainId,
        name: z.string().min(1).max(253).describe('"@" for the apex, or a name relative to the zone, e.g. "www".'),
        type: z.enum(RECORD_TYPES),
        ttl: z.number().int().min(60).max(86400).optional().describe('Seconds, 60–86400, default 3600.'),
        contents: z.array(z.string().min(1)).min(1).max(100),
        comment: z.string().max(200).optional(),
      },
    },
    safeHandler(async ({ id, name, type, ttl, contents, comment }) =>
      jsonResult(
        await client.request(`/v1/domains/${enc(id)}/dns/records`, {
          method: 'PUT', body: { name, type, ttl: ttl ?? 3600, contents, comment },
        }),
      ),
    ),
  );

  server.registerTool(
    'otwa_delete_dns_record',
    {
      title: 'Delete a DNS record set',
      description:
        'Deletes every value of one record set (name + type). Confirm with the user first — a deleted A or MX ' +
        'record takes a site or mail offline. Requires `domains:write`.',
      inputSchema: {
        id: domainId,
        name: z.string().min(1).max(253),
        type: z.enum(RECORD_TYPES),
        ...mediumConfirm,
      },
    },
    safeHandler(async ({ id, name, type }) =>
      jsonResult(
        await client.request(`/v1/domains/${enc(id)}/dns/records`, { method: 'DELETE', query: { name, type } }),
      ),
    ),
  );

  server.registerTool(
    'otwa_export_dns_zone',
    {
      title: 'Export a domain\'s zone file',
      description: 'The zone as BIND zone-file text — useful as a backup before bulk changes.',
      inputSchema: { id: domainId },
    },
    safeHandler(async ({ id }) => jsonResult(await client.request(`/v1/domains/${enc(id)}/dns/export`))),
  );

  server.registerTool(
    'otwa_import_dns_zone',
    {
      title: 'Import a BIND zone file',
      description:
        'Upserts every supported record in a BIND zone file into the zone. Record sets in the file replace the ' +
        'same name+type in the zone; anything not in the file is left alone. Returns counts of upserted, ' +
        'skipped and failed. Requires `domains:write`.',
      inputSchema: {
        id: domainId,
        zonefile: z.string().min(1).max(512 * 1024),
        ...mediumConfirm,
      },
    },
    safeHandler(async ({ id, zonefile }) =>
      jsonResult(
        await client.request(`/v1/domains/${enc(id)}/dns/import`, { method: 'POST', body: { zonefile }, timeoutMs: 120_000 }),
      ),
    ),
  );
}
