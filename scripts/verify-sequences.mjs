import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const origin = process.argv[2]
let total = 0
let bytes = 0
for (const [clip, count, version] of [['clip-01', 480, 'hq-3'], ['clip-02', 192, 'webp-lossless-1'], ['clip-03', 192, 'webp-lossless-1']]) {
  const dir = `public/secuencias/joker/${clip}`
  assert.equal((await readdir(dir)).filter((file) => file.endsWith('.webp')).length, count)
  let clipBytes = 0
  for (let i = 1; i <= count; i++) {
    const name = `frame-${String(i).padStart(3, '0')}.webp`
    const buffer = await readFile(`${dir}/${name}`)
    assert.equal(buffer.toString('ascii', 0, 4), 'RIFF')
    assert.equal(buffer.toString('ascii', 8, 12), 'WEBP')
    clipBytes += (await stat(`${dir}/${name}`)).size
    if (origin) {
      const response = await fetch(`${origin}/secuencias/joker/${clip}/${name}?v=${version}`, { method: 'HEAD' })
      assert.equal(response.status, 200, name)
      assert.match(response.headers.get('content-type'), /image\/webp/)
    }
  }
  total += count
  bytes += clipBytes
  console.log({ clip, count, bytes: clipBytes })
}
assert.equal(total, 864)
console.log({ total, bytes, MiB: bytes / 1024 ** 2, httpVerified: Boolean(origin) })

// Exercise the actual viewer mapping without replacing it with a test formula.
const source = await readFile('src/components/ImageSequenceViewer.jsx', 'utf8')
const mapping = source.slice(source.indexOf('const actualizar ='), source.indexOf('\n    ajustarCanvas()', source.indexOf('const actualizar =')))
let rendered
const update = runInNewContext(`${mapping}; actualizar`, {
  ready: true, limitar: (n, min, max) => Math.min(Math.max(n, min), max), totalClips: 3,
  clips: [{ inicio: 0, cantidad: 480 }, { inicio: 480, cantidad: 192 }, { inicio: 672, cantidad: 192 }],
  totalEscenas: 7, mostrarFrame: (index) => { rendered = index },
  transicion: { dataset: {} }, gsap: { set() {} }, notificarEscena() {}, callbackProgresoRef: {},
})
for (const indexes of [Array.from({ length: 192 }, (_, i) => i), Array.from({ length: 192 }, (_, i) => 191 - i)]) {
  for (const i of indexes) {
    update((2 + i / 191) / 3)
    assert.equal(rendered, 672 + i)
  }
}
update(0)
assert.equal(rendered, 0)
console.log('Scroll mapping: all 192 clip-03 frames forward/backward; top returns clip-01 frame 1.')
