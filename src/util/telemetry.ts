/** Optional fire-and-forget telemetry for MCP tool calls.
 *
 *  Hosted transport (mcp.otwa.cloud) always records — we already see every
 *  request server-side, logging metadata to our own DB has no privacy delta.
 *
 *  Stdio transport is OFF by default and only records when the user sets
 *  OTWA_TELEMETRY=1. Stdio runs on the user's machine and we want to be a
 *  good neighbour — no surprise network calls per tool invocation. */

import { OtwaApiError } from '../client/errors';

export interface TelemetryEvent {
  toolName: string;
  success: boolean;
  errorCode?: string | null;
  durationMs: number;
}

export interface Telemetry {
  enabled: boolean;
  transport: 'stdio' | 'http';
  record: (event: TelemetryEvent) => void;
}

interface CreateTelemetryOptions {
  apiKey: string;
  apiBase: string;
  enabled: boolean;
  transport: 'stdio' | 'http';
  clientLabel?: string | null;
}

export function createTelemetry(opts: CreateTelemetryOptions): Telemetry {
  if (!opts.enabled) {
    return {
      enabled: false,
      transport: opts.transport,
      record: () => undefined,
    };
  }

  const url = `${opts.apiBase.replace(/\/+$/, '')}/v1/integrations/mcp/usage`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${opts.apiKey}`,
  };

  return {
    enabled: true,
    transport: opts.transport,
    record: (event) => {
      const body = JSON.stringify({
        toolName: event.toolName,
        transport: opts.transport,
        success: event.success,
        errorCode: event.errorCode ?? undefined,
        durationMs: event.durationMs,
        clientLabel: opts.clientLabel ?? undefined,
      });
      // Fire-and-forget. We never await this — the tool result must never be
      // delayed by telemetry. We swallow errors entirely; one missed log row
      // is cheaper than surfacing infrastructure noise to the LLM.
      void fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(2_000) })
        .catch(() => undefined);
    },
  };
}

/** Read the error_code from an `isError: true` CallToolResult so we can bucket
 *  failures meaningfully in the dashboard (forbidden / not_found / rate_limited
 *  / etc) rather than just counting "failed".
 *  Returns null if the failure didn't come from OtwaApiError (e.g. a generic
 *  JS throw inside the handler). */
export function classifyErrorFromResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  if (!r.isError) return null;
  // We re-classify by message string because OtwaApiError instances are lost
  // by the time safeHandler has stringified them into the content array. The
  // strings are fixed in errors.ts so this stays accurate.
  const text = r.content?.[0]?.text || '';
  if (text.includes('OTWA_API_KEY is invalid')) return 'unauthorized';
  if (text.includes('missing a required scope') || text.includes('missing required scope')) return 'forbidden';
  if (text.includes('Account balance is too low')) return 'payment_required';
  if (text.includes('Resource not found') || text.startsWith('Not found')) return 'not_found';
  if (text.startsWith('Conflict')) return 'conflict';
  if (text.startsWith('Validation failed')) return 'validation_failed';
  if (text.includes('Rate-limited')) return 'rate_limited';
  if (text.includes('otwa-cloud-api returned 5')) return 'upstream_error';
  return 'error';
}

/** Stamp a tool name onto an OtwaApiError-derived classification, only used
 *  when an exception leaks past safeHandler. */
export function classifyErrorFromException(err: unknown): string {
  if (err instanceof OtwaApiError) return err.code;
  return 'thrown';
}
