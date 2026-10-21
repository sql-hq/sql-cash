import { createRequire } from 'node:module';
import { fileURLToPath,pathToFileURL } from 'node:url';
import path from 'node:path';
import { createServer as httpServer } from 'node:http';
import { createRpcGateway } from './rpc-gateway.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const web=path.join(root,'apps/web');
const require=createRequire(path.join(web,'package.json'));
const vite=await import(pathToFileURL(require.resolve('vite')).href);
const config={root:web,configFile:path.join(web,'vite.config.ts'),base:process.env.BASE_PATH||'/',define:{'import.meta.env.VITE_MAINNET_RPC_PROXY':JSON.stringify('true')}};
if(process.argv[2]==='build')await vite.build({...config,build:{outDir:path.join(root,'dist'),emptyOutDir:true}});
else{const port=Number(process.env.RPC_DEV_PORT||3001);const gateway=createRpcGateway({base:'/'});httpServer((req,res)=>void gateway(req,res,()=>{res.writeHead(404);res.end();})).listen(port,'127.0.0.1');const server=await vite.createServer({...config,server:{host:'127.0.0.1',port:5173,proxy:{'/rpc':{target:'http://127.0.0.1:'+port}}}});await server.listen();server.printUrls();}
