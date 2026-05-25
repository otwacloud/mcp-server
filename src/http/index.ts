#!/usr/bin/env node
import express from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OtwaClient } from '../client/http';
import { registerAllTools } from '../tools/_register';
import { packageInfo } from '../util/version';

const PORT = parseInt(process.env.PORT || '3210', 10);
const HOST = process.env.HOST || '127.0.0.1';
const API_BASE = (process.env.OTWA_API_BASE?.trim() || 'https://api.otwa.cloud').replace(/\/+$/, '');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '1mb' }));

const pkg = packageInfo();

app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true, service: pkg.name, version: pkg.version, apiBase: API_BASE });
});

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
    res.status(401).json({
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
    res.status(401).json({
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

  const server = new McpServer({ name: pkg.name, version: pkg.version });
  const client = new OtwaClient({ apiKey, apiBase: API_BASE });
  registerAllTools(server, client);

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
