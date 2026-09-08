import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import SequenceLoader from './SequenceLoader'
import { CACHE_NAME, isInitialSequenceCached, storeSequence } from '../utils/sequenceCache'

const LIMITE_CACHE = 72
const RADIO_PRECARGA = 24
const CONCURRENCIA_PRECARGA = 6
const FRAMES_INICIO_CRITICOS = 72
const MAX_ESPERA_INICIAL_MS = 2700

function limitar(valor, minimo, maximo) {
  return Math.min(Math.max(valor, minimo), maximo)
}

function rutaFrame(ruta, numero, digitos = 3, extension = 'webp', version = '') {
  const cacheVersion = version ? `?v=${version}` : ''
  return `${ruta}/frame-${String(numero).padStart(digitos, '0')}.${extension}${cacheVersion}`
}

const ImageSequenceViewer = forwardRef(function ImageSequenceViewer(
  {
    secuencias = [],
    modo = 'scroll',
    alturaScroll,
    sceneCount,
    onSceneChange,
    onProgress,
    children,
  },
  ref,
) {
  const contenedorRef = useRef(null)
  const canvasRef = useRef(null)
  const transicionRef = useRef(null)
  const frameSolicitadoRef = useRef(0)
  const escenaRef = useRef(0)
  const callbackEscenaRef = useRef(onSceneChange)
  const callbackProgresoRef = useRef(onProgress)
  const [listo, setListo] = useState(false)
  const [mostrarCarga, setMostrarCarga] = useState(false)
  const ocultarCarga = useCallback(() => setMostrarCarga(false), [])

  const clips = useMemo(() => secuencias.map((secuencia, indice) => ({
    ...secuencia,
    inicio: secuencias
      .slice(0, indice)
      .reduce((suma, anterior) => suma + (anterior.cantidad ?? 0), 0),
    cantidad: secuencia.cantidad ?? 0,
  })), [secuencias])

  const frames = useMemo(() => clips.flatMap((clip) => (
    Array.from(
      { length: clip.cantidad },
      (_, indice) => rutaFrame(
        clip.ruta,
        indice + 1,
        clip.digitos ?? 3,
        clip.extension ?? 'webp',
        clip.version,
      ),
    )
  )), [clips])

  const totalClips = clips.length
  const totalEscenas = Math.max(sceneCount ?? totalClips + 1, 1)
  const alto = alturaScroll ?? Math.max(totalClips * 360 + 100, 460)
  useImperativeHandle(ref, () => contenedorRef.current, [])

  useEffect(() => {
    callbackEscenaRef.current = onSceneChange
    callbackProgresoRef.current = onProgress
  }, [onProgress, onSceneChange])

  const notificarEscena = useCallback((escena) => {
    if (escena === escenaRef.current) return
    escenaRef.current = escena
    callbackEscenaRef.current?.(escena)
  }, [])

  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger)

    const contenedor = contenedorRef.current
    const canvas = canvasRef.current
    const transicion = transicionRef.current
    if (!contenedor || !canvas || !transicion || !frames.length || !clips.length) {
      return undefined
    }

    let vivo = true
    const cache = new Map()
    const pendientes = new Map()
    let decoding = 0
    const decodeQueue = []
    const indicesProtegidos = new Set([
      0,
      frames.length - 1,
      ...clips.flatMap((clip) => [clip.inicio, clip.inicio + clip.cantidad - 1]),
    ])
    const contextoCanvas = canvas.getContext('2d', { alpha: false })

    setListo(false)
    setMostrarCarga(false)
    let ready = false
    let retryTimer
    let storageTimer
    let revealTimer
    const objectUrls = new Set()

    const dibujarImagen = (imagen, indiceDibujado) => {
      if (!imagen?.naturalWidth || !canvas.width || !canvas.height) return

      const ancho = canvas.width
      const altoCanvas = canvas.height
      const escala = Math.max(ancho / imagen.naturalWidth, altoCanvas / imagen.naturalHeight)
      const anchoImagen = imagen.naturalWidth * escala
      const altoImagen = imagen.naturalHeight * escala
      const posicionX = window.innerWidth <= 900 ? .58 : .5
      const x = (ancho - anchoImagen) * posicionX
      const y = (altoCanvas - altoImagen) * .5

      contextoCanvas.imageSmoothingEnabled = true
      contextoCanvas.imageSmoothingQuality = 'high'
      contextoCanvas.fillStyle = '#111a3c'
      contextoCanvas.fillRect(0, 0, ancho, altoCanvas)
      contextoCanvas.drawImage(imagen, x, y, anchoImagen, altoImagen)
      canvas.dataset.renderedFrame = String(indiceDibujado + 1)
    }

    const tocarCache = (indice) => {
      const imagen = cache.get(indice)
      if (!imagen) return null
      cache.delete(indice)
      cache.set(indice, imagen)
      return imagen
    }

    const reducirCache = () => {
      while (cache.size > LIMITE_CACHE) {
        const indiceAntiguo = cache.keys().next().value
        if (
          indiceAntiguo === frameSolicitadoRef.current
          || indicesProtegidos.has(indiceAntiguo)
          || Math.abs(indiceAntiguo - frameSolicitadoRef.current) <= RADIO_PRECARGA
        ) {
          const protegido = cache.get(indiceAntiguo)
          cache.delete(indiceAntiguo)
          cache.set(indiceAntiguo, protegido)
          continue
        }
        cache.delete(indiceAntiguo)
      }
    }

    const adquirirSlotDecodificacion = (prioridad = false) => {
      if (decoding < CONCURRENCIA_PRECARGA) {
        decoding += 1
        return Promise.resolve()
      }

      return new Promise((resolve) => {
        const entrada = {
          prioridad,
          activar: () => {
          decoding += 1
          resolve()
          },
        }
        if (!prioridad) {
          decodeQueue.push(entrada)
          return
        }
        const primeraNormal = decodeQueue.findIndex((item) => !item.prioridad)
        if (primeraNormal === -1) decodeQueue.push(entrada)
        else decodeQueue.splice(primeraNormal, 0, entrada)
      })
    }

    const liberarSlotDecodificacion = () => {
      decoding = Math.max(decoding - 1, 0)
      decodeQueue.shift()?.activar()
    }

    const cargarFrame = (indice, prioridad = false) => {
      const indiceSeguro = limitar(indice, 0, frames.length - 1)
      const existente = tocarCache(indiceSeguro)
      if (existente) return Promise.resolve(existente)
      if (pendientes.has(indiceSeguro)) return pendientes.get(indiceSeguro)

      const promesa = (async () => {
        await adquirirSlotDecodificacion(prioridad)
        if (!vivo) {
          liberarSlotDecodificacion()
          return null
        }
        const imagen = new Image()
        imagen.decoding = 'async'
        let objectUrl
        try {
          const stored = 'caches' in window
            ? await (await caches.open(CACHE_NAME)).match(frames[indiceSeguro])
            : null
          if (!vivo) return null
          if (stored) {
            objectUrl = URL.createObjectURL(await stored.blob())
            objectUrls.add(objectUrl)
          }
          imagen.src = objectUrl ?? frames[indiceSeguro]
          await imagen.decode()
          if (!vivo) return null
          cache.set(indiceSeguro, imagen)
          reducirCache()
          return imagen
        } finally {
          liberarSlotDecodificacion()
          pendientes.delete(indiceSeguro)
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl)
            objectUrls.delete(objectUrl)
          }
        }
      })()

      pendientes.set(indiceSeguro, promesa)
      return promesa
    }

    const buscarCercano = (indice) => {
      let mejor = null
      let posicionMejor = null
      let distanciaMejor = Number.POSITIVE_INFINITY
      cache.forEach((imagen, posicion) => {
        const distancia = Math.abs(posicion - indice)
        if (distancia < distanciaMejor) {
          mejor = imagen
          posicionMejor = posicion
          distanciaMejor = distancia
        }
      })
      return mejor ? { imagen: mejor, posicion: posicionMejor } : null
    }

    const precargarEntorno = (indice) => {
      for (let distancia = 1; distancia <= RADIO_PRECARGA; distancia += 1) {
        if (pendientes.size >= CONCURRENCIA_PRECARGA) break
        cargarFrame(indice + distancia).catch(() => {})
        cargarFrame(indice - distancia).catch(() => {})
      }
    }

    const mostrarFrame = (indice) => {
      const indiceSeguro = limitar(Math.round(indice), 0, frames.length - 1)
      frameSolicitadoRef.current = indiceSeguro
      canvas.dataset.frame = String(indiceSeguro + 1)

      const disponible = tocarCache(indiceSeguro)
      if (disponible) dibujarImagen(disponible, indiceSeguro)
      else {
        const cercano = buscarCercano(indiceSeguro)
        if (cercano) dibujarImagen(cercano.imagen, cercano.posicion)
        cargarFrame(indiceSeguro, true)
          .then((imagen) => {
            if (vivo && frameSolicitadoRef.current === indiceSeguro) {
              dibujarImagen(imagen, indiceSeguro)
            }
          })
          .catch(() => {})
      }

      if (ready) precargarEntorno(indiceSeguro)
    }

    const ajustarCanvas = () => {
      const limites = canvas.getBoundingClientRect()
      const densidad = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(Math.round(limites.width * densidad), 1)
      canvas.height = Math.max(Math.round(limites.height * densidad), 1)
      const imagen = tocarCache(frameSolicitadoRef.current)
      if (imagen) dibujarImagen(imagen, frameSolicitadoRef.current)
    }

    const actualizar = (progreso) => {
      if (!ready) return
      const progresoSeguro = limitar(progreso, 0, 1)
      const posicionGlobal = progresoSeguro * totalClips
      const indiceClip = Math.min(Math.floor(posicionGlobal), totalClips - 1)
      const clip = clips[indiceClip]
      const progresoClip = indiceClip === totalClips - 1 && progresoSeguro === 1
        ? 1
        : posicionGlobal - indiceClip
      const indiceFrame = clip.inicio + Math.round(progresoClip * (clip.cantidad - 1))

      canvas.dataset.clip = String(indiceClip + 1)
      canvas.dataset.clipFrame = String(indiceFrame - clip.inicio + 1)

      mostrarFrame(indiceFrame)

      const union = Math.round(posicionGlobal)
      const unionInterna = union > 0 && union < totalClips
      const distancia = unionInterna ? posicionGlobal - union : Number.POSITIVE_INFINITY
      const anchoBarrido = .085

      if (Math.abs(distancia) <= anchoBarrido) {
        const fase = distancia / anchoBarrido
        const izquierda = fase <= 0 ? 0 : fase * 100
        const derecha = fase <= 0 ? -fase * 100 : 0
        transicion.dataset.transition = String(union)
        gsap.set(transicion, {
          autoAlpha: 1,
          clipPath: `inset(0 ${derecha}% 0 ${izquierda}%)`,
          '--transition-word-x': `${fase * 7}%`,
        })
      } else {
        gsap.set(transicion, { autoAlpha: 0 })
      }

      notificarEscena(Math.min(
        Math.round(progresoSeguro * (totalEscenas - 1)),
        totalEscenas - 1,
      ))
      callbackProgresoRef.current?.(progresoSeguro)
    }

    ajustarCanvas()
    window.addEventListener('resize', ajustarCanvas, { passive: true })

    const almacenarSecuenciaEnSegundoPlano = () => {
      if (!vivo) return
      storeSequence(clips, frames).catch(() => {
        if (vivo) retryTimer = setTimeout(almacenarSecuenciaEnSegundoPlano, 8000)
      })
    }

    const prepare = async () => {
      const inicioPreparacion = performance.now()
      try {
        const complete = await isInitialSequenceCached(clips, frames)
        if (!vivo) return

        if (!complete) {
          setMostrarCarga(true)
          // Cache Storage recibe primero el clip 1 completo; los demás esperan.
          storageTimer = setTimeout(almacenarSecuenciaEnSegundoPlano, 50)
        }

        const indicesCriticos = Array.from(
          { length: Math.min(FRAMES_INICIO_CRITICOS, clips[0]?.cantidad ?? 0) },
          (_, indice) => indice,
        )
        const primerFrame = cargarFrame(0, true)
        const bufferCritico = Promise.allSettled(
          indicesCriticos.map((indice) => cargarFrame(indice, true)),
        )

        if (!complete) {
          const esperaRestante = Math.max(
            MAX_ESPERA_INICIAL_MS - (performance.now() - inicioPreparacion),
            0,
          )
          await Promise.race([
            bufferCritico,
            new Promise((resolve) => { revealTimer = setTimeout(resolve, esperaRestante) }),
          ])
          clearTimeout(revealTimer)
        } else {
          await primerFrame
        }

        if (!vivo) return
        const first = tocarCache(0)
        if (first) dibujarImagen(first, 0)
        else {
          primerFrame.then((imagen) => {
            if (vivo && frameSolicitadoRef.current === 0 && imagen) dibujarImagen(imagen, 0)
          }).catch(() => {})
        }
        frameSolicitadoRef.current = 0
        canvas.dataset.frame = '1'
        ready = true
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) mostrarFrame(frames.length - 1)
        setListo(true)
        precargarEntorno(0)
        ScrollTrigger.refresh()
      } catch (error) {
        if (!vivo) return
        console.error('No se pudo preparar el primer fotograma.', error)
        ready = true
        setListo(true)
        storageTimer = setTimeout(almacenarSecuenciaEnSegundoPlano, 500)
        ScrollTrigger.refresh()
      }
    }
    void prepare()

    const release = () => {
      vivo = false
      clearTimeout(retryTimer)
      clearTimeout(storageTimer)
      clearTimeout(revealTimer)
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
      cache.clear()
      pendientes.clear()
      decodeQueue.splice(0).forEach(({ activar }) => activar())
    }

    const movimientoReducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (movimientoReducido) {
      const ultimoIndice = frames.length - 1
      mostrarFrame(ultimoIndice)
      notificarEscena(totalEscenas - 1)
      callbackProgresoRef.current?.(1)

      return () => {
        release()
        window.removeEventListener('resize', ajustarCanvas)
        cache.forEach((imagen) => { imagen.src = '' })
        cache.clear()
      }
    }

    if (modo === 'mouse') {
      const alMover = (evento) => {
        const limites = contenedor.getBoundingClientRect()
        actualizar((evento.clientX - limites.left) / limites.width)
      }
      contenedor.addEventListener('pointermove', alMover, { passive: true })

      return () => {
        release()
        contenedor.removeEventListener('pointermove', alMover)
        window.removeEventListener('resize', ajustarCanvas)
        cache.forEach((imagen) => { imagen.src = '' })
        cache.clear()
      }
    }

    let progresoObjetivo = 0
    let progresoVisible = 0
    let animacionFrame = 0

    const animarHaciaObjetivo = () => {
      const distancia = progresoObjetivo - progresoVisible
      if (Math.abs(distancia) < .00012) {
        progresoVisible = progresoObjetivo
        actualizar(progresoVisible)
        animacionFrame = 0
        return
      }

      progresoVisible += distancia * .34
      actualizar(progresoVisible)
      animacionFrame = window.requestAnimationFrame(animarHaciaObjetivo)
    }

    const sincronizarScroll = (progreso, inmediato = false) => {
      progresoObjetivo = limitar(progreso, 0, 1)
      const esExtremo = progresoObjetivo === 0 || progresoObjetivo === 1

      if (inmediato || esExtremo) {
        if (animacionFrame) window.cancelAnimationFrame(animacionFrame)
        animacionFrame = 0
        progresoVisible = progresoObjetivo
        actualizar(progresoVisible)
        return
      }

      if (!animacionFrame) {
        animacionFrame = window.requestAnimationFrame(animarHaciaObjetivo)
      }
    }

    const contextoGsap = gsap.context(() => {
      ScrollTrigger.create({
        trigger: contenedor,
        start: 'top top',
        end: 'bottom bottom',
        invalidateOnRefresh: true,
        onUpdate: (instancia) => sincronizarScroll(instancia.progress),
        onRefresh: (instancia) => sincronizarScroll(instancia.progress, true),
        onLeave: () => sincronizarScroll(1, true),
        onEnterBack: (instancia) => sincronizarScroll(instancia.progress),
        onLeaveBack: () => sincronizarScroll(0, true),
      })
    }, contenedor)

    return () => {
      release()
      if (animacionFrame) window.cancelAnimationFrame(animacionFrame)
      window.removeEventListener('resize', ajustarCanvas)
      contextoGsap.revert()
      cache.forEach((imagen) => { imagen.src = '' })
      cache.clear()
      pendientes.clear()
    }
  }, [clips, frames, modo, notificarEscena, totalClips, totalEscenas])

  return (
    <div
      ref={contenedorRef}
      className={`image-sequence image-sequence--${modo === 'mouse' ? 'mouse' : 'scroll'}`}
      style={{ '--sequence-height': `${alto}vh` }}
    >
      <div className="image-sequence__sticky">
        <canvas
          ref={canvasRef}
          className="image-sequence__canvas"
          role="img"
          aria-label="Mascota Joker animada fotograma por fotograma con el desplazamiento"
        />

        <div ref={transicionRef} className="image-sequence__transition" aria-hidden="true">
          <span>JOKER</span>
        </div>

        {mostrarCarga && <SequenceLoader ready={listo} onComplete={ocultarCarga} />}

        {children}
      </div>
    </div>
  )
})

export default ImageSequenceViewer
