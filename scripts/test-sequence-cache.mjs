import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CACHE_NAME, isSequenceCached, manifestUrl, storeSequence } from '../src/utils/sequenceCache.js'

// Contract tests; this double does not replace browser/DevTools verification.
const origin = 'http://localhost'
const absolute = (input) => new URL(input.url ?? input, origin).href
const stores = new Map()
globalThis.location = { origin }
globalThis.window = globalThis
globalThis.caches = {
  async keys() { return [...stores.keys()] },
  async open(name) {
    if (!stores.has(name)) stores.set(name, new Map())
    const entries = stores.get(name)
    return {
      async keys() { return [...entries.keys()].map((url) => new Request(url)) },
      async match(key) { return entries.get(absolute(key))?.clone() },
      async put(key, value) { entries.set(absolute(key), value.clone()) },
      async delete(key) { return entries.delete(absolute(key)) },
    }
  },
}
const clips = [{ ruta: '/secuencias/joker/clip-01' }, { ruta: '/secuencias/joker/clip-02' }, { ruta: '/secuencias/joker/clip-03' }]
const frames = clips.flatMap((clip, i) => Array.from({ length: i ? 192 : 480 }, (_, frame) => `${clip.ruta}/frame-${String(frame + 1).padStart(3, '0')}.webp?v=one`))
let requests = []
let fail = null
globalThis.fetch = async (url) => {
  requests.push(url)
  return new Response('image', { status: url === fail ? 404 : 200, headers: { 'Content-Type': 'image/webp' } })
}

test('864 entries: cold, warm, eviction, failure, repair, version isolation, corrupt manifest', async () => {
  assert.equal(await isSequenceCached(clips, frames), false)
  await storeSequence(clips, frames)
  assert.equal(requests.length, 864)
  assert.equal(await isSequenceCached(clips, frames), true)
  requests = []
  await storeSequence(clips, frames)
  assert.equal(requests.length, 0)

  const cache = await caches.open(CACHE_NAME)
  fail = frames[700]
  await cache.delete(fail)
  assert.equal(await isSequenceCached(clips, frames), false)
  await assert.rejects(storeSequence(clips, frames))
  assert.equal(await isSequenceCached(clips, frames), false)
  fail = null
  requests = []
  await storeSequence(clips, frames)
  assert.deepEqual(requests, [frames[700]])
  assert.equal(await isSequenceCached(clips, frames), true)

  const changed = frames.map((frame) => frame.includes('clip-03') ? frame.replace('v=one', 'v=two') : frame)
  requests = []
  assert.equal(await isSequenceCached(clips, changed), false)
  await storeSequence(clips, changed)
  assert.equal(requests.length, 192)
  assert.equal(await cache.match(frames[700]), undefined)
  assert.ok(await cache.match(frames[0]))
  assert.equal(await isSequenceCached(clips, changed), true)
  assert.equal((await cache.keys()).length, 866)
  await cache.put(manifestUrl(clips), new Response('invalid'))
  assert.equal(await isSequenceCached(clips, changed), false)
  await storeSequence(clips, changed)
  assert.equal(await isSequenceCached(clips, changed), true)
})
