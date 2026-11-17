import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OtwaApiError } from '../client/errors';

/** Format a JSON value as a single text-block tool result. The LLM gets clean
 *  pretty-printed JSON it can reason about and quote back to the user. */
export function jsonResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

/** Format a plain prose response (no JSON). Used for narrative tools like
 *  SSO link issuance where dumping JSON would just confuse the model. */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Wrap a tool handler so any throw becomes a structured error result instead
 *  of crashing the transport. MCP clients display these to the user and let
 *  the model see the error message and recover. */
export function safeHandler<TArgs>(
  fn: (args: TArgs) => Promise<CallToolResult>,
): (args: TArgs) => Promise<CallToolResult> {
  return async (args: TArgs) => {
    try {
      return await fn(args);
    } catch (err: unknown) {
      const message =
        err instanceof OtwaApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      };
    }
  };
}
