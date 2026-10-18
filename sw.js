const CACHE='my-money-v01-20261018-b';
const ASSETS=['./','./index.html','./style.css','./app.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(names=>Promise.all(names.filter(n=>n!==CACHE).map(n=>caches.delete(n)))));self.clients.claim()});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(res=>{if(res.ok){const cp=res.clone();caches.open(CACHE).then(cache=>cache.put(e.request,cp))}return res}).catch(()=>caches.match(e.request)))});
