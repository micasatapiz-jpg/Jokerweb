const CACHE_PREFIX = 'joker-sequences-'
const CACHE_NAME = `${CACHE_PREFIX}v6`

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.clients.claim(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (
    request.method !== 'GET'
    || url.origin !== self.location.origin
    || !url.pathname.startsWith('/secuencias/joker/')
  ) return

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request)
      if (cached) return cached

      // Reuse matching versions from the previous schema without deleting other clips.
      for (const name of await caches.keys()) {
        if (name === CACHE_NAME || !name.startsWith(CACHE_PREFIX)) continue
        const previous = await caches.open(name)
        const matching = await previous.match(request)
        if (matching) {
          await cache.put(request, matching.clone())
          return matching
        }
      }

      const response = await fetch(request)
      if (response.ok && response.headers.get('content-type')?.startsWith('image/')) {
        try {
          await cache.put(request, response.clone())
        } catch {
          // El navegador puede limitar o liberar almacenamiento automáticamente.
        }
      }
      return response
    }).catch(() => fetch(request)),
  )
})
