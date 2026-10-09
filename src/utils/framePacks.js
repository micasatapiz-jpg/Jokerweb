export const PACK_CACHE_NAME = 'joker-sequence-packs-v1'
const MAGIC = 'JSEQ001\n'

export async function areFramePacksCached(descriptors) {
  if (typeof caches === 'undefined') return false
  try {
    const cache = await caches.open(PACK_CACHE_NAME)
    const keys = new Set((await cache.keys()).map((request) => request.url))
    return descriptors.every((pack) => keys.has(new URL(pack.url, location.origin).href))
  } catch {
    return false
  }
}

export function unpackFrames(buffer, expectedCount) {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) {
    throw new Error('Invalid sequence pack header')
  }
  const view = new DataView(buffer)
  const count = view.getUint32(8, true)
  if (count !== expectedCount || count < 1 || count > 64 || bytes.length < 12 + count * 4) {
    throw new Error('Invalid sequence pack frame count')
  }
  let offset = 12 + count * 4
  const frames = []
  for (let index = 0; index < count; index++) {
    const length = view.getUint32(12 + index * 4, true)
    if (!length || offset + length > bytes.length) throw new Error('Incomplete sequence pack')
    frames.push(new Blob([bytes.subarray(offset, offset + length)], { type: 'image/webp' }))
    offset += length
  }
  if (offset !== bytes.length) throw new Error('Unexpected sequence pack data')
  return frames
}

export async function loadFramePack(descriptor, signal) {
  // Private browsing or quota limits can disable persistent cache; rendering
  // still works with the current visit's compressed bytes.
  const cache = typeof caches === 'undefined' ? null : await caches.open(PACK_CACHE_NAME).catch(() => null)
  const stored = await cache?.match(descriptor.url).catch(() => null)
  if (stored) {
    try {
      return unpackFrames(await stored.arrayBuffer(), descriptor.count)
    } catch {
      await cache.delete(descriptor.url).catch(() => {})
    }
  }
  const response = await fetch(descriptor.url, { signal })
  if (!response.ok) throw new Error(`Sequence pack HTTP ${response.status}: ${descriptor.url}`)
  const buffer = await response.arrayBuffer()
  if (signal.aborted) throw signal.reason
  if (buffer.byteLength !== descriptor.bytes) throw new Error('Incomplete sequence pack response')
  const frames = unpackFrames(buffer, descriptor.count)
  if (cache) {
    await cache.put(descriptor.url, new Response(buffer, {
      headers: { 'Content-Type': 'application/octet-stream' },
    })).catch(() => {})
  }
  return frames
}
