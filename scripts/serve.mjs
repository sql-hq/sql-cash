import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRpcGateway } from './rpc-gateway.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

export function serve({ publicDir, port = Number(process.env.PORT), base = '/' }) {
  if (!Number.isInteger(port) || port <= 0) throw new Error('PORT must be configured.');
  if (!existsSync(path.join(publicDir, 'index.html'))) throw new Error('The production frontend must be built before starting.');
  const gateway = createRpcGateway({ base });
  const prefix = `/${base.split('/').filter(Boolean).join('/')}${base === '/' ? '' : '/'}`;
  const server = createServer((req, res) => {
    void gateway(req, res, () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        if (!pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
        const relative = pathname.slice(prefix.length);
        if (relative.split('/').some(part => part.startsWith('.'))) { res.writeHead(404).end(); return; }
        let file = path.resolve(publicDir, relative || 'index.html');
        if (!file.startsWith(`${path.resolve(publicDir)}${path.sep}`)) { res.writeHead(404).end(); return; }
        if (!existsSync(file) || !statSync(file).isFile()) {
          if (path.extname(relative) || relative.startsWith('rpc/') || relative.startsWith('api/')) { res.writeHead(404).end(); return; }
          file = path.join(publicDir, 'index.html');
        }
        res.writeHead(200, {
          'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
          'Content-Length': statSync(file).size,
          'Cache-Control': relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
        });
        if (req.method === 'HEAD') { res.end(); return; }
        createReadStream(file).on('error', () => res.destroy()).pipe(res);
      } catch { if (!res.headersSent) res.writeHead(400); res.end(); }
    }).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  server.requestTimeout = 30_000; server.headersTimeout = 15_000;
  server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'server_ready', port })));
  const close = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); };
  process.once('SIGTERM', close); process.once('SIGINT', close);
  return server;
}
