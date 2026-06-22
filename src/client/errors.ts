export class OtwaApiError extends Error {
  override readonly name = 'OtwaApiError';
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

/** Translate a raw HTTP response from otwa-cloud-api into a message the LLM
 *  can act on. The goal is always: tell the model exactly what to do next,
 *  not just what went wrong. */
export function mapHttpError(status: number, body: unknown, requestId?: string): OtwaApiError {
  const bodyMessage = extractMessage(body);

  if (status === 401) {
    return new OtwaApiError(
      'OTWA_API_KEY is invalid, expired, or revoked. Ask the user to create a fresh key at ' +
        'https://otwa.cloud/dashboard/settings/api-keys, update the OTWA_API_KEY env var, and restart this MCP server.',
      status,
      'unauthorized',
      body,
    );
  }
  if (status === 403) {
    return new OtwaApiError(
      bodyMessage ||
        'Forbidden — the API key is missing a required scope. The dashboard at ' +
          'https://otwa.cloud/dashboard/settings/api-keys can re-issue a key with the correct scopes.',
      status,
      'forbidden',
      body,
    );
  }
  if (status === 402) {
    return new OtwaApiError(
      'Account balance is too low to complete this operation. Tell the user to top up at ' +
        'https://otwa.cloud/dashboard/billing, or use otwa_get_wallet_balance to fetch a crypto deposit address.',
      status,
      'payment_required',
      body,
    );
  }
  if (status === 404) {
    return new OtwaApiError(
      bodyMessage ||
        'Resource not found. If this is a server id, call otwa_list_servers to see what exists on this account.',
      status,
      'not_found',
      body,
    );
  }
  if (status === 409) {
    return new OtwaApiError(
      bodyMessage || 'Conflict — the resource is already in the target state, or the operation is in progress.',
      status,
      'conflict',
      body,
    );
  }
  if (status === 422 || status === 400) {
    return new OtwaApiError(
      bodyMessage || 'Validation failed. Check the field constraints and call again.',
      status,
      'validation_failed',
      body,
    );
  }
  if (status === 429) {
    return new OtwaApiError(
      'Rate-limited by otwa-cloud-api. Wait a few seconds before retrying.',
      status,
      'rate_limited',
      body,
    );
  }
  if (status >= 500) {
    const trace = requestId ? ` Request id: ${requestId}.` : '';
    return new OtwaApiError(
      `otwa-cloud-api returned ${status}. This is a server-side issue — retry once, then contact support@otwa.cloud if it persists.${trace}`,
      status,
      'upstream_error',
      body,
    );
  }
  return new OtwaApiError(
    bodyMessage || `Unexpected HTTP ${status} from otwa-cloud-api.`,
    status,
    'unknown',
    body,
  );
}

function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.message === 'string') return b.message;
  if (Array.isArray(b.message)) return b.message.join('; ');
  if (typeof b.error === 'string') return b.error;
  return null;
}
