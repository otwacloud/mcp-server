import { describe, it, expect } from 'vitest';
import { registerNetworkingTools } from '../src/tools/networking';
import { FakeOtwaClient, asOtwaClient, captureHandlers } from './_harness';

describe('networking tools', () => {
  it('otwa_list_server_ips GETs /v1/servers/<id>/ips', async () => {
    const client = new FakeOtwaClient().on('GET /v1/servers/s1/ips', [
      { ip: '1.2.3.4', ptr: 'host.example.com' },
    ]);
    const { server, handlers } = captureHandlers();
    registerNetworkingTools(server, asOtwaClient(client));

    await handlers['otwa_list_server_ips']!({ id: 's1' });
    expect(client.calls[0]?.path).toBe('/v1/servers/s1/ips');
  });

  it('otwa_set_ptr PUTs the PTR with the new hostname', async () => {
    const client = new FakeOtwaClient().on('PUT /v1/servers/s1/ips/1.2.3.4/ptr', { ok: true });
    const { server, handlers } = captureHandlers();
    registerNetworkingTools(server, asOtwaClient(client));

    await handlers['otwa_set_ptr']!({ id: 's1', ip: '1.2.3.4', hostname: 'mail.example.com' });
    expect(client.calls[0]).toMatchObject({
      method: 'PUT',
      path: '/v1/servers/s1/ips/1.2.3.4/ptr',
      body: { hostname: 'mail.example.com' },
    });
  });

  it('otwa_delete_ptr DELETEs the PTR record', async () => {
    const client = new FakeOtwaClient().on('DELETE /v1/servers/s1/ips/1.2.3.4/ptr', { ok: true });
    const { server, handlers } = captureHandlers();
    registerNetworkingTools(server, asOtwaClient(client));

    await handlers['otwa_delete_ptr']!({ id: 's1', ip: '1.2.3.4' });
    expect(client.calls[0]).toMatchObject({
      method: 'DELETE',
      path: '/v1/servers/s1/ips/1.2.3.4/ptr',
    });
  });

  it('URL-encodes id + ip in the path', async () => {
    const client = new FakeOtwaClient().on('PUT /v1/servers/s%20one/ips/2001%3Adb8%3A%3A1/ptr', { ok: true });
    const { server, handlers } = captureHandlers();
    registerNetworkingTools(server, asOtwaClient(client));

    await handlers['otwa_set_ptr']!({ id: 's one', ip: '2001:db8::1', hostname: 'v6.example.com' });
    expect(client.calls[0]?.path).toBe('/v1/servers/s%20one/ips/2001%3Adb8%3A%3A1/ptr');
  });
});
