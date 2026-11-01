import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, extname } from 'node:path';

// KeyGuard XDR v0.1: localhost-only frontend preview server.
// No API routes, user logins, security scans, or remote integrations.
const root=dirname(fileURLToPath(import.meta.url));
const allowed=new Set(['/','/index.html','/styles.css','/app.js']);
const contentTypes={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const port=Number(process.env.PORT||5173);
if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('INVALID_LOCAL_PORT');
const server=http.createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
 if(!allowed.has(pathname)){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');return;}
 const rel=pathname==='/'?'/index.html':pathname;
 try{
  const content=await readFile(resolve(root,'.'+rel));
  res.writeHead(200,{
   'Content-Type':contentTypes[extname(rel)],
   'Cache-Control':'no-store',
   'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
   'X-Content-Type-Options':'nosniff',
   'Referrer-Policy':'no-referrer',
  });
  res.end(req.method==='HEAD'?undefined:content);
 }catch{res.writeHead(500);res.end('Preview unavailable');}
});
server.listen(port,'127.0.0.1',()=>console.log(`KeyGuard XDR v0.1 preview: http://127.0.0.1:${port}`));
