import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OtwaClient } from '../client/http';
import { jsonResult, safeHandler } from './_helpers';

const HOSTNAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

export function registerNetworkingTools(server: McpServer, client: OtwaClient): void {
  server.registerTool(
    'otwa_list_server_ips',
    {
      title: 'List all IPs assigned to a server',
      description:
        'Returns every IP attached to a server (primary + additional), with gateway, netmask, CIDR, ' +
        'and current PTR (reverse DNS).',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
      },
    },
    safeHandler(async ({ id }) => {
      const ips = await client.request(`/v1/servers/${encodeURIComponent(id)}/ips`);
      return jsonResult(ips);
    }),
  );

  server.registerTool(
    'otwa_set_ptr',
    {
      title: 'Set the PTR record (reverse DNS) for a server IP',
      description:
        'Sets the reverse DNS hostname for an IP attached to a server. Changes propagate to PowerDNS ' +
        'within seconds. Useful for mail servers and anything that needs forward-confirmed reverse DNS.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
        ip: z.string().describe('IPv4 address. Must already be attached to this server.'),
        hostname: z
          .string()
          .max(253)
          .regex(HOSTNAME_REGEX, 'Hostname must be a valid FQDN (letters/digits/hyphens/dots).')
          .describe('FQDN to publish — e.g. "mail.example.com". Should resolve forward to the same IP.'),
      },
    },
    safeHandler(async ({ id, ip, hostname }) => {
      const res = await client.request(
        `/v1/servers/${encodeURIComponent(id)}/ips/${encodeURIComponent(ip)}/ptr`,
        { method: 'PUT', body: { hostname } },
      );
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_delete_ptr',
    {
      title: 'Remove the PTR record for a server IP',
      description: 'Removes the reverse DNS hostname for an IP, returning it to the otwa.cloud default.',
      inputSchema: {
        id: z.string().describe('Server UUID.'),
        ip: z.string().describe('IPv4 address.'),
      },
    },
    safeHandler(async ({ id, ip }) => {
      const res = await client.request(
        `/v1/servers/${encodeURIComponent(id)}/ips/${encodeURIComponent(ip)}/ptr`,
        { method: 'DELETE' },
      );
      return jsonResult(res);
    }),
  );
}
