import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OtwaClient } from '../client/http';
import type { IsoLibraryResponse, OsTemplateResponse, ProductResponse, RegionResponse } from '../client/types';
import { jsonResult, safeHandler } from './_helpers';

export function registerCatalogTools(server: McpServer, client: OtwaClient): void {
  server.registerTool(
    'otwa_list_products',
    {
      title: 'List server products (plans / sizes)',
      description:
        'Returns every server plan available to the current account, including CPU, RAM, disk, bandwidth, ' +
        'monthly price, and the productId UUID required to call otwa_create_server. Resellers see wholesale prices.',
      inputSchema: {},
    },
    safeHandler(async () => {
      const products = await client.request<ProductResponse[]>('/v1/products');
      return jsonResult(products);
    }),
  );

  server.registerTool(
    'otwa_list_regions',
    {
      title: 'List available regions',
      description:
        'Returns the list of regions where new servers can be deployed. Use the `slug` value as the ' +
        '`region` argument to otwa_create_server. Most accounts can omit region — the platform picks one ' +
        "based on product availability — but specifying a region pins the deploy location.",
      inputSchema: {},
    },
    safeHandler(async () => {
      const regions = await client.request<RegionResponse[]>('/v1/regions');
      return jsonResult(regions);
    }),
  );

  server.registerTool(
    'otwa_list_os_templates',
    {
      title: 'List operating-system templates',
      description:
        'Returns the catalogue of OS images available for new servers and reinstalls. Each entry has ' +
        '`id` (use as `osTemplate`), `family` (use as `os` — Ubuntu, Debian, Rocky, etc.) and `label`. ' +
        'Always call this before otwa_create_server so you pick a real template id, never a guessed string.',
      inputSchema: {},
    },
    safeHandler(async () => {
      const templates = await client.request<OsTemplateResponse[]>('/v1/os-templates');
      return jsonResult(templates);
    }),
  );

  server.registerTool(
    'otwa_list_iso_library',
    {
      title: 'List bootable custom ISOs',
      description:
        'Returns the catalogue of ready-to-boot custom ISO images (e.g. MikroTik RouterOS, VyOS, FreeBSD). ' +
        'To deploy one, call otwa_create_server with `os: "custom-iso"` and `osTemplate` set to the ISO `id` ' +
        'returned here. Only fully-uploaded images are listed.',
      inputSchema: {},
    },
    safeHandler(async () => {
      const isos = await client.request<IsoLibraryResponse[]>('/v1/iso-library');
      return jsonResult(isos);
    }),
  );
}
