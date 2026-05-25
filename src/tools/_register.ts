import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OtwaClient } from '../client/http';
import { registerAccountTools } from './account';
import { registerBillingTools } from './billing';
import { registerCatalogTools } from './catalog';
import { registerNetworkingTools } from './networking';
import { registerServerTools } from './servers';
import { registerWebhookTools } from './webhooks';

export function registerAllTools(server: McpServer, client: OtwaClient): void {
  registerAccountTools(server, client);
  registerCatalogTools(server, client);
  registerServerTools(server, client);
  registerNetworkingTools(server, client);
  registerBillingTools(server, client);
  registerWebhookTools(server, client);
}
