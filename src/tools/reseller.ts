import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OtwaClient } from '../client/http';
import type { ResellerStateResponse } from '../client/types';
import { jsonResult, safeHandler } from './_helpers';

export function registerResellerTools(server: McpServer, client: OtwaClient): void {
  server.registerTool(
    'otwa_get_reseller_state',
    {
      title: 'Get reseller program state',
      description:
        "Returns the caller's reseller program state: whether they're enrolled, " +
        'current tier and discount percentage, rolling 30-day GMV, next tier ' +
        'progression (GMV required + remaining), and minimum balance threshold. ' +
        'Use this when the user asks about their reseller status, commission, ' +
        'tier, discount, or how close they are to the next tier. Read-only.',
      inputSchema: {},
    },
    safeHandler(async () => {
      const state = await client.request<ResellerStateResponse>('/v1/reseller');
      return jsonResult(state);
    }),
  );
}
