import { randomUUID } from 'crypto';
import { mapHttpError, OtwaApiError } from './errors';
import { packageInfo } from '../util/version';

export interface OtwaClientOptions {
  apiKey: string;
  apiBase: string;
  /** Request timeout in milliseconds. Default 30s — provisioning isn't fast. */
  timeoutMs?: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** When true, attaches an auto-generated Idempotency-Key so transient
   *  retries by the LLM don't produce duplicate side effects. */
  idempotent?: boolean;
  /** Override default timeout for slow endpoints (provisioning, invoice PDF). */
  timeoutMs?: number;
  /** When true, returns the raw Response so callers can stream / read binary. */
  raw?: boolean;
}

export class OtwaClient {
  private readonly userAgent: string;

  constructor(private readonly opts: OtwaClientOptions) {
    const pkg = packageInfo();
    this.userAgent = `${pkg.name}/${pkg.version} (+https://otwa.cloud/docs/mcp)`;
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.opts.apiKey}`,
      'Accept': 'application/json',
      'User-Agent': this.userAgent,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.idempotent) {
      headers['Idempotency-Key'] = `mcp-${randomUUID()}`;
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.opts.timeoutMs ?? 30_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('aborted')) {
        throw new OtwaApiError(
          `Request to ${path} timed out after ${timeoutMs}ms. Retry, or check otwa.cloud status at https://status.otwa.cloud`,
          0,
          'timeout',
        );
      }
      throw new OtwaApiError(
        `Network error contacting otwa-cloud-api at ${this.opts.apiBase}: ${msg}`,
        0,
        'network_error',
      );
    }
    clearTimeout(timer);

    if (options.raw) {
      if (!res.ok) {
        const body = await safeReadJson(res);
        throw mapHttpError(res.status, body, res.headers.get('x-request-id') || undefined);
      }
      return res as unknown as T;
    }

    // 204 No Content: many DELETE endpoints return empty
    if (res.status === 204) {
      return { ok: true } as T;
    }

    const body = await safeReadJson(res);
    if (!res.ok) {
      throw mapHttpError(res.status, body, res.headers.get('x-request-id') || undefined);
    }
    return body as T;
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const base = this.opts.apiBase;
    const normalised = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${base}${normalised}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }
}

async function safeReadJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
