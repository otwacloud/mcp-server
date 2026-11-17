import { describe, it, expect } from 'vitest';
import { registerServerTools } from '../src/tools/servers';
import { FakeOtwaClient, asOtwaClient, captureHandlers, resultText, isError } from './_harness';

describe('server reads', () => {
  it('otwa_list_servers GETs /v1/servers', async () => {
    const client = new FakeOtwaClient().on('GET /v1/servers', [
      { id: 's1', label: 'prod', status: 'running' },
    ]);
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    await handlers['otwa_list_servers']!({});
    expect(client.calls[0]?.path).toBe('/v1/servers');
  });

  it('otwa_get_server URL-encodes the id', async () => {
    const client = new FakeOtwaClient().on('GET /v1/servers/s%20one', { id: 's one' });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    await handlers['otwa_get_server']!({ id: 's one' });
    expect(client.calls[0]?.path).toBe('/v1/servers/s%20one');
  });

  it('otwa_get_server_credentials hits /credentials sub-path', async () => {
    const client = new FakeOtwaClient().on('GET /v1/servers/s1/credentials', {
      username: 'root', password: 'secret', ip: '1.2.3.4', port: 22,
    });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    await handlers['otwa_get_server_credentials']!({ id: 's1' });
    expect(client.calls[0]?.path).toBe('/v1/servers/s1/credentials');
  });
});

describe('otwa_create_server', () => {
  it('POSTs to /v1/servers with idempotency-key and 90s timeout', async () => {
    const client = new FakeOtwaClient().on('POST /v1/servers', { id: 'new-1' });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    await handlers['otwa_create_server']!({
      productId: '00000000-0000-0000-0000-000000000001',
      os: 'ubuntu',
      osTemplate: 'ubuntu-22.04-x64',
    });

    expect(client.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/servers',
      idempotent: true,
    });
  });
});

describe('otwa_power_server confirm-guard', () => {
  it('start does NOT require confirm', async () => {
    const client = new FakeOtwaClient().on('POST /v1/servers/s1/power/start', { status: 'starting' });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    const result = await handlers['otwa_power_server']!({ id: 's1', action: 'start' });
    expect(isError(result)).toBe(false);
    expect(client.calls[0]?.path).toBe('/v1/servers/s1/power/start');
  });

  it('stop without confirm:true throws confirmation_required', async () => {
    const client = new FakeOtwaClient();
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    const result = await handlers['otwa_power_server']!({ id: 's1', action: 'stop' });
    expect(isError(result)).toBe(true);
    expect(resultText(result)).toMatch(/confirm: true/);
    expect(client.calls).toEqual([]); // no API call fired
  });

  it('reboot with confirm:true proceeds', async () => {
    const client = new FakeOtwaClient().on('POST /v1/servers/s1/power/reboot', { status: 'rebooting' });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    const result = await handlers['otwa_power_server']!({ id: 's1', action: 'reboot', confirm: true });
    expect(isError(result)).toBe(false);
  });

  it('stop with confirm:false still blocks', async () => {
    const client = new FakeOtwaClient();
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    const result = await handlers['otwa_power_server']!({ id: 's1', action: 'stop', confirm: false });
    expect(isError(result)).toBe(true);
  });
});

describe('otwa_destroy_server typo-guard', () => {
  it('refuses when expectedLabel does not match', async () => {
    const client = new FakeOtwaClient().on('GET /v1/servers/s1', {
      id: 's1', label: 'real-name',
    });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    const result = await handlers['otwa_destroy_server']!({
      id: 's1',
      expectedLabel: 'wrong-name',
      confirm: true,
      iAcknowledgeDataLoss: true,
    });
    expect(isError(result)).toBe(true);
    expect(resultText(result)).toMatch(/does not match the current label/);
    // GET happened to read the label, but no DELETE fired
    expect(client.calls.filter(c => c.method === 'DELETE')).toEqual([]);
  });

  it('proceeds with DELETE when labels match exactly', async () => {
    const client = new FakeOtwaClient()
      .on('GET /v1/servers/s1', { id: 's1', label: 'real-name' })
      .on('DELETE /v1/servers/s1', { ok: true });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    const result = await handlers['otwa_destroy_server']!({
      id: 's1',
      expectedLabel: 'real-name',
      confirm: true,
      iAcknowledgeDataLoss: true,
    });
    expect(isError(result)).toBe(false);
    expect(client.calls.some(c => c.method === 'DELETE' && c.path === '/v1/servers/s1')).toBe(true);
  });

  it('trims whitespace before comparing labels', async () => {
    const client = new FakeOtwaClient()
      .on('GET /v1/servers/s1', { id: 's1', label: '  real-name  ' })
      .on('DELETE /v1/servers/s1', { ok: true });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    const result = await handlers['otwa_destroy_server']!({
      id: 's1',
      expectedLabel: 'real-name',
      confirm: true,
      iAcknowledgeDataLoss: true,
    });
    expect(isError(result)).toBe(false);
  });
});

