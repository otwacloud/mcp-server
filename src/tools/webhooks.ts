import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OtwaClient } from '../client/http';
import type { WebhookSummary } from '../client/types';
import { mediumConfirm } from '../guards/confirm';
import { jsonResult, safeHandler } from './_helpers';

export function registerWebhookTools(server: McpServer, client: OtwaClient): void {
  server.registerTool(
    'otwa_list_webhook_events',
    {
      title: 'List the events a webhook can subscribe to',
      description:
        'Every event name a subscription may list (or "*" for all) — server, pool, billing, wallet, domain and ' +
        'BGP events. Read this before otwa_create_webhook instead of guessing names.',
      inputSchema: {},
    },
    safeHandler(async () => jsonResult(await client.request('/v1/webhooks/events'))),
  );

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
            'Event names to subscribe to, e.g. ["server.created", "server.deleted", "invoice.paid"], or ["*"]. ' +
              'Valid names: otwa_list_webhook_events.',
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
    'otwa_get_webhook',
    {
      title: 'Get one webhook subscription',
      description: 'One subscription: URL, events, active flag, description. The secret is masked.',
      inputSchema: { id: z.string().describe('Webhook UUID.') },
    },
    safeHandler(async ({ id }) => jsonResult(await client.request(`/v1/webhooks/${encodeURIComponent(id)}`))),
  );

  server.registerTool(
    'otwa_update_webhook',
    {
      title: 'Update a webhook subscription',
      description:
        'Changes the URL, the events, the description, or pauses/resumes deliveries (`isActive`). Only the ' +
        'fields given change. Requires `webhooks:write`.',
      inputSchema: {
        id: z.string().describe('Webhook UUID.'),
        url: z.string().url().optional().describe('New HTTPS endpoint.'),
        events: z.array(z.string().min(1)).min(1).optional(),
        isActive: z.boolean().optional().describe('false pauses deliveries, true resumes them.'),
        description: z.string().max(255).optional(),
      },
    },
    safeHandler(async ({ id, url, events, isActive, description }) =>
      jsonResult(
        await client.request(`/v1/webhooks/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: { url, events, isActive, description },
        }),
      ),
    ),
  );

  server.registerTool(
    'otwa_rotate_webhook_secret',
    {
      title: 'Rotate a webhook\'s signing secret',
      description:
        'Issues a new signing secret, returned ONCE in this response. The old one stops working immediately, ' +
        'so the receiver must be updated at the same time — warn the user. Requires `webhooks:write`.',
      inputSchema: { id: z.string().describe('Webhook UUID.'), ...mediumConfirm },
    },
    safeHandler(async ({ id }) =>
      jsonResult(await client.request(`/v1/webhooks/${encodeURIComponent(id)}/rotate-secret`, { method: 'POST' })),
    ),
  );

  server.registerTool(
    'otwa_list_webhook_deliveries',
    {
      title: 'List a webhook\'s recent deliveries',
      description:
        'Recent delivery attempts, newest first: event, HTTP status the receiver answered, duration and whether ' +
        'it was delivered. Use to debug a receiver. Kept for 30 days.',
      inputSchema: {
        id: z.string().describe('Webhook UUID.'),
        limit: z.number().int().min(1).max(100).optional().describe('Default 50.'),
      },
    },
    safeHandler(async ({ id, limit }) =>
      jsonResult(
        await client.request(`/v1/webhooks/${encodeURIComponent(id)}/deliveries`, { query: { limit } }),
      ),
    ),
  );

  server.registerTool(
    'otwa_redeliver_webhook',
    {
      title: 'Redeliver one webhook delivery',
      description: 'Sends a past delivery again (failed or not) — useful after fixing a receiver. Requires `webhooks:write`.',
      inputSchema: {
        id: z.string().describe('Webhook UUID.'),
        deliveryId: z.string().describe('Delivery id from otwa_list_webhook_deliveries.'),
      },
    },
    safeHandler(async ({ id, deliveryId }) =>
      jsonResult(
        await client.request(
          `/v1/webhooks/${encodeURIComponent(id)}/deliveries/${encodeURIComponent(deliveryId)}/redeliver`,
          { method: 'POST' },
        ),
      ),
    ),
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
