import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OtwaClient } from '../client/http';
import { Telemetry, classifyErrorFromResult } from '../util/telemetry';
import { registerAccountTools } from './account';
import { registerBillingTools } from './billing';
import { registerCatalogTools } from './catalog';
import { registerNetworkingTools } from './networking';
import { registerResellerTools } from './reseller';
import { registerServerTools } from './servers';
import { registerWebhookTools } from './webhooks';

/** Wrap `server.registerTool` so every tool handler is automatically
 *  instrumented with start/finish timing + fire-and-forget telemetry.
 *  Single integration point — none of the per-surface tool files need
 *  to know about telemetry at all. */
function instrumentRegisterTool(server: McpServer, telemetry: Telemetry): void {
  if (!telemetry.enabled) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = (server as any).registerTool.bind(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).registerTool = (name: string, config: any, handler: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = async (...args: any[]) => {
      const startMs = Date.now();
      try {
        const result = await handler(...args);
        const durationMs = Date.now() - startMs;
        const success = !result?.isError;
        const errorCode = success ? null : classifyErrorFromResult(result);
        telemetry.record({ toolName: name, success, errorCode, durationMs });
        return result;
      } catch (err: unknown) {
        const durationMs = Date.now() - startMs;
        telemetry.record({ toolName: name, success: false, errorCode: 'thrown', durationMs });
        throw err;
      }
    };
    return original(name, config, wrapped);
  };
}

export function registerAllTools(
  server: McpServer,
  client: OtwaClient,
  telemetry?: Telemetry,
): void {
  if (telemetry) instrumentRegisterTool(server, telemetry);
  registerAccountTools(server, client);
  registerCatalogTools(server, client);
  registerServerTools(server, client);
  registerNetworkingTools(server, client);
  registerBillingTools(server, client);
  registerWebhookTools(server, client);
  registerResellerTools(server, client);
}
