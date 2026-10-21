// Node globals the Railgun SDK expects. Must be imported before any @railgun-community module.
// No-ops in Node, where these already exist.
import { Buffer } from 'buffer';
import process from 'process/browser.js';

const g = globalThis as unknown as { Buffer?: unknown; process?: { env?: object; version?: string }; global?: unknown };
g.global ??= globalThis;
g.Buffer ??= Buffer;
if (!g.process) g.process = process as never;
g.process!.env ??= {};
g.process!.version ??= 'v22.0.0';
