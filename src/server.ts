import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OtwaClient } from './client/http';
import { registerAllTools } from './tools/_register';
import { packageInfo } from './util/version';
import type { OtwaEnv } from './util/env';

export function createServer(env: OtwaEnv): McpServer {
  const pkg = packageInfo();
  const server = new McpServer({
    name: pkg.name,
    version: pkg.version,
  });

  const client = new OtwaClient({
    apiKey: env.apiKey,
    apiBase: env.apiBase,
  });

  registerAllTools(server, client);
  return server;
}
