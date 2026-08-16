import { describe, it, expect } from 'vitest';
import { registerAddonTools } from '../src/tools/addons';
import { FakeOtwaClient, asOtwaClient, captureHandlers, isError, resultText } from './_harness';

const ADDONS = {
  addons: [
    {
      id: 'seoip7pk',
      name: 'SEO IP Pack',
      type: 'diverse-ip',
      price: 44.1,
      retailPrice: 49,
      proratedPrice: 20.58,
      owned: false,
      ownedByType: false,
      featured: true,
      available: true,
      stockNote: null,
    },
  ],
  daysRemaining: 14,
};

describe('addon tools', () => {
  it('otwa_list_addons GETs /v1/servers/<id>/addons', async () => {
    const client = new FakeOtwaClient().on('GET /v1/servers/s1/addons', ADDONS);
    const { server, handlers } = captureHandlers();
    registerAddonTools(server, asOtwaClient(client));

    const res = await handlers['otwa_list_addons']!({ id: 's1' });
    expect(client.calls[0]).toMatchObject({ method: 'GET', path: '/v1/servers/s1/addons' });
    // The wholesale/retail split is the whole point of the field — a caller
    // building a markup off the wrong one is the bug this replaced.
    expect(resultText(res)).toContain('"retailPrice": 49');
    expect(resultText(res)).toContain('"price": 44.1');
  });

  it('otwa_purchase_addon refuses to spend money without confirm:true', async () => {
    const client = new FakeOtwaClient().on('POST /v1/servers/s1/addons', { ok: true });
    const { server, handlers } = captureHandlers();
    registerAddonTools(server, asOtwaClient(client));

    const res = await handlers['otwa_purchase_addon']!({ id: 's1', addonId: 'seoip7pk' });
    expect(isError(res)).toBe(true);
    expect(client.calls).toHaveLength(0); // nothing reached the API
  });

  it('otwa_purchase_addon POSTs the addonId once confirmed', async () => {
    const client = new FakeOtwaClient().on('POST /v1/servers/s1/addons', {
      addon: { id: 'seoip7pk' },
      prorated: 20.58,
      allocatedIpCount: 7,
    });
    const { server, handlers } = captureHandlers();
    registerAddonTools(server, asOtwaClient(client));

    await handlers['otwa_purchase_addon']!({ id: 's1', addonId: 'seoip7pk', confirm: true });
    expect(client.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/servers/s1/addons',
      body: { addonId: 'seoip7pk' },
    });
  });

  it('otwa_remove_addon DELETEs the add-on', async () => {
    const client = new FakeOtwaClient().on('DELETE /v1/servers/s1/addons/seoip7pk', {
      removed: { id: 'seoip7pk' },
      releasedIpCount: 7,
      refunded: 0,
    });
    const { server, handlers } = captureHandlers();
    registerAddonTools(server, asOtwaClient(client));

    await handlers['otwa_remove_addon']!({ id: 's1', addonId: 'seoip7pk', confirm: true });
    expect(client.calls[0]).toMatchObject({
      method: 'DELETE',
      path: '/v1/servers/s1/addons/seoip7pk',
    });
  });

  it('surfaces an upstream refusal instead of throwing', async () => {
    const client = new FakeOtwaClient().onThrow(
      'POST /v1/servers/s1/addons',
      new Error('This server already has a "extra-ip" add-on (8 Additional IPs). Remove it first.'),
    );
    const { server, handlers } = captureHandlers();
    registerAddonTools(server, asOtwaClient(client));

    const res = await handlers['otwa_purchase_addon']!({ id: 's1', addonId: 'jd9o9deo', confirm: true });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain('Remove it first');
  });

  it('URL-encodes the server id and addon id', async () => {
    const client = new FakeOtwaClient().on('DELETE /v1/servers/s%20one/addons/a%2Fb', { removed: {} });
    const { server, handlers } = captureHandlers();
    registerAddonTools(server, asOtwaClient(client));

    await handlers['otwa_remove_addon']!({ id: 's one', addonId: 'a/b', confirm: true });
    expect(client.calls[0]?.path).toBe('/v1/servers/s%20one/addons/a%2Fb');
  });
});
