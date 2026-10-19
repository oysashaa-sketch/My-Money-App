const CACHE='my-money-v03-assistant-20261019-1';
const ASSETS=['./','./index.html','./style.css','./finance.js','./assistant-ui.js','./planner.js','./planner-ui.js','./app.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png'];
// Waiting worker activates after old clients close, avoiding mixed versions in an open app.
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(names=>Promise.all(names.filter(n=>n.startsWith('my-money-v0')&&n!==CACHE).map(n=>caches.delete(n)))))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(caches.open(CACHE).then(async cache=>{const hit=await cache.match(e.request);if(hit)return hit;return fetch(e.request)}))});
