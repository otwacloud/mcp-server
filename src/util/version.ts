import { readFileSync } from 'fs';
import { join } from 'path';

let cached: { name: string; version: string } | null = null;

export function packageInfo(): { name: string; version: string } {
  if (cached) return cached;
  try {
    const raw = readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as { name?: string; version?: string };
    cached = { name: pkg.name || '@otwa/mcp-server', version: pkg.version || '0.0.0' };
  } catch {
    cached = { name: '@otwa/mcp-server', version: '0.0.0' };
  }
  return cached;
}
