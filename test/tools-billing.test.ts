import { describe, it, expect } from 'vitest';
import { registerBillingTools } from '../src/tools/billing';
import { FakeOtwaClient, asOtwaClient, captureHandlers, resultText } from './_harness';

describe('billing tools', () => {
  it('otwa_list_invoices GETs /v1/billing/invoices with query', async () => {
    const client = new FakeOtwaClient().on('GET /v1/billing/invoices', [
      { id: 'inv-1', invoiceNumber: 'INV-0001', total: '10.00', status: 'paid' },
    ]);
    const { server, handlers } = captureHandlers();
    registerBillingTools(server, asOtwaClient(client));

    await handlers['otwa_list_invoices']!({ page: 2, limit: 25 });
    expect(client.calls[0]).toMatchObject({
      method: 'GET',
      path: '/v1/billing/invoices',
      query: { page: 2, limit: 25 },
    });
  });

  it('otwa_get_invoice URL-encodes the id', async () => {
    const client = new FakeOtwaClient().on('GET /v1/billing/invoices/inv-abc', {
      id: 'inv-abc', invoiceNumber: 'INV-9', total: '5', status: 'paid',
    });
    const { server, handlers } = captureHandlers();
    registerBillingTools(server, asOtwaClient(client));

    await handlers['otwa_get_invoice']!({ id: 'inv-abc' });
    expect(client.calls[0]?.path).toBe('/v1/billing/invoices/inv-abc');
  });

  it('otwa_list_transactions defaults paging when args missing', async () => {
    const client = new FakeOtwaClient().on('GET /v1/billing/transactions', []);
    const { server, handlers } = captureHandlers();
    registerBillingTools(server, asOtwaClient(client));

    await handlers['otwa_list_transactions']!({});
    expect(client.calls[0]).toMatchObject({
      method: 'GET',
      path: '/v1/billing/transactions',
    });
  });

  it('otwa_get_wallet_balance GETs /v1/wallet and returns array', async () => {
    const client = new FakeOtwaClient().on('GET /v1/wallet', [
      { chain: 'TRON', address: 'TRX-abc', balance: '12.34', isActive: true },
      { chain: 'ARBITRUM', address: 'ARB-abc', balance: '0', isActive: false },
    ]);
    const { server, handlers } = captureHandlers();
    registerBillingTools(server, asOtwaClient(client));

    const result = await handlers['otwa_get_wallet_balance']!({});
    const parsed = JSON.parse(resultText(result));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].chain).toBe('TRON');
  });
});
