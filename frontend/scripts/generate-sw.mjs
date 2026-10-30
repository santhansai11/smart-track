import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Precache the built public shell so initial JS/CSS also survive an offline reload.
// API responses, GPS, auth traffic and third-party tiles are never cached.
const files = (await readdir(new URL('../dist/assets/', import.meta.url)))
  .filter(name => /\.(js|css)$/.test(name)).sort().map(name => '/assets/' + name);
const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
const shell = ['/index.html', '/icon.svg', '/manifest.webmanifest', ...files];
await writeFile(new URL('../dist/sw.js', import.meta.url), `
const CACHE='smarttrack-${version}';
const SHELL=${JSON.stringify(shell)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
// Do not skipWaiting: an update must not interrupt an active running tab.
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('smarttrack-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api'))return;
 if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(c=>c.match('/index.html'))));return;}
 if(SHELL.includes(url.pathname))event.respondWith(caches.open(CACHE).then(async c=>(await c.match(event.request))||fetch(event.request)));
});
`);
console.log(`Generated offline shell: ${shell.length} assets, ${version}`);
