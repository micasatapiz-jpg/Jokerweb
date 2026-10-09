import assert from 'node:assert/strict'
import test from 'node:test'
import { SequenceFrameStore } from './sequenceFrameStore.js'

const urls = Array.from({ length: 100 }, (_, index) => `frame-${index}`)

test('downloads are bounded and scrolling reuses the compressed frames', async () => {
  let active = 0
  let peak = 0
  let downloads = 0
  const store = new SequenceFrameStore(urls, {
    fetchBlob: async (url) => {
      downloads++
      peak = Math.max(peak, ++active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
      return url
    },
    decode: async (blob) => ({ blob, close() {} }),
  })
  let progress = 0
  await store.preload((value) => { progress = value })
  assert.equal(progress, urls.length)
  assert.ok(peak <= 4)
  await store.prepare(0)
  await store.prepare(70)
  await store.prepare(5)
  assert.equal(downloads, urls.length)
  assert.ok(store.images.size <= 32)
  assert.equal(store.images.get(5).blob, 'frame-5')
  store.dispose()
})

test('a fast reversal prioritizes the new destination and closes evicted images', async () => {
  let active = 0
  let peak = 0
  let closed = 0
  const decoded = []
  const store = new SequenceFrameStore(urls, {
    fetchBlob: async (url) => url,
    decode: async (blob) => {
      peak = Math.max(peak, ++active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
      decoded.push(blob)
      return { blob, close() { closed++ } }
    },
  })
  await store.preload()
  const first = store.prepare(0)
  const second = store.prepare(80)
  await Promise.all([first, second])
  assert.ok(peak <= 3)
  assert.equal(decoded[3], 'frame-80')
  assert.equal(store.images.get(80).blob, 'frame-80')
  await store.prepare(10)
  assert.ok(closed > 0)
  assert.ok(store.images.size <= 32)
  store.dispose()
})

test('a failed frame rejects readiness instead of counting it as loaded', async () => {
  const store = new SequenceFrameStore(['missing'], {
    fetchBlob: async () => { throw new Error('HTTP 404') },
  })
  let completed = 0
  await assert.rejects(store.preload(() => completed++), /HTTP 404/)
  assert.equal(completed, 0)
  store.dispose()
})

test('reduced motion can fetch only the final still; disposal aborts network work', async () => {
  const fetched = []
  const store = new SequenceFrameStore(urls, {
    fetchBlob: async (url) => { fetched.push(url); return url },
    decode: async (blob) => ({ blob, close() {} }),
  })
  await store.preload(undefined, [99])
  await store.prepare(99)
  assert.deepEqual(fetched, ['frame-99'])
  store.dispose()
  assert.equal(store.controller.signal.aborted, true)
  assert.equal(store.images.size, 0)
  assert.equal(store.blobs.size, 0)
})
