#!/usr/bin/env node
import express from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from '../server';
import { packageInfo } from '../util/version';

const PORT = parseInt(process.env.PORT || '3210', 10);
const HOST = process.env.HOST || '127.0.0.1';
// See note in src/util/env.ts — default MUST include the /api globalPrefix.
const API_BASE = (process.env.OTWA_API_BASE?.trim() || 'https://api.otwa.cloud/api').replace(/\/+$/, '');

// Public hostname this server is exposed under. Used to build absolute URLs in
// the RFC 9728 protected-resource metadata and the WWW-Authenticate challenge.
// Override for staging.
const PUBLIC_BASE = (process.env.MCP_PUBLIC_BASE?.trim() || 'https://mcp.otwa.cloud').replace(/\/+$/, '');

// The OAuth 2.0 Authorization Server clients should talk to. This is currently
// the same otwa-cloud-api host that issues API keys; once the AS endpoints
// (RFC 8628 device-code + RFC 7591 DCR + RFC 8414 metadata) ship, clients that
// support OAuth will discover them automatically via the metadata below.
const OAUTH_AS = (process.env.OTWA_OAUTH_AS?.trim() || 'https://api.otwa.cloud').replace(/\/+$/, '');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '1mb' }));

const pkg = packageInfo();

app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true, service: pkg.name, version: pkg.version, apiBase: API_BASE });
});

// RFC 9728 OAuth 2.0 Protected Resource Metadata.
// Announces that this MCP server is an OAuth-protected resource served by the
// otwa.cloud authorization server. Clients that support OAuth discover the AS
// here, then fetch its metadata from `${OAUTH_AS}/.well-known/oauth-authorization-server`
// to learn the device-code + token endpoints.
//
// Until the AS endpoints ship, callers using Bearer API keys continue to work
// unchanged — this metadata document is purely additive.
const protectedResourceMetadata = () => ({
  resource: `${PUBLIC_BASE}/mcp`,
  authorization_servers: [OAUTH_AS],
  bearer_methods_supported: ['header'],
  scopes_supported: [
    'account:read',
    'servers:read', 'servers:write', 'servers:destroy',
    'billing:read',
    'webhooks:read', 'webhooks:write',
  ],
  resource_name: '@otwa/mcp-server',
  resource_documentation: 'https://otwa.cloud/docs/integrations/mcp',
});
app.get('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'public, max-age=3600').json(protectedResourceMetadata());
});
// Also serve the path-suffixed form some clients try first.
app.get('/.well-known/oauth-protected-resource/mcp', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'public, max-age=3600').json(protectedResourceMetadata());
});

const WWW_AUTH_HEADER =
  `Bearer realm="otwa-mcp", resource_metadata="${PUBLIC_BASE}/.well-known/oauth-protected-resource"`;

app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: pkg.name,
    version: pkg.version,
    transport: 'streamable-http',
    docs: 'https://otwa.cloud/docs/mcp',
    endpoints: {
      mcp: 'POST /mcp',
      health: 'GET /healthz',
    },
    auth: 'Bearer otwa_… (from https://otwa.cloud/dashboard/settings/api-keys)',
  });
});

function extractBearer(req: Request): string | null {
  const raw = req.header('authorization') || req.header('Authorization');
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/.exec(raw.trim());
  return m && m[1] ? m[1].trim() : null;
}

/** Stateless Streamable HTTP — every request gets a fresh McpServer + transport,
 *  scoped to the caller's API key. No session state lives on the server, so we
 *  scale horizontally without sticky sessions and a leaked session id is useless. */
app.post('/mcp', async (req: Request, res: Response) => {
  const apiKey = extractBearer(req);
  if (!apiKey) {
    res.set('WWW-Authenticate', WWW_AUTH_HEADER).status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message:
          'Missing Authorization header. Set "Authorization: Bearer otwa_…" with an API key from ' +
          'https://otwa.cloud/dashboard/settings/api-keys',
      },
      id: null,
    });
    return;
  }
  if (!apiKey.startsWith('otwa_')) {
    res.set('WWW-Authenticate', WWW_AUTH_HEADER).status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Bearer token does not look like an otwa.cloud API key (expected prefix "otwa_").',
      },
      id: null,
    });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  // Capture User-Agent (truncated) as the telemetry client label so the SA
  // dashboard can show "X% Claude Code, Y% Cursor, …" without a separate
  // header. Header is optional + untrusted — only kept as a labelling hint.
  const clientLabel = (req.header('user-agent') || '').slice(0, 200) || null;
  const server = createServer(
    { apiKey, apiBase: API_BASE, telemetry: true },
    { transport: 'http', clientLabel },
  );

  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[otwa-mcp-http] handler error: ${msg}\n`);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: `Internal error: ${msg}` },
        id: null,
      });
    }
  }
});

// GET /mcp and DELETE /mcp are part of the Streamable HTTP spec for stateful
// servers (session resumption + termination). We're stateless — refuse them
// with the spec-compliant error so clients know not to bother.
app.get('/mcp', (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method Not Allowed. This server is stateless — use POST /mcp.' },
    id: null,
  });
});
app.delete('/mcp', (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method Not Allowed. This server is stateless.' },
    id: null,
  });
});

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

const reqId = (): string => randomUUID();
app.use((err: Error, req: Request, res: Response, _next: express.NextFunction) => {
  const id = reqId();
  process.stderr.write(`[otwa-mcp-http] ${id} ${req.method} ${req.path}: ${err.stack || err.message}\n`);
  if (!res.headersSent) {
    res.status(500).json({ error: 'internal_error', requestId: id });
  }
});

const httpServer = app.listen(PORT, HOST, () => {
  process.stdout.write(
    `[otwa-mcp-http] ${pkg.name} ${pkg.version} listening on ${HOST}:${PORT} (API base: ${API_BASE})\n`,
  );
});

const shutdown = (signal: string): void => {
  process.stderr.write(`[otwa-mcp-http] shutdown on ${signal}\n`);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
