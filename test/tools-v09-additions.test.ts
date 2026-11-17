import { describe, it, expect } from 'vitest';
import { registerServerTools } from '../src/tools/servers';
import { registerPoolTools } from '../src/tools/pools';
import { registerBillingTools } from '../src/tools/billing';
import { registerWebhookTools } from '../src/tools/webhooks';
import { FakeOtwaClient, asOtwaClient, captureHandlers } from './_harness';

/** Tools added in 0.9.0 to existing surfaces: usage history, billing extend,
 *  pool lifecycle, wallet + invoice document, the rest of webhooks. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isErr = (r: any) => r?.isError === true;

describe('0.9.0 additions', () => {
  it('stats history defaults range to 1h', async () => {
    const client = new FakeOtwaClient().on('GET /v1/servers/s1/stats/history', { points: [] });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));
    await handlers['otwa_get_server_stats_history']!({ id: 's1' });
    expect(client.calls[0]).toMatchObject({ path: '/v1/servers/s1/stats/history', query: { range: '1h' } });
  });

  it('server + pool billing extend are confirm-gated', async () => {
    const client = new FakeOtwaClient().on('POST /v1/pools/p1/billing/extend', { extended: true });
    const s = captureHandlers();
    registerServerTools(s.server, asOtwaClient(client));
    const p = captureHandlers();
    registerPoolTools(p.server, asOtwaClient(client));
    expect(isErr(await s.handlers['otwa_extend_server_billing']!({ id: 's1', until: '2026-12-31T00:00:00Z' }))).toBe(true);
    expect(isErr(await p.handlers['otwa_extend_pool_billing']!({ id: 'p1', until: '2026-12-31T00:00:00Z' }))).toBe(true);
    expect(client.calls).toHaveLength(0);
    await p.handlers['otwa_extend_pool_billing']!({ id: 'p1', until: '2026-12-31T00:00:00Z', confirm: true });
    expect(client.calls[0]).toMatchObject({ method: 'POST', body: { until: '2026-12-31T00:00:00Z' } });
  });

  it('pool usage / suspend / restore paths', async () => {
    const client = new FakeOtwaClient()
      .on('GET /v1/pools/p1/usage', { vmCount: 1 })
      .on('POST /v1/pools/p1/suspend', { poweredOff: 1 })
      .on('POST /v1/pools/p1/restore', { restarted: 1 });
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));
    await handlers['otwa_get_pool_usage']!({ id: 'p1' });
    await handlers['otwa_suspend_pool']!({ id: 'p1', confirm: true });
    await handlers['otwa_restore_pool']!({ id: 'p1' });
    expect(client.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /v1/pools/p1/usage', 'POST /v1/pools/p1/suspend', 'POST /v1/pools/p1/restore',
    ]);
  });

  it('deposit address defaults to tron; wallet transactions page', async () => {
    const client = new FakeOtwaClient()
      .on('POST /v1/wallet/deposit-address', { address: 'T...' })
      .on('GET /v1/wallet/transactions', []);
    const { server, handlers } = captureHandlers();
    registerBillingTools(server, asOtwaClient(client));
    await handlers['otwa_get_deposit_address']!({});
    await handlers['otwa_list_wallet_transactions']!({ limit: 10 });
    expect(client.calls[0]).toMatchObject({ method: 'POST', body: { chain: 'tron' } });
    expect(client.calls[1]).toMatchObject({ query: { limit: 10 } });
  });

  it('invoice document comes back as an embedded resource', async () => {
    const pdf = new Response(Buffer.from('%PDF-1.4 test'), {
      headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="INV-1.pdf"' },
    });
    const client = new FakeOtwaClient().on('GET /v1/billing/invoices/i1/pdf', pdf);
    const { server, handlers } = captureHandlers();
    registerBillingTools(server, asOtwaClient(client));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await handlers['otwa_get_invoice_pdf']!({ id: 'i1' });
    const res = r.content.find((c: { type: string }) => c.type === 'resource').resource;
    expect(res.mimeType).toBe('application/pdf');
    expect(res.uri).toContain('INV-1.pdf');
    expect(Buffer.from(res.blob, 'base64').toString()).toBe('%PDF-1.4 test');
  });

  it('webhook events, update, rotate, deliveries, redeliver', async () => {
    const client = new FakeOtwaClient()
      .on('GET /v1/webhooks/events', { events: [] })
      .on('PATCH /v1/webhooks/w1', {})
      .on('POST /v1/webhooks/w1/rotate-secret', { secret: 'x' })
      .on('GET /v1/webhooks/w1/deliveries', [])
      .on('POST /v1/webhooks/w1/deliveries/d1/redeliver', { success: true });
    const { server, handlers } = captureHandlers();
    registerWebhookTools(server, asOtwaClient(client));
    await handlers['otwa_list_webhook_events']!({});
    await handlers['otwa_update_webhook']!({ id: 'w1', isActive: false });
    await handlers['otwa_rotate_webhook_secret']!({ id: 'w1', confirm: true });
    await handlers['otwa_list_webhook_deliveries']!({ id: 'w1', limit: 5 });
    await handlers['otwa_redeliver_webhook']!({ id: 'w1', deliveryId: 'd1' });
    expect(client.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /v1/webhooks/events',
      'PATCH /v1/webhooks/w1',
      'POST /v1/webhooks/w1/rotate-secret',
      'GET /v1/webhooks/w1/deliveries',
      'POST /v1/webhooks/w1/deliveries/d1/redeliver',
    ]);
    expect(client.calls[1]?.body).toMatchObject({ isActive: false });
  });
});
