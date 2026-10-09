import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadFramePack, unpackFrames } from './framePacks.js'

function pack(...frames) {
  const payloads = frames.map((frame) => Buffer.from(frame))
  const header = Buffer.alloc(12 + frames.length * 4)
  header.write('JSEQ001\n')
  header.writeUInt32LE(frames.length, 8)
  payloads.forEach((frame, index) => header.writeUInt32LE(frame.length, 12 + index * 4))
  const bytes = Buffer.concat([header, ...payloads])
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

test('packs preserve every frame and its order; malformed data is rejected', async () => {
  const buffer = pack('first', 'last')
  const frames = unpackFrames(buffer, 2)
  assert.deepEqual(await Promise.all(frames.map((frame) => frame.text())), ['first', 'last'])
  assert.throws(() => unpackFrames(buffer, 1), /frame count/)
  assert.throws(() => unpackFrames(buffer.slice(0, -1), 2), /Incomplete/)
  assert.throws(() => unpackFrames(new ArrayBuffer(12), 1), /header/)
})

test('all generated packs cover exactly the latest 864 frames', async () => {
  const manifest = JSON.parse(await readFile(new URL('../config/sequenceBundles.json', import.meta.url)))
  assert.equal(manifest.sourceCommit, '54387c7b571703000b74fd7d3051d09601e6f79a')
  for (const variant of ['desktop', 'mobile']) {
    let next = 0
    for (const descriptor of manifest[variant]) {
      assert.equal(descriptor.start, next)
      const file = await readFile(new URL(`../../public${descriptor.url}`, import.meta.url))
      assert.equal(file.byteLength, descriptor.bytes)
      const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
      assert.equal(unpackFrames(buffer, descriptor.count).length, descriptor.count)
      next += descriptor.count
    }
    assert.equal(next, 864)
  }
})

test('persistent cache avoids repeat downloads and recovers corrupt entries', async (context) => {
  const buffer = pack('image')
  const descriptor = { url: '/test-pack.bin', count: 1, bytes: buffer.byteLength }
  let stored
  let requests = 0
  context.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(buffer) })
  const previousCaches = globalThis.caches
  globalThis.caches = { open: async () => ({
    match: async () => stored?.clone(),
    put: async (_, response) => { stored = response },
    delete: async () => { stored = undefined },
  }) }
  try {
    const signal = new AbortController().signal
    await loadFramePack(descriptor, signal)
    await loadFramePack(descriptor, signal)
    assert.equal(requests, 1)
    stored = new Response('corrupt')
    await loadFramePack(descriptor, signal)
    assert.equal(requests, 2)
  } finally {
    if (previousCaches === undefined) delete globalThis.caches
    else globalThis.caches = previousCaches
  }
})
