import { describe, it, expect } from 'vitest';
import { registerResellerTools } from '../src/tools/reseller';
import { FakeOtwaClient, asOtwaClient, captureHandlers, resultText } from './_harness';

describe('otwa_get_reseller_state', () => {
  it('GETs /v1/reseller and returns the state JSON', async () => {
    const client = new FakeOtwaClient().on('GET /v1/reseller', {
      enabled: true,
      enabledAt: '2026-05-01T00:00:00Z',
      balance: 250,
      minBalance: 100,
      eligible: true,
      discountPct: 15,
      discountOverride: null,
      tierName: 'Growth',
      gmv30d: 600,
      nextTier: { name: 'Scale', gmvRequired: 2000, gmvRemaining: 1400, discountPct: 20 },
      tiers: [
        { name: 'Starter', min30dGmv: 0, discountPct: 10 },
        { name: 'Growth', min30dGmv: 500, discountPct: 15 },
        { name: 'Scale', min30dGmv: 2000, discountPct: 20 },
      ],
    });
    const { server, handlers } = captureHandlers();
    registerResellerTools(server, asOtwaClient(client));

    const result = await handlers['otwa_get_reseller_state']!({});
    const parsed = JSON.parse(resultText(result));
    expect(parsed.enabled).toBe(true);
    expect(parsed.tierName).toBe('Growth');
    expect(parsed.nextTier.name).toBe('Scale');
    expect(parsed.nextTier.gmvRemaining).toBe(1400);
    expect(client.calls).toEqual([
      { method: 'GET', path: '/v1/reseller', body: undefined, query: undefined, idempotent: undefined },
    ]);
  });
});
