import { describe, it, expect } from 'vitest';
import { mapHttpError, OtwaApiError } from '../src/client/errors';

describe('mapHttpError', () => {
  it('maps 401 to a remediation-style message that mentions the dashboard', () => {
    const err = mapHttpError(401, { message: 'unauth' });
    expect(err).toBeInstanceOf(OtwaApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe('unauthorized');
    expect(err.message).toMatch(/OTWA_API_KEY/);
    expect(err.message).toMatch(/api-keys/);
  });

  it('maps 403 to "forbidden" and prefers body message', () => {
    const err = mapHttpError(403, { message: 'missing scope foo' });
    expect(err.code).toBe('forbidden');
    expect(err.message).toBe('missing scope foo');
  });

  it('maps 402 to a top-up prompt naming the billing surface', () => {
    const err = mapHttpError(402, null);
    expect(err.code).toBe('payment_required');
    expect(err.message).toMatch(/balance/i);
    expect(err.message).toMatch(/dashboard\/billing/);
  });

  it('maps 404 to a hint about listing servers', () => {
    const err = mapHttpError(404, null);
    expect(err.code).toBe('not_found');
    expect(err.message).toMatch(/otwa_list_servers/);
  });

  it('maps 422 to validation_failed using body message', () => {
    const err = mapHttpError(422, { message: ['label too short', 'region invalid'] });
    expect(err.code).toBe('validation_failed');
    expect(err.message).toBe('label too short; region invalid');
  });

  it('maps 5xx to upstream_error and includes the request id when provided', () => {
    const err = mapHttpError(503, null, 'req-abc-123');
    expect(err.code).toBe('upstream_error');
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/Request id: req-abc-123/);
  });

  it('maps 429 to rate_limited', () => {
    const err = mapHttpError(429, null);
    expect(err.code).toBe('rate_limited');
  });
});
