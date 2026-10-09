async function decodeFrame(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob)
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Keep compressed bytes for the whole sequence, but only a bounded decoded window.
// Downloading and decoding are deliberately separate from the animation's draw loop.
export class SequenceFrameStore {
  constructor(urls, {
    fetchBlob = async (url, signal) => {
      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error(`Frame HTTP ${response.status}: ${url}`)
      return response.blob()
    },
    decode = decodeFrame,
    concurrency = 3,
    cacheLimit = 32,
  } = {}) {
    this.urls = urls
    this.fetchBlob = fetchBlob
    this.decode = decode
    this.concurrency = concurrency
    this.cacheLimit = cacheLimit
    this.controller = new AbortController()
    this.blobs = new Map()
    this.images = new Map()
    this.pending = new Map()
    this.queue = []
    this.active = 0
    this.target = 0
    this.direction = 1
    this.disposed = false
  }

  async preload(onProgress, indices = this.urls.map((_, index) => index)) {
    let next = 0
    let completed = 0
    const worker = async () => {
      while (next < indices.length && !this.disposed) {
        const index = indices[next++]
        const blob = await this.fetchBlob(this.urls[index], this.controller.signal)
        if (this.disposed) return
        this.blobs.set(index, blob)
        onProgress?.(++completed)
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, indices.length) }, worker))
  }

  prepare(index) {
    this.direction = index === this.target ? this.direction : Math.sign(index - this.target)
    this.target = index
    // Drop queued work for old scroll positions; in-flight decodes remain bounded.
    for (const queued of this.queue) {
      this.pending.get(queued)?.resolve(null)
      this.pending.delete(queued)
    }
    this.queue = []
    const desired = [index]
    for (let distance = 1; distance <= 12; distance++) {
      desired.push(index + distance * this.direction, index - distance * this.direction)
    }
    const promises = desired
      .filter((frame) => this.blobs.has(frame))
      .map((frame) => this.request(frame))
    this.pump()
    return Promise.all(promises)
  }

  request(index) {
    if (this.images.has(index)) return Promise.resolve(this.images.get(index))
    if (this.pending.has(index)) return this.pending.get(index).promise
    let resolve
    let reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    this.pending.set(index, { promise, resolve, reject })
    this.queue.push(index)
    return promise
  }

  pump() {
    while (!this.disposed && this.active < this.concurrency && this.queue.length) {
      const index = this.queue.shift()
      const job = this.pending.get(index)
      this.active++
      Promise.resolve().then(() => this.decode(this.blobs.get(index))).then((image) => {
        if (this.disposed) {
          image.close?.()
          job.resolve(null)
          return
        }
        this.images.set(index, image)
        while (this.images.size > this.cacheLimit) {
          const farthest = [...this.images.keys()].reduce((a, b) => (
            Math.abs(a - this.target) > Math.abs(b - this.target) ? a : b
          ))
          this.images.get(farthest).close?.()
          this.images.delete(farthest)
        }
        job.resolve(image)
      }).catch(job.reject).finally(() => {
        this.pending.delete(index)
        this.active--
        this.pump()
      })
    }
  }

  dispose() {
    this.disposed = true
    this.controller.abort()
    this.images.forEach((image) => image.close?.())
    this.images.clear()
    this.blobs.clear()
    this.queue.forEach((index) => this.pending.get(index)?.resolve(null))
    this.queue = []
  }
}
