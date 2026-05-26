export interface OtwaEnv {
  apiKey: string;
  apiBase: string;
  telemetry: boolean;
}

export function readEnv(): OtwaEnv {
  const apiKey = process.env.OTWA_API_KEY?.trim() || '';
  if (!apiKey) {
    throw new Error(
      'OTWA_API_KEY is not set. Create one at https://otwa.cloud/dashboard/settings/api-keys ' +
        'and set the OTWA_API_KEY environment variable, then restart this MCP server.',
    );
  }
  if (!apiKey.startsWith('otwa_')) {
    throw new Error(
      'OTWA_API_KEY does not look like an otwa.cloud API key (expected prefix "otwa_"). ' +
        'Generate a new key at https://otwa.cloud/dashboard/settings/api-keys.',
    );
  }
  const apiBase = (process.env.OTWA_API_BASE?.trim() || 'https://api.otwa.cloud').replace(/\/+$/, '');
  const telemetry = /^(1|true|yes)$/i.test(process.env.OTWA_TELEMETRY?.trim() || '');
  return { apiKey, apiBase, telemetry };
}
