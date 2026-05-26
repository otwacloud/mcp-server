import { describe, it, expect } from 'vitest';
import { jsonResult, textResult, safeHandler } from '../src/tools/_helpers';
import { OtwaApiError } from '../src/client/errors';

describe('jsonResult', () => {
  it('serialises a value as a single text content block', () => {
    const r = jsonResult({ hello: 'world', n: 42 });
    expect(r.content).toHaveLength(1);
    expect(r.content[0]).toEqual({
      type: 'text',
      text: '{\n  "hello": "world",\n  "n": 42\n}',
    });
  });

  it('handles arrays', () => {
    const r = jsonResult([1, 2, 3]);
    expect(r.content[0]).toMatchObject({ type: 'text' });
    expect((r.content[0] as { text: string }).text).toBe('[\n  1,\n  2,\n  3\n]');
  });
});

describe('textResult', () => {
  it('wraps a plain string as a single text content block', () => {
    const r = textResult('hi there');
    expect(r.content).toEqual([{ type: 'text', text: 'hi there' }]);
  });
});

describe('safeHandler', () => {
  it('returns the handler result on success', async () => {
    const handler = safeHandler(async () => jsonResult({ ok: true }));
    const r = await handler({});
    expect(r.isError).toBeUndefined();
    expect(r.content[0]).toMatchObject({ type: 'text' });
  });

  it('catches OtwaApiError and returns isError with the message', async () => {
    const handler = safeHandler(async () => {
      throw new OtwaApiError('boom', 500, 'upstream_error');
    });
    const r = await handler({});
    expect(r.isError).toBe(true);
    expect(r.content[0]).toMatchObject({ type: 'text', text: 'boom' });
  });

  it('catches generic Error and returns isError with the message', async () => {
    const handler = safeHandler(async () => {
      throw new Error('generic boom');
    });
    const r = await handler({});
    expect(r.isError).toBe(true);
    expect(r.content[0]).toMatchObject({ type: 'text', text: 'generic boom' });
  });

  it('coerces non-Error throws to string', async () => {
    const handler = safeHandler(async () => {
      throw 'string-thrown'; // eslint-disable-line no-throw-literal
    });
    const r = await handler({});
    expect(r.isError).toBe(true);
    expect(r.content[0]).toMatchObject({ type: 'text', text: 'string-thrown' });
  });
});
