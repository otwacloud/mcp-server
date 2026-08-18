import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OtwaClient } from '../client/http';
import type { WebhookSummary } from '../client/types';
import { mediumConfirm } from '../guards/confirm';
import { jsonResult, safeHandler } from './_helpers';

export function registerWebhookTools(server: McpServer, client: OtwaClient): void {
  server.registerTool(
    'otwa_list_webhooks',
    {
      title: 'List webhook subscriptions',
      description:
        'Returns every webhook the account has registered, with delivery URL and the events each one ' +
        'subscribes to (e.g. server.created, invoice.paid).',
      inputSchema: {},
    },
    safeHandler(async () => {
      const res = await client.request<WebhookSummary[]>('/v1/webhooks');
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_create_webhook',
    {
      title: 'Register a new webhook subscription',
      description:
        'Creates a webhook subscription. otwa.cloud will POST signed JSON to the given URL whenever any ' +
        'of the listed events fire. The signing secret is returned ONCE in this response — save it; the ' +
        'API will not reveal it again unless explicitly rotated.',
      inputSchema: {
        url: z
          .string()
          .url()
          .describe('HTTPS endpoint that will receive delivery POSTs. Must accept JSON.'),
        events: z
          .array(z.string().min(1))
          .min(1)
          .describe(
            'Event names to subscribe to, e.g. ["server.created", "server.destroyed", "invoice.paid"].',
          ),
      },
    },
    safeHandler(async ({ url, events }) => {
      const res = await client.request<WebhookSummary>('/v1/webhooks', {
        method: 'POST',
        body: { url, events },
      });
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_delete_webhook',
    {
      title: 'Delete a webhook subscription',
      description:
        'Permanently removes a webhook. Any in-flight deliveries finish; nothing further is sent. ' +
        'Cannot be undone — the consumer just needs to re-create it.',
      inputSchema: {
        id: z.string().describe('Webhook UUID.'),
        ...mediumConfirm,
      },
    },
    safeHandler(async ({ id }) => {
      const res = await client.request(`/v1/webhooks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      return jsonResult(res);
    }),
  );
}
