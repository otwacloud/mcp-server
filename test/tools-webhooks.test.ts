import { describe, it, expect } from 'vitest';
import { registerWebhookTools } from '../src/tools/webhooks';
import { FakeOtwaClient, asOtwaClient, captureHandlers, resultText } from './_harness';

describe('webhook tools', () => {
  it('otwa_list_webhooks GETs /v1/webhooks', async () => {
    const client = new FakeOtwaClient().on('GET /v1/webhooks', [
      { id: 'w1', url: 'https://example.com/hook', events: ['server.created'] },
    ]);
    const { server, handlers } = captureHandlers();
    registerWebhookTools(server, asOtwaClient(client));

    await handlers['otwa_list_webhooks']!({});
    expect(client.calls[0]?.path).toBe('/v1/webhooks');
  });

  it('otwa_create_webhook POSTs body with url + events', async () => {
    const client = new FakeOtwaClient().on('POST /v1/webhooks', {
      id: 'w2', url: 'https://x', events: ['e'], secret: 'shh',
    });
    const { server, handlers } = captureHandlers();
    registerWebhookTools(server, asOtwaClient(client));

    const result = await handlers['otwa_create_webhook']!({
      url: 'https://hooks.example.com/ingest',
      events: ['server.created', 'invoice.paid'],
    });
    const parsed = JSON.parse(resultText(result));
    expect(parsed.id).toBe('w2');
    expect(client.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/webhooks',
      body: {
        url: 'https://hooks.example.com/ingest',
        events: ['server.created', 'invoice.paid'],
      },
    });
  });

  it('otwa_delete_webhook DELETEs /v1/webhooks/<id>', async () => {
    const client = new FakeOtwaClient().on('DELETE /v1/webhooks/w-123', { ok: true });
    const { server, handlers } = captureHandlers();
    registerWebhookTools(server, asOtwaClient(client));

    await handlers['otwa_delete_webhook']!({ id: 'w-123', confirm: true });
    expect(client.calls[0]).toMatchObject({
      method: 'DELETE',
      path: '/v1/webhooks/w-123',
    });
  });
});
