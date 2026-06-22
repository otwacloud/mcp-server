import { describe, it, expect } from 'vitest';
import { registerCatalogTools } from '../src/tools/catalog';
import { FakeOtwaClient, asOtwaClient, captureHandlers, resultText } from './_harness';

describe('catalog tools', () => {
  it('otwa_list_products GETs /v1/products and returns the array', async () => {
    const client = new FakeOtwaClient().on('GET /v1/products', [
      { id: 'p1', name: 'Starter', vcpu: 2, ramGb: 4, pricePerMonth: '5.00' },
      { id: 'p2', name: 'Pro', vcpu: 4, ramGb: 8, pricePerMonth: '15.00' },
    ]);
    const { server, handlers } = captureHandlers();
    registerCatalogTools(server, asOtwaClient(client));

    const result = await handlers['otwa_list_products']!({});
    const parsed = JSON.parse(resultText(result));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe('p1');
  });

  it('otwa_list_regions GETs /v1/regions', async () => {
    const client = new FakeOtwaClient().on('GET /v1/regions', [{ slug: 'fra1', name: 'Frankfurt' }]);
    const { server, handlers } = captureHandlers();
    registerCatalogTools(server, asOtwaClient(client));

    await handlers['otwa_list_regions']!({});
    expect(client.calls[0]).toMatchObject({ method: 'GET', path: '/v1/regions' });
  });

  it('otwa_list_os_templates GETs /v1/os-templates', async () => {
    const client = new FakeOtwaClient().on('GET /v1/os-templates', [
      { id: 'ubuntu-22.04-x64', family: 'ubuntu', label: 'Ubuntu 22.04' },
    ]);
    const { server, handlers } = captureHandlers();
    registerCatalogTools(server, asOtwaClient(client));

    await handlers['otwa_list_os_templates']!({});
    expect(client.calls[0]?.path).toBe('/v1/os-templates');
  });
});
