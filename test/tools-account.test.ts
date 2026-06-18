import { describe, it, expect } from 'vitest';
import { registerAccountTools } from '../src/tools/account';
import { FakeOtwaClient, asOtwaClient, captureHandlers, resultText, isError } from './_harness';

describe('otwa_account', () => {
  it('GETs /v1/account and returns the body as JSON', async () => {
    const client = new FakeOtwaClient().on('GET /v1/account', {
      id: 'u-1', email: 'a@b.c', balance: '12.34', tier: 'pro',
    });
    const { server, handlers } = captureHandlers();
    registerAccountTools(server, asOtwaClient(client));

    const result = await handlers['otwa_account']!({});

    expect(isError(result)).toBe(false);
    const parsed = JSON.parse(resultText(result));
    expect(parsed).toMatchObject({ id: 'u-1', email: 'a@b.c' });
    expect(client.calls).toEqual([
      { method: 'GET', path: '/v1/account', body: undefined, query: undefined, idempotent: undefined },
    ]);
  });

  it('maps API errors via safeHandler into isError results', async () => {
    const client = new FakeOtwaClient();
    // No canned response → FakeOtwaClient throws a plain Error
    const { server, handlers } = captureHandlers();
    registerAccountTools(server, asOtwaClient(client));

    const result = await handlers['otwa_account']!({});
    expect(isError(result)).toBe(true);
    expect(resultText(result)).toContain('no canned response');
  });
});
