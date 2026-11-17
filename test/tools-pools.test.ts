import { describe, it, expect } from 'vitest';
import { registerPoolTools } from '../src/tools/pools';
import { FakeOtwaClient, asOtwaClient, captureHandlers, isError, resultText } from './_harness';

const POOL = {
  id: 'p1',
  label: 'prod-cluster',
  status: 'active',
  vcpuQuota: 16,
  ramMbQuota: 32768,
  diskGbQuota: 1000,
  ipQuota: 16,
  monthlyPrice: '155.00',
  usage: { vcpuUsed: 6, ramMbUsed: 12288, diskGbUsed: 300, ipsUsed: 3, vmCount: 3 },
  policy: { vcpuOvercommit: 3, mhzPerVcpu: 1000 },
};

const SELECTION = { vcpu: 16, ram2gb: 16, disk100: 10, ip16: 1 };

describe('capacity-pool tools', () => {
  it('otwa_list_pools GETs /v1/pools', async () => {
    const client = new FakeOtwaClient().on('GET /v1/pools', [POOL]);
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));

    const res = await handlers['otwa_list_pools']!({});
    expect(client.calls[0]).toMatchObject({ method: 'GET', path: '/v1/pools' });
    expect(resultText(res)).toContain('prod-cluster');
  });

  it('otwa_get_pool returns usage AND the policy the UI must not hardcode', async () => {
    const client = new FakeOtwaClient().on('GET /v1/pools/p1', POOL);
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));

    const res = await handlers['otwa_get_pool']!({ id: 'p1' });
    // Both halves matter: quota alone cannot answer "will it fit", and a caller
    // that assumes the overcommit ratio eventually contradicts the server.
    expect(resultText(res)).toContain('"vcpuUsed": 6');
    expect(resultText(res)).toContain('"vcpuOvercommit": 3');
  });

  it('otwa_get_pool_pricing reads the rates the pool was SOLD at, not the catalogue', async () => {
    const client = new FakeOtwaClient().on('GET /v1/pools/p1/pricing', {
      perVcpuUsd: 1.5,
      per2gbRamUsd: 6,
      vcpu: { min: 8, max: 128, step: 1 },
    });
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));

    await handlers['otwa_get_pool_pricing']!({ id: 'p1' });
    expect(client.calls[0]).toMatchObject({ method: 'GET', path: '/v1/pools/p1/pricing' });
  });

  it('otwa_quote_pool POSTs the selection and charges nothing', async () => {
    const client = new FakeOtwaClient().on('POST /v1/pools/quote', {
      monthly: 155,
      breakdown: { vcpu: 24, ram: 96, disk: 35, ips: 56 },
    });
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));

    const res = await handlers['otwa_quote_pool']!({ productId: 'prod1', ...SELECTION });
    expect(client.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/pools/quote',
      body: { productId: 'prod1', ...SELECTION },
    });
    expect(resultText(res)).toContain('"monthly": 155');
  });

  it('otwa_create_pool refuses to spend money without confirm:true', async () => {
    const client = new FakeOtwaClient().on('POST /v1/pools', POOL);
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));

    const res = await handlers['otwa_create_pool']!({ productId: 'prod1', ...SELECTION });
    expect(isError(res)).toBe(true);
    expect(client.calls).toHaveLength(0); // nothing reached the API
  });

  it('otwa_create_pool POSTs the whole selection once confirmed', async () => {
    const client = new FakeOtwaClient().on('POST /v1/pools', POOL);
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));

    await handlers['otwa_create_pool']!({
      productId: 'prod1', label: 'prod-cluster', ...SELECTION, confirm: true,
    });
    expect(client.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/pools',
      body: { productId: 'prod1', label: 'prod-cluster', ...SELECTION },
      idempotent: true,
    });
  });

  it('otwa_quote_pool_resize prices without applying', async () => {
    const client = new FakeOtwaClient().on('POST /v1/pools/p1/resize-quote', {
      previousMonthly: 155, monthly: 310, delta: 155, chargeNow: 77.5,
    });
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));

    const res = await handlers['otwa_quote_pool_resize']!({
      id: 'p1', vcpu: 32, ram2gb: 32, disk100: 20, ip16: 2,
    });
    expect(client.calls[0]).toMatchObject({ method: 'POST', path: '/v1/pools/p1/resize-quote' });
    // chargeNow is the number the user has to see BEFORE the resize — the whole
    // reason this tool exists separately from otwa_resize_pool.
    expect(resultText(res)).toContain('"chargeNow": 77.5');
  });

  it('otwa_resize_pool refuses without confirm:true — growing is a purchase', async () => {
    const client = new FakeOtwaClient().on('PATCH /v1/pools/p1', { pool: POOL });
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));

    const res = await handlers['otwa_resize_pool']!({
      id: 'p1', vcpu: 32, ram2gb: 32, disk100: 20, ip16: 2,
    });
    expect(isError(res)).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it('otwa_resize_pool PATCHes the WHOLE shape, not a delta', async () => {
    const client = new FakeOtwaClient().on('PATCH /v1/pools/p1', {
      pool: POOL, previousMonthly: 155, monthly: 310, charged: 77.5,
    });
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));

    await handlers['otwa_resize_pool']!({
      id: 'p1', vcpu: 32, ram2gb: 32, disk100: 20, ip16: 2, confirm: true,
    });
    expect(client.calls[0]).toMatchObject({
      method: 'PATCH',
      path: '/v1/pools/p1',
      body: { vcpu: 32, ram2gb: 32, disk100: 20, ip16: 2 },
    });
  });

  it('otwa_list_pool_ips GETs the block', async () => {
    const client = new FakeOtwaClient().on('GET /v1/pools/p1/ips', [
      { ip: '46.31.78.102', assignedTo: { id: 's1', label: 'web-1' }, isPrimary: true },
      { ip: '46.31.78.103', assignedTo: null, isPrimary: false },
    ]);
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));

    const res = await handlers['otwa_list_pool_ips']!({ id: 'p1' });
    expect(resultText(res)).toContain('46.31.78.103');
  });

  it('otwa_assign_pool_ips sends every change in ONE call', async () => {
    const client = new FakeOtwaClient().on('POST /v1/pools/p1/ips/apply', { applied: 2, changes: [] });
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));

    const changes = [
      { ip: '46.31.78.103', serverId: 's2' },
      { ip: '46.31.78.104', serverId: null },
    ];
    await handlers['otwa_assign_pool_ips']!({ id: 'p1', changes, confirm: true });
    // One request, one router reprogramming. The endpoint allows 6/min, so a
    // per-address loop would be rate-limited on a modest block.
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/pools/p1/ips/apply',
      body: { changes },
    });
  });

  it('otwa_terminate_pool refuses when expectedLabel does not match', async () => {
    const client = new FakeOtwaClient()
      .on('GET /v1/pools/p1', POOL)
      .on('DELETE /v1/pools/p1', { poweredOff: 3, ipsReleased: 16 });
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));

    const res = await handlers['otwa_terminate_pool']!({
      id: 'p1', expectedLabel: 'staging-cluster', confirm: true, iAcknowledgeDataLoss: true,
    });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain('does not match');
    // It read the pool to compare, but never issued the DELETE.
    expect(client.calls.map(c => c.method)).toEqual(['GET']);
  });

  it('otwa_terminate_pool DELETEs when the label matches', async () => {
    const client = new FakeOtwaClient()
      .on('GET /v1/pools/p1', POOL)
      .on('DELETE /v1/pools/p1', { poweredOff: 3, ipsReleased: 16 });
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));

    const res = await handlers['otwa_terminate_pool']!({
      id: 'p1', expectedLabel: 'prod-cluster', confirm: true, iAcknowledgeDataLoss: true,
    });
    expect(client.calls[1]).toMatchObject({ method: 'DELETE', path: '/v1/pools/p1' });
    expect(resultText(res)).toContain('"ipsReleased": 16');
  });

  it('surfaces an upstream refusal instead of throwing', async () => {
    const client = new FakeOtwaClient().onThrow(
      'POST /v1/pools',
      new Error('Insufficient balance. Required: $155.00, available: $12.00'),
    );
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));

    const res = await handlers['otwa_create_pool']!({ productId: 'prod1', ...SELECTION, confirm: true });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain('Insufficient balance');
  });

  it('URL-encodes the pool id on every per-pool path', async () => {
    const client = new FakeOtwaClient().on('GET /v1/pools/p%20one/ips', []);
    const { server, handlers } = captureHandlers();
    registerPoolTools(server, asOtwaClient(client));

    await handlers['otwa_list_pool_ips']!({ id: 'p one' });
    expect(client.calls[0]?.path).toBe('/v1/pools/p%20one/ips');
  });
});
