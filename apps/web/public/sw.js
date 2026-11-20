/* Cleanup worker for obsolete RooH service-worker registrations. */
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.map(name=>caches.delete(name)));
    await self.registration.unregister();
    const clientsList=await self.clients.matchAll({type:"window"});
    for(const client of clientsList)client.navigate(client.url);
  })());
});
