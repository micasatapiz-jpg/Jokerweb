export const CACHE_NAME = 'joker-sequences-v6'
const jobs = new Map()
const BACKGROUND_WORKERS = 4

export function manifestUrl(clips) {
  return `/secuencias/joker/manifest-${clips.map((clip) => clip.ruta.split('/').pop()).join('-')}.json`
}

function initialManifestUrl(clips) {
  return `${manifestUrl(clips).replace('.json', '')}-initial.json`
}

function getFirstClipFrames(clips, frames) {
  const count = clips[0]?.cantidad
  if (Number.isInteger(count) && count > 0) return frames.slice(0, count)
  const firstRoute = clips[0]?.ruta
  if (!firstRoute) return []
  return frames.filter((frame) => (
    new URL(frame, location.origin).pathname.startsWith(`${firstRoute}/frame-`)
  ))
}

async function validateManifest(url, expectedFrames) {
  if (!('caches' in window)) return false
  const cache = await caches.open(CACHE_NAME)
  const response = await cache.match(url)
  if (!response) return false
  const manifest = await response.json().catch(() => null)
  if (!manifest) return false
  if (
    manifest.version !== CACHE_NAME
    || JSON.stringify(manifest.frames) !== JSON.stringify(expectedFrames)
  ) return false
  // Enumerate real entries: a completion flag alone cannot detect browser eviction.
  const keys = new Set((await cache.keys()).map((request) => request.url))
  return expectedFrames.every((frame) => keys.has(new URL(frame, location.origin).href))
}

export function isSequenceCached(clips, frames) {
  return validateManifest(manifestUrl(clips), frames)
}

export function isInitialSequenceCached(clips, frames) {
  return validateManifest(initialManifestUrl(clips), getFirstClipFrames(clips, frames))
}

export function storeSequence(clips, frames) {
  const key = JSON.stringify(frames)
  if (jobs.has(key)) return jobs.get(key)
  const job = (async () => {
    if (!('caches' in window)) throw new Error('Cache Storage no está disponible')
    const cache = await caches.open(CACHE_NAME)
    const existing = new Set((await cache.keys()).map((request) => request.url))
    const cacheFrames = async (frameGroup) => {
      let cursor = 0
      const results = await Promise.allSettled(Array.from({ length: BACKGROUND_WORKERS }, async () => {
        while (cursor < frameGroup.length) {
          const frame = frameGroup[cursor++]
        if (existing.has(new URL(frame, location.origin).href)) continue
        let failure
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await fetch(frame)
            if (!response.ok || !response.headers.get('content-type')?.includes('image/')) {
              throw new Error(`No se pudo guardar ${frame}: ${response.status}`)
            }
            await cache.put(frame, response)
            failure = null
            break
          } catch (error) {
            failure = error
          }
        }
        if (failure) throw failure
        }
      }))
      const failed = results.find((result) => result.status === 'rejected')
      if (failed) throw failed.reason
    }

    const firstClipFrames = getFirstClipFrames(clips, frames)
    await cacheFrames(firstClipFrames)
    await cache.put(initialManifestUrl(clips), new Response(JSON.stringify({
      version: CACHE_NAME,
      total: firstClipFrames.length,
      frames: firstClipFrames,
    }), { headers: { 'Content-Type': 'application/json' } }))

    // No se solicita ningún fotograma posterior hasta terminar el primer clip.
    await cacheFrames(frames.slice(firstClipFrames.length))
    const keys = await cache.keys()
    const urls = new Set(keys.map((request) => request.url))
    if (!frames.every((frame) => urls.has(new URL(frame, location.origin).href))) {
      throw new Error('La secuencia no está completa')
    }
    await cache.put(manifestUrl(clips), new Response(JSON.stringify({
      version: CACHE_NAME, total: frames.length, frames,
    }), { headers: { 'Content-Type': 'application/json' } }))
    // Commit first; remove only superseded frames from the clips in this manifest.
    const current = new Set(frames.map((frame) => new URL(frame, location.origin).href))
    await Promise.all(keys.filter((request) => {
      const url = new URL(request.url)
      return clips.some((clip) => url.pathname.startsWith(`${clip.ruta}/frame-`)) && !current.has(request.url)
    }).map((request) => cache.delete(request)))
    for (const name of await caches.keys()) {
      if (name === CACHE_NAME || !name.startsWith('joker-sequences-')) continue
      const previous = await caches.open(name)
      await Promise.all((await previous.keys()).filter((request) => {
        const url = new URL(request.url)
        return clips.some((clip) => url.pathname.startsWith(`${clip.ruta}/frame-`))
      }).map((request) => previous.delete(request)))
    }
  })().finally(() => jobs.delete(key))
  jobs.set(key, job)
  return job
}
