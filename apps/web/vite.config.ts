import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
// Absolute entry paths so packages outside this folder (pnpm, strict) resolve the same browser builds.
const browserBuiltins = Object.fromEntries(Object.entries({ crypto: 'crypto-browserify', stream: 'stream-browserify', util: 'util', events: 'events', assert: 'assert', string_decoder: 'string_decoder', buffer: 'buffer', 'process/browser.js': 'process/browser.js' })
  .map(([name, pkg]) => [name, pkg.endsWith('.js') ? require.resolve(pkg) : `${dirname(require.resolve(`${pkg}/package.json`))}/`]));

let siteUrl = '';
const rootEnvironmentDirectory = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  plugins: [react(), {
    // Absolute URLs for link previews: set VITE_SITE_URL (e.g. https://sql.example.com) at build time.
    name: 'sql-site-url',
    configResolved(config) { siteUrl = String(config.env.VITE_SITE_URL || process.env.VITE_SITE_URL || '').replace(/\/$/, ''); },
    transformIndexHtml: html => siteUrl
      ? html.replaceAll('__SITE_URL__', siteUrl)
      // Without a public URL, drop the absolute-only tags and point images at the relative file.
      : html.replace(/\s*<link rel="canonical"[^>]*>/, '').replace(/\s*<meta property="og:url"[^>]*>/, '').replaceAll('__SITE_URL__/', './'),
  }],
  // The Railgun SDK (mainnet privacy backend) imports Node built-ins; map them to browser builds.
  // Buffer/process globals are installed by @silentquery/railgun/globals before the SDK loads.
  resolve: { alias: browserBuiltins },
  define: { global: 'globalThis' },
  envDir: rootEnvironmentDirectory,
  envPrefix: 'VITE_',
  worker: { format: 'es' },
  // Lightning CSS 1.33 rejects the valid ::picker(select)::-webkit-scrollbar rules.
  build: { target: 'es2022', cssMinify: 'esbuild', chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173, strictPort: true,
    fs: { strict: true, deny: ['**/.env', '**/.env.*', '**/.artifacts/**', '**/.research/**', '**/*.{crt,pem}', '**/.git/**'] },
  },
});
