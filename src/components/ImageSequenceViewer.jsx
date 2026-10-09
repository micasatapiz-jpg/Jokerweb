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
import { SequenceFrameStore } from '../services/sequenceFrameStore'
import { areFramePacksCached } from '../utils/framePacks'

const CONSULTA_MOVIL = '(max-width: 900px) and (max-aspect-ratio: 3/4)'

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
    framePacks,
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
  const [preparados, setPreparados] = useState(0)
  const [errorCarga, setErrorCarga] = useState(false)
  const [warmStart, setWarmStart] = useState(false)
  const [usarFramesMoviles, setUsarFramesMoviles] = useState(() => window.matchMedia(CONSULTA_MOVIL).matches)
  const paquetes = framePacks?.[usarFramesMoviles ? 'mobile' : 'desktop']

  useEffect(() => {
    const consulta = window.matchMedia(CONSULTA_MOVIL)
    const actualizarVariante = () => setUsarFramesMoviles(consulta.matches)
    consulta.addEventListener('change', actualizarVariante)
    return () => consulta.removeEventListener('change', actualizarVariante)
  }, [])
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
    const almacen = new SequenceFrameStore(frames)
    const contextoCanvas = canvas.getContext('2d', { alpha: false })
    let ready = false
    let progresoActual = 0
    let ultimoDibujado = -1
    let dibujoPendiente = 0
    const movimientoReducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    setListo(false)
    setMostrarCarga(true)
    setPreparados(0)
    setErrorCarga(false)
    setWarmStart(false)

    const dibujarImagen = (imagen, indiceDibujado) => {
      const anchoOriginal = imagen?.naturalWidth ?? imagen?.width
      const altoOriginal = imagen?.naturalHeight ?? imagen?.height
      if (!anchoOriginal || !canvas.width || !canvas.height) return

      const ancho = canvas.width
      const altoCanvas = canvas.height
      const escala = Math.max(ancho / anchoOriginal, altoCanvas / altoOriginal)
      const anchoImagen = anchoOriginal * escala
      const altoImagen = altoOriginal * escala
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

    const dibujarSolicitado = () => {
      dibujoPendiente = 0
      const indice = frameSolicitadoRef.current
      const imagen = almacen.images.get(indice)
      if (!vivo || !imagen || indice === ultimoDibujado) return
      dibujarImagen(imagen, indice)
      ultimoDibujado = indice
    }

    const programarDibujo = () => {
      if (!dibujoPendiente && vivo) dibujoPendiente = requestAnimationFrame(dibujarSolicitado)
    }

    const mostrarFrame = (indice) => {
      const indiceSeguro = limitar(Math.round(indice), 0, frames.length - 1)
      const anterior = frameSolicitadoRef.current
      frameSolicitadoRef.current = indiceSeguro
      canvas.dataset.frame = String(indiceSeguro + 1)
      if (!ready) return
      programarDibujo()
      if (anterior === indiceSeguro && almacen.images.has(indiceSeguro)) return
      almacen.prepare(indiceSeguro).then(programarDibujo).catch(() => {
        if (vivo) { setErrorCarga(true); setMostrarCarga(true) }
      })
    }

    const ajustarCanvas = () => {
      const limites = canvas.getBoundingClientRect()
      const densidad = Math.min(window.devicePixelRatio || 1, 1.5)
      const ancho = Math.max(Math.round(limites.width * densidad), 1)
      const altura = Math.max(Math.round(limites.height * densidad), 1)
      if (canvas.width === ancho && canvas.height === altura) return
      canvas.width = ancho
      canvas.height = altura
      ultimoDibujado = -1
      programarDibujo()
    }

    const actualizar = (progreso) => {
      const progresoSeguro = limitar(progreso, 0, 1)
      progresoActual = progresoSeguro
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
      if (!ready) return

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

    const prepare = async () => {
      try {
        const onProgress = (cantidad) => { if (vivo) setPreparados(cantidad) }
        if (movimientoReducido) {
          frameSolicitadoRef.current = frames.length - 1
          await almacen.preload(onProgress, [frames.length - 1])
        } else if (paquetes) {
          const cached = await areFramePacksCached(paquetes)
          if (!vivo) return
          setWarmStart(cached)
          await almacen.preloadPacked(paquetes, onProgress)
        } else {
          await almacen.preload(onProgress)
        }
        do {
          const destino = frameSolicitadoRef.current
          await almacen.prepare(destino)
          if (destino === frameSolicitadoRef.current) break
        } while (vivo)
        if (!vivo) return
        ready = true
        actualizar(movimientoReducido ? 1 : progresoActual)
        dibujarSolicitado()
        setListo(true)
        ScrollTrigger.refresh()
      } catch (error) {
        if (!vivo) return
        console.error('No se pudo preparar la animación.', error)
        almacen.dispose()
        setErrorCarga(true)
      }
    }
    void prepare()

    const release = () => {
      vivo = false
      cancelAnimationFrame(dibujoPendiente)
      almacen.dispose()
    }

    if (movimientoReducido) {
      const ultimoIndice = frames.length - 1
      mostrarFrame(ultimoIndice)
      notificarEscena(totalEscenas - 1)
      callbackProgresoRef.current?.(1)

      return () => {
        release()
        window.removeEventListener('resize', ajustarCanvas)
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
    }
  }, [clips, frames, modo, notificarEscena, paquetes, totalClips, totalEscenas])

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

        {mostrarCarga && (
          <SequenceLoader
            ready={listo && !errorCarga}
            progress={preparados / (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : frames.length)}
            error={errorCarga}
            minDurationMs={warmStart ? 0 : 3000}
            onRetry={() => window.location.reload()}
            onComplete={ocultarCarga}
          />
        )}

        {children}
      </div>
    </div>
  )
})

export default ImageSequenceViewer
