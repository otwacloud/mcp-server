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
        'transactions are the money movements (card payments, crypto deposits, balance adjustments).',
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

  server.registerTool(
    'otwa_get_deposit_address',
    {
      title: 'Get a crypto deposit address',
      description:
        'Returns the account\'s USDT deposit address on the chosen chain, creating it on first use. Share it ' +
        'with the user to top up the balance; deposits are credited after network confirmation. Requires ' +
        '`billing:read`.',
      inputSchema: {
        chain: z.enum(['tron', 'arbitrum']).optional().describe('tron (TRC-20, default) or arbitrum.'),
      },
    },
    safeHandler(async ({ chain }) =>
      jsonResult(await client.request('/v1/wallet/deposit-address', { method: 'POST', body: { chain: chain ?? 'tron' } })),
    ),
  );

  server.registerTool(
    'otwa_list_wallet_transactions',
    {
      title: 'List crypto wallet transactions',
      description: 'On-chain deposits seen on the account\'s deposit addresses, newest first.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe('Page size, default 50.'),
        offset: z.number().int().min(0).optional().describe('Skip this many, default 0.'),
      },
    },
    safeHandler(async ({ limit, offset }) =>
      jsonResult(await client.request('/v1/wallet/transactions', { query: { limit, offset } })),
    ),
  );

  server.registerTool(
    'otwa_get_invoice_pdf',
    {
      title: 'Download an invoice document',
      description:
        'Returns the invoice as a document attachment (PDF, or HTML where a PDF is not available). Use ' +
        'otwa_get_invoice to read the figures; use this when the user wants the file itself.',
      inputSchema: { id: z.string().describe('Invoice UUID. Source: otwa_list_invoices.') },
    },
    safeHandler(async ({ id }) => {
      const res = await client.request<Response>(`/v1/billing/invoices/${encodeURIComponent(id)}/pdf`, {
        raw: true,
        timeoutMs: 60_000,
      });
      const mimeType = (res.headers.get('content-type') || 'application/pdf').split(';')[0]!.trim();
      const disposition = res.headers.get('content-disposition') || '';
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || `invoice-${id}.pdf`;
      const blob = Buffer.from(await res.arrayBuffer()).toString('base64');
      return {
        content: [
          { type: 'text', text: `Invoice document ${filename} (${mimeType}).` },
          { type: 'resource', resource: { uri: `otwa://invoices/${id}/${filename}`, mimeType, blob } },
        ],
      };
    }),
  );
}
