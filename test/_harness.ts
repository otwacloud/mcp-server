/* Shared test harness: a fake OtwaClient that records calls + returns canned
 * responses, plus a helper that captures every registered tool's handler so a
 * test can invoke it directly with arbitrary args. */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OtwaClient } from '../src/client/http';

export interface RecordedCall {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  idempotent?: boolean;
}

export class FakeOtwaClient {
  public calls: RecordedCall[] = [];
  private responses = new Map<string, unknown>();
  private throwers = new Map<string, Error>();

  /** Canned response keyed by `<METHOD> <path>`. Use `* <path>` for any method. */
  on(key: string, response: unknown): this {
    this.responses.set(key, response);
    return this;
  }

  /** Throw a specific error on this path. Used to assert error mapping. */
  onThrow(key: string, err: Error): this {
    this.throwers.set(key, err);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async request<T = unknown>(path: string, options: any = {}): Promise<T> {
    const method = (options.method || 'GET').toUpperCase();
    this.calls.push({
      method,
      path,
      body: options.body,
      query: options.query,
      idempotent: options.idempotent,
    });

    const exact = `${method} ${path}`;
    const wildcardMethod = `* ${path}`;

    if (this.throwers.has(exact)) throw this.throwers.get(exact);
    if (this.throwers.has(wildcardMethod)) throw this.throwers.get(wildcardMethod);

    if (this.responses.has(exact)) return this.responses.get(exact) as T;
    if (this.responses.has(wildcardMethod)) return this.responses.get(wildcardMethod) as T;

    throw new Error(`FakeOtwaClient: no canned response for ${exact}. Configure via .on('${exact}', …)`);
  }
}

export interface CapturedHandlers {
  [name: string]: (args: unknown) => Promise<unknown>;
}

/** Build an McpServer whose `registerTool` records every (name → handler) into
 * the returned `handlers` map. Lets tests reach the actual handler logic without
 * spinning up a transport. */
export function captureHandlers(): { server: McpServer; handlers: CapturedHandlers } {
  const server = new McpServer({ name: 'otwa-mcp-test', version: '0.0.0-test' });
  const handlers: CapturedHandlers = {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = (server as any).registerTool.bind(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).registerTool = (name: string, config: any, handler: any) => {
    handlers[name] = handler;
    return original(name, config, handler);
  };

  return { server, handlers };
}

/** Pull the text content out of a tool result (success or error). Tools always
 * return CallToolResult, which has a content array of `{type:'text', text:…}`. */
export function resultText(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  return r.content?.[0]?.text ?? '';
}

export function isError(result: unknown): boolean {
  return Boolean((result as { isError?: boolean }).isError);
}

/** Convenience: cast FakeOtwaClient to the real OtwaClient type so it can be
 * passed into register* functions that expect OtwaClient. The shape is
 * structurally compatible (only `request()` is called). */
export function asOtwaClient(fake: FakeOtwaClient): OtwaClient {
  return fake as unknown as OtwaClient;
}
