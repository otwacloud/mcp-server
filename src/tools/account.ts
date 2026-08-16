import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OtwaClient } from '../client/http';
import type { AccountResponse } from '../client/types';
import { jsonResult, safeHandler } from './_helpers';

export function registerAccountTools(server: McpServer, client: OtwaClient): void {
  server.registerTool(
    'otwa_account',
    {
      title: 'Get otwa.cloud account info',
      description:
        'Returns the authenticated user account: id, email, name, balance, tier, signup date. ' +
        'Call this first to confirm which account the current API key belongs to before any other operation.',
      inputSchema: {},
    },
    safeHandler(async () => {
      const account = await client.request<AccountResponse>('/v1/account');
      return jsonResult(account);
    }),
  );
}