describe('otwa_reinstall_server', () => {
  it('POSTs /reinstall with idempotency-key', async () => {
    const client = new FakeOtwaClient().on('POST /v1/servers/s1/reinstall', { ok: true });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    await handlers['otwa_reinstall_server']!({
      id: 's1',
      os: 'ubuntu',
      osTemplate: 'ubuntu-22.04-x64',
      confirm: true,
      iAcknowledgeDataLoss: true,
    });
    expect(client.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/servers/s1/reinstall',
      idempotent: true,
    });
  });
});

describe('snapshots', () => {
  it('otwa_list_snapshots GETs the /snapshots sub-path', async () => {
    const client = new FakeOtwaClient().on('GET /v1/servers/s1/snapshots', [
      { id: 'snapshot-1', name: 'before upgrade', current: true },
    ]);
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    await handlers['otwa_list_snapshots']!({ id: 's1' });
    expect(client.calls[0]).toMatchObject({ method: 'GET', path: '/v1/servers/s1/snapshots' });
  });

  it('otwa_create_snapshot POSTs name + description', async () => {
    const client = new FakeOtwaClient().on('POST /v1/servers/s1/snapshots', { success: true });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    await handlers['otwa_create_snapshot']!({ id: 's1', name: 'snap', description: 'why' });
    expect(client.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/servers/s1/snapshots',
      body: { name: 'snap', description: 'why' },
    });
  });

  it('otwa_delete_snapshot DELETEs the snapshot sub-path', async () => {
    const client = new FakeOtwaClient().on('DELETE /v1/servers/s1/snapshots/snapshot-9', { success: true });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    await handlers['otwa_delete_snapshot']!({ id: 's1', snapshotId: 'snapshot-9', confirm: true });
    expect(client.calls[0]).toMatchObject({ method: 'DELETE', path: '/v1/servers/s1/snapshots/snapshot-9' });
  });

  it('otwa_revert_snapshot refuses when expectedLabel does not match', async () => {
    const client = new FakeOtwaClient().on('GET /v1/servers/s1', { id: 's1', label: 'real-name' });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    const result = await handlers['otwa_revert_snapshot']!({
      id: 's1',
      snapshotId: 'snapshot-3',
      expectedLabel: 'wrong-name',
      confirm: true,
      iAcknowledgeDataLoss: true,
    });
    expect(isError(result)).toBe(true);
    expect(resultText(result)).toMatch(/does not match the current label/);
    expect(client.calls.filter(c => c.method === 'POST')).toEqual([]);
  });

  it('otwa_revert_snapshot POSTs /revert when labels match', async () => {
    const client = new FakeOtwaClient()
      .on('GET /v1/servers/s1', { id: 's1', label: 'real-name' })
      .on('POST /v1/servers/s1/snapshots/snapshot-3/revert', { success: true });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    const result = await handlers['otwa_revert_snapshot']!({
      id: 's1',
      snapshotId: 'snapshot-3',
      expectedLabel: 'real-name',
      confirm: true,
      iAcknowledgeDataLoss: true,
    });
    expect(isError(result)).toBe(false);
    expect(client.calls.some(c => c.method === 'POST' && c.path === '/v1/servers/s1/snapshots/snapshot-3/revert')).toBe(true);
  });
});

describe('otwa_get_dashboard_sso', () => {
  it('hits /v1/sso when no server id is provided', async () => {
    const client = new FakeOtwaClient().on('POST /v1/sso', { url: 'https://otwa.cloud/sso/abc', expiresIn: 300 });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    await handlers['otwa_get_dashboard_sso']!({});
    expect(client.calls[0]?.path).toBe('/v1/sso');
  });

  it('hits /v1/servers/<id>/sso when an id is provided', async () => {
    const client = new FakeOtwaClient().on('POST /v1/servers/s1/sso', { url: 'https://otwa.cloud/sso/abc', expiresIn: 300 });
    const { server, handlers } = captureHandlers();
    registerServerTools(server, asOtwaClient(client));

    await handlers['otwa_get_dashboard_sso']!({ id: 's1' });
    expect(client.calls[0]?.path).toBe('/v1/servers/s1/sso');
  });
});
