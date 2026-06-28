import { describe, it, expect } from 'vitest';
import { createServer } from '../src/server';

describe('createServer', () => {
  it('builds an MCP server with all tools registered without throwing', () => {
    const server = createServer({
      apiKey: 'otwa_test_key',
      apiBase: 'https://api.otwa.cloud',
      telemetry: false,
    });
    expect(server).toBeDefined();
  });

  it('registers tools across every scope surface (smoke check via internal list)', () => {
    // The SDK does not expose a public list-tools method, but the underlying
    // server exposes `_registeredTools` (an object keyed by name). This is a
    // smoke check: if anyone removes a tool category, the count regresses.
    const server = createServer({
      apiKey: 'otwa_test_key',
      apiBase: 'https://api.otwa.cloud',
      telemetry: false,
    });
    const internal = (server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools;
    expect(internal, 'McpServer should expose _registeredTools on this SDK version').toBeDefined();
    const names = Object.keys(internal!);

    const required = [
      // account / catalogue
      'otwa_account',
      'otwa_list_products',
      'otwa_list_regions',
      'otwa_list_os_templates',
      'otwa_list_iso_library',
      // servers
      'otwa_list_servers',
      'otwa_get_server',
      'otwa_create_server',
      'otwa_power_server',
      'otwa_destroy_server',
      // networking
      'otwa_list_server_ips',
      'otwa_set_ptr',
      // billing
      'otwa_list_invoices',
      'otwa_get_wallet_balance',
      // webhooks
      'otwa_list_webhooks',
      'otwa_create_webhook',
      // reseller (added in v0.2.0)
      'otwa_get_reseller_state',
    ];

    for (const name of required) {
      expect(names, `missing tool ${name}`).toContain(name);
    }
  });
});
