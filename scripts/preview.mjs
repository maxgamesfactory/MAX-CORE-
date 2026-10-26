import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const port = Number(process.env.PORT ?? 3100);
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://preview.invalid').pathname);
    const file = pathname === '/' ? resolve(root, 'tests/browser/index.html') : resolve(root, `.${pathname}`);
    if (pathname !== '/' && !file.startsWith(`${dist}${sep}`)) { response.writeHead(404).end('Not found'); return; }
    const content = await readFile(file);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json', '.ts': 'text/plain' }[extname(file)] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-store' }).end(content);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(port, '0.0.0.0', () => console.log(`MAX-CORE verification ready at http://localhost:${port}`));
