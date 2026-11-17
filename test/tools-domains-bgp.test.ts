import { describe, it, expect } from 'vitest';
import { registerDomainTools } from '../src/tools/domains';
import { registerBgpTools } from '../src/tools/bgp';
import { FakeOtwaClient, asOtwaClient, captureHandlers, resultText } from './_harness';

function setup(register: typeof registerDomainTools, client: FakeOtwaClient) {
  const { server, handlers } = captureHandlers();
  register(server, asOtwaClient(client));
  return handlers;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isErr = (r: any) => r?.isError === true;

describe('domain tools', () => {
  it('otwa_check_domain sends q, joined tlds and limit as query', async () => {
    const client = new FakeOtwaClient().on('GET /v1/domains/check', { results: [] });
    const h = setup(registerDomainTools, client);
    await h['otwa_check_domain']!({ query: 'example', tlds: ['com', 'io'], limit: 5 });
    expect(client.calls[0]).toMatchObject({ path: '/v1/domains/check', query: { q: 'example', tlds: 'com,io', limit: 5 } });
  });

  it('otwa_register_domain refuses without confirm and calls nothing', async () => {
    const client = new FakeOtwaClient();
    const h = setup(registerDomainTools, client);
    const r = await h['otwa_register_domain']!({ domain: 'example.com' });
    expect(isErr(r)).toBe(true);
    expect(resultText(r)).toMatch(/confirm: true/);
    expect(client.calls).toHaveLength(0);
  });

  it('otwa_register_domain with confirm POSTs once, idempotent', async () => {
    const client = new FakeOtwaClient().on('POST /v1/domains', { id: 'd1', domain: 'example.com' });
    const h = setup(registerDomainTools, client);
    await h['otwa_register_domain']!({ domain: 'example.com', period: 2, confirm: true });
    expect(client.calls[0]).toMatchObject({
      method: 'POST', path: '/v1/domains', body: { domain: 'example.com', period: 2 }, idempotent: true,
    });
  });

  it('transfer and renew are confirm-gated too', async () => {
    const client = new FakeOtwaClient();
    const h = setup(registerDomainTools, client);
    expect(isErr(await h['otwa_transfer_domain']!({ domain: 'a.com', authCode: 'x' }))).toBe(true);
    expect(isErr(await h['otwa_renew_domain']!({ id: 'd1' }))).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it('otwa_set_dns_record PUTs the whole set with a default TTL', async () => {
    const client = new FakeOtwaClient().on('PUT /v1/domains/d1/dns/records', { ok: true });
    const h = setup(registerDomainTools, client);
    await h['otwa_set_dns_record']!({ id: 'd1', name: 'www', type: 'A', contents: ['203.0.113.1'] });
    expect(client.calls[0]).toMatchObject({
      method: 'PUT', path: '/v1/domains/d1/dns/records',
      body: { name: 'www', type: 'A', ttl: 3600, contents: ['203.0.113.1'] },
    });
  });

  it('otwa_delete_dns_record sends name + type as query, not a body', async () => {
    const client = new FakeOtwaClient().on('DELETE /v1/domains/d1/dns/records', { ok: true });
    const h = setup(registerDomainTools, client);
    await h['otwa_delete_dns_record']!({ id: 'd1', name: 'www', type: 'A', confirm: true });
    expect(client.calls[0]).toMatchObject({ method: 'DELETE', query: { name: 'www', type: 'A' }, body: undefined });
  });

  it('ids are URL-encoded', async () => {
    const client = new FakeOtwaClient().on('GET /v1/domains/a%2Fb', {});
    const h = setup(registerDomainTools, client);
    await h['otwa_get_domain']!({ id: 'a/b' });
    expect(client.calls[0]?.path).toBe('/v1/domains/a%2Fb');
  });
});

describe('BGP tools', () => {
  it('otwa_create_bgp_session refuses without confirm', async () => {
    const client = new FakeOtwaClient();
    const h = setup(registerBgpTools, client);
    const r = await h['otwa_create_bgp_session']!({ serverId: 's', label: 'edge', customerAsn: 'AS64500' });
    expect(isErr(r)).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it('otwa_create_bgp_session with confirm POSTs the order', async () => {
    const client = new FakeOtwaClient().on('POST /v1/bgp/sessions', { session: { id: 'b1' }, rejected: [] });
    const h = setup(registerBgpTools, client);
    await h['otwa_create_bgp_session']!({
      serverId: 's', label: 'edge', customerAsn: 'AS64500', prefixes: ['198.51.100.0/24'], confirm: true,
    });
    expect(client.calls[0]).toMatchObject({
      method: 'POST', path: '/v1/bgp/sessions', idempotent: true,
      body: { serverId: 's', label: 'edge', customerAsn: 'AS64500', prefixes: ['198.51.100.0/24'] },
    });
  });

  it('prefix add/remove and terminate hit the right paths', async () => {
    const client = new FakeOtwaClient()
      .on('POST /v1/bgp/sessions/b1/prefixes', { id: 'p1' })
      .on('DELETE /v1/bgp/sessions/b1/prefixes/p1', { ok: true })
      .on('DELETE /v1/bgp/sessions/b1', { ok: true });
    const h = setup(registerBgpTools, client);
    await h['otwa_add_bgp_prefix']!({ id: 'b1', prefix: '198.51.100.0/24' });
    await h['otwa_remove_bgp_prefix']!({ id: 'b1', prefixId: 'p1', confirm: true });
    await h['otwa_terminate_bgp_session']!({ id: 'b1', confirm: true });
    expect(client.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /v1/bgp/sessions/b1/prefixes',
      'DELETE /v1/bgp/sessions/b1/prefixes/p1',
      'DELETE /v1/bgp/sessions/b1',
    ]);
  });
});
