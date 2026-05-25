import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OtwaClient } from '../client/http';
import type { InvoiceSummary, WalletResponse } from '../client/types';
import { jsonResult, safeHandler } from './_helpers';

export function registerBillingTools(server: McpServer, client: OtwaClient): void {
  server.registerTool(
    'otwa_list_invoices',
    {
      title: 'List billing invoices',
      description:
        'Returns paged invoice history (most recent first). Each entry has id, invoiceNumber, total, ' +
        'status (paid/open/void), and creation date. Use otwa_get_invoice for line-item detail.',
      inputSchema: {
        page: z.number().int().min(1).optional().describe('Page number, default 1.'),
        limit: z.number().int().min(1).max(100).optional().describe('Page size, default 20, max 100.'),
      },
    },
    safeHandler(async ({ page, limit }) => {
      const res = await client.request<InvoiceSummary[]>('/v1/billing/invoices', {
        query: { page, limit },
      });
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_get_invoice',
    {
      title: 'Get one invoice in detail',
      description: 'Returns the full invoice including line items, taxes, and payment status.',
      inputSchema: {
        id: z.string().describe('Invoice UUID. Source: otwa_list_invoices.'),
      },
    },
    safeHandler(async ({ id }) => {
      const res = await client.request<InvoiceSummary>(`/v1/billing/invoices/${encodeURIComponent(id)}`);
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_list_transactions',
    {
      title: 'List billing transactions (top-ups, charges, refunds)',
      description:
        'Returns paged transaction history. Distinct from invoices — invoices are the document, ' +
        'transactions are the money movements (Stripe charges, crypto deposits, balance adjustments).',
      inputSchema: {
        page: z.number().int().min(1).optional().describe('Page number, default 1.'),
        limit: z.number().int().min(1).max(100).optional().describe('Page size, default 20, max 100.'),
      },
    },
    safeHandler(async ({ page, limit }) => {
      const res = await client.request('/v1/billing/transactions', { query: { page, limit } });
      return jsonResult(res);
    }),
  );

  server.registerTool(
    'otwa_get_wallet_balance',
    {
      title: 'Get crypto wallet balances + deposit addresses',
      description:
        'Returns the on-chain wallets the account holds, with chain, address, and balance. The address ' +
        'can be shared with the user to top up. Read-only — does not create new addresses.',
      inputSchema: {},
    },
    safeHandler(async () => {
      const res = await client.request<WalletResponse[]>('/v1/wallet');
      return jsonResult(res);
    }),
  );
}
