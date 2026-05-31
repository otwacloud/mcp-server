import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OtwaClient } from './client/http';
import { registerAllTools } from './tools/_register';
import { packageInfo } from './util/version';
import type { OtwaEnv } from './util/env';
import { createTelemetry } from './util/telemetry';

export interface CreateServerOptions {
  /** Which transport hosts this server. Threaded into every telemetry event
   *  so the dashboard can split stdio vs hosted call volume. */
  transport?: 'stdio' | 'http';
  /** Optional User-Agent-like label written alongside each telemetry row.
   *  HTTP transport sets this to the incoming User-Agent (capped). */
  clientLabel?: string | null;
}

export function createServer(env: OtwaEnv, opts: CreateServerOptions = {}): McpServer {
  const pkg = packageInfo();
  const server = new McpServer({
    name: pkg.name,
    version: pkg.version,
  });

  const client = new OtwaClient({
    apiKey: env.apiKey,
    apiBase: env.apiBase,
  });

  const transport = opts.transport ?? 'stdio';
  const telemetry = createTelemetry({
    apiKey: env.apiKey,
    apiBase: env.apiBase,
    transport,
    // Hosted transport always records; stdio respects OTWA_TELEMETRY env opt-in.
    enabled: transport === 'http' ? true : env.telemetry,
    clientLabel: opts.clientLabel ?? null,
  });

  registerAllTools(server, client, telemetry);
  return server;
}
