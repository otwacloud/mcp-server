#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server';
import { readEnv } from './util/env';
import { packageInfo } from './util/version';

async function main(): Promise<void> {
  // Surface CLI version/help without trying to read the API key — useful for
  // doctor-style checks before the customer has set OTWA_API_KEY.
  const argv = process.argv.slice(2);
  if (argv.includes('--version') || argv.includes('-v')) {
    const pkg = packageInfo();
    process.stdout.write(`${pkg.name} ${pkg.version}\n`);
    return;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  let env;
  try {
    env = readEnv();
  } catch (err: unknown) {
    // Write to stderr so it shows up in MCP-client logs; exit non-zero so
    // the client surfaces it as an install error.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[otwa-mcp] ${msg}\n`);
    process.exit(1);
  }

  const server = createServer(env);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown so the LLM client doesn't see a hang on Ctrl-C / SIGTERM.
  const shutdown = async (signal: string): Promise<void> => {
    try {
      await server.close();
    } catch {
      // best-effort
    }
    process.stderr.write(`[otwa-mcp] shutdown on ${signal}\n`);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

function printHelp(): void {
  const pkg = packageInfo();
  process.stdout.write(
    `${pkg.name} ${pkg.version}\n` +
      '\n' +
      'Official Model Context Protocol server for otwa.cloud.\n' +
      '\n' +
      'Usage:\n' +
      '  otwa-mcp            Start the stdio MCP server (the normal case — spawned\n' +
      '                      by Claude Code, Cursor, Windsurf, Zed, etc.)\n' +
      '  otwa-mcp --version  Print version and exit\n' +
      '  otwa-mcp --help     Show this help\n' +
      '\n' +
      'Environment:\n' +
      '  OTWA_API_KEY        Required. Generate at https://otwa.cloud/dashboard/settings/api-keys\n' +
      '  OTWA_API_BASE       Optional. Default https://api.otwa.cloud\n' +
      '  OTWA_TELEMETRY      Optional. Set to 1 to send anonymous usage pings.\n' +
      '\n' +
      'Docs: https://otwa.cloud/docs/mcp\n',
  );
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  process.stderr.write(`[otwa-mcp] fatal: ${msg}\n`);
  process.exit(1);
});
