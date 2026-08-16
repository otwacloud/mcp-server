import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createTelemetry,
  classifyErrorFromResult,
  classifyErrorFromException,
} from '../src/util/telemetry';
import { OtwaApiError, mapHttpError } from '../src/client/errors';

describe('createTelemetry', () => {
  it('returns a no-op record when disabled', () => {
    const t = createTelemetry({
      apiKey: 'otwa_x',
      apiBase: 'https://api.otwa.cloud',
      enabled: false,
      transport: 'stdio',
    });
    expect(t.enabled).toBe(false);
    expect(() => t.record({ toolName: 'foo', success: true, durationMs: 5 })).not.toThrow();
  });

  it('posts to /v1/integrations/mcp/usage when enabled', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const t = createTelemetry({
      apiKey: 'otwa_secret',
      apiBase: 'https://api.otwa.cloud/',
      enabled: true,
      transport: 'http',
      clientLabel: 'Claude Code/1.0',
    });
    t.record({ toolName: 'otwa_account', success: true, durationMs: 42 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.otwa.cloud/v1/integrations/mcp/usage');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer otwa_secret');
    expect(headers['content-type']).toBe('application/json');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toEqual({
      toolName: 'otwa_account',
      transport: 'http',
      success: true,
      durationMs: 42,
      clientLabel: 'Claude Code/1.0',
    });
    fetchSpy.mockRestore();
  });

  it('never throws when fetch rejects (fire-and-forget contract)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as 'fetch').mockRejectedValue(new Error('net'));
    const t = createTelemetry({
      apiKey: 'otwa_x',
      apiBase: 'https://api.otwa.cloud',
      enabled: true,
      transport: 'stdio',
    });
    expect(() => t.record({ toolName: 'f', success: false, errorCode: 'thrown', durationMs: 10 }))
      .not.toThrow();
    // give the microtask a moment to settle the rejected promise
    await new Promise(r => setImmediate(r));
    fetchSpy.mockRestore();
  });
});

describe('classifyErrorFromResult', () => {
  it('returns null on a non-error result', () => {
    expect(classifyErrorFromResult({ content: [{ type: 'text', text: 'fine' }] })).toBeNull();
  });
  it('maps the 401 message to unauthorized', () => {
    const err = mapHttpError(401, null);
    const r = { isError: true, content: [{ type: 'text', text: err.message }] };
    expect(classifyErrorFromResult(r)).toBe('unauthorized');
  });
  it('maps the 403 message to forbidden', () => {
    const err = mapHttpError(403, { message: 'API key is missing a required scope: x' });
    const r = { isError: true, content: [{ type: 'text', text: err.message }] };
    expect(classifyErrorFromResult(r)).toBe('forbidden');
  });
  it('maps the 402 message to payment_required', () => {
    const err = mapHttpError(402, null);
    const r = { isError: true, content: [{ type: 'text', text: err.message }] };
    expect(classifyErrorFromResult(r)).toBe('payment_required');
  });
  it('maps a 5xx message to upstream_error', () => {
    const err = mapHttpError(503, null, 'rid');
    const r = { isError: true, content: [{ type: 'text', text: err.message }] };
    expect(classifyErrorFromResult(r)).toBe('upstream_error');
  });
  it('falls through to a generic "error" classification', () => {
    const r = { isError: true, content: [{ type: 'text', text: 'something else' }] };
    expect(classifyErrorFromResult(r)).toBe('error');
  });
});

describe('classifyErrorFromException', () => {
  it('returns the code from OtwaApiError', () => {
    expect(classifyErrorFromException(new OtwaApiError('x', 500, 'upstream_error'))).toBe('upstream_error');
  });
  it('returns "thrown" for generic errors', () => {
    expect(classifyErrorFromException(new Error('boom'))).toBe('thrown');
  });
});
