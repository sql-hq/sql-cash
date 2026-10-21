import { serve } from './serve.mjs';
import { fileURLToPath } from 'node:url';
serve({publicDir:fileURLToPath(new URL('../dist',import.meta.url)),port:Number(process.env.PORT||3000),base:process.env.BASE_PATH||'/'});
