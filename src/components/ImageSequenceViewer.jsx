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
import { SequenceFrameStore } from '../services/sequenceFrameStore'

const CONSULTA_MOVIL = '(max-width: 900px) and (max-aspect-ratio: 3/4)'

function limitar(valor, minimo, maximo) {
  return Math.min(Math.max(valor, minimo), maximo)
}

function rutaFrame(ruta, numero, digitos = 3, extension = 'png') {
  return `${ruta}/frame-${String(numero).padStart(digitos, '0')}.${extension}`
}

const ImageSequenceViewer = forwardRef(function ImageSequenceViewer(
  {
    secuencias = [],
    modo = 'scroll',
    alturaScroll,
    onSceneChange,
    onProgress,
    children,
  },
  ref,
) {
  const contenedorRef = useRef(null)
  const canvasRef = useRef(null)
  const flashRef = useRef(null)
  const frameSolicitadoRef = useRef(0)
  const escenaRef = useRef(0)
  const callbackEscenaRef = useRef(onSceneChange)
  const callbackProgresoRef = useRef(onProgress)
  const [listo, setListo] = useState(false)
  const [preparados, setPreparados] = useState(0)
  const [errorCarga, setErrorCarga] = useState(false)
  const [usarFramesMoviles, setUsarFramesMoviles] = useState(() => window.matchMedia(CONSULTA_MOVIL).matches)

  useEffect(() => {
    const consulta = window.matchMedia(CONSULTA_MOVIL)
    const actualizarVariante = () => setUsarFramesMoviles(consulta.matches)
    consulta.addEventListener('change', actualizarVariante)
    return () => consulta.removeEventListener('change', actualizarVariante)
  }, [])

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
        usarFramesMoviles ? (clip.rutaMovil ?? clip.ruta) : clip.ruta,
        indice + 1, clip.digitos ?? 3, clip.extension ?? 'png',
      ),
    )
  )), [clips, usarFramesMoviles])

  const totalClips = clips.length
  const alto = alturaScroll ?? Math.max(totalClips * 360 + 100, 460)
  const movimientoReducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const totalPreparacion = movimientoReducido ? 1 : frames.length

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
    const flash = flashRef.current
    if (!contenedor || !canvas || !flash || !frames.length || !clips.length) return undefined

    let vivo = true
    let listoParaDibujar = false
    let progresoActual = 0
    let ultimoDibujado = -1
    let dibujoPendiente = 0
    const almacen = new SequenceFrameStore(frames)
    const contextoCanvas = canvas.getContext('2d', { alpha: false })

    setListo(false)
    setPreparados(0)
    setErrorCarga(false)

    const dibujarImagen = (imagen) => {
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
    }

    const dibujarSolicitado = () => {
      dibujoPendiente = 0
      const indice = frameSolicitadoRef.current
      const imagen = almacen.images.get(indice)
      if (!vivo || !imagen || indice === ultimoDibujado) return
      canvas.dataset.drawnFrame = String(indice + 1)
      dibujarImagen(imagen)
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
      if (!listoParaDibujar) return
      programarDibujo()
      if (anterior === indiceSeguro && almacen.images.has(indiceSeguro)) return
      almacen.prepare(indiceSeguro).then(programarDibujo).catch(() => {
        if (vivo) setErrorCarga(true)
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

      mostrarFrame(indiceFrame)
      if (!listoParaDibujar) return

      const unionCercana = Math.round(posicionGlobal)
      const esUnionInterna = unionCercana > 0 && unionCercana < totalClips
      const distanciaUnion = esUnionInterna
        ? Math.abs(posicionGlobal - unionCercana)
        : Number.POSITIVE_INFINITY
      const anchoUnion = .075
      const cobertura = limitar(1 - distanciaUnion / anchoUnion, 0, 1)

      if (cobertura > 0) {
        const lado = posicionGlobal < unionCercana ? -1 : 1
        gsap.set(flash, {
          autoAlpha: 1,
          xPercent: lado * (1 - cobertura) * 118,
          scaleX: 1.18 + cobertura * .08,
          scaleY: 1.08,
          rotate: lado * (1 - cobertura) * 2,
        })
      } else {
        gsap.set(flash, { autoAlpha: 0 })
      }

      notificarEscena(Math.min(Math.round(posicionGlobal), totalClips))
      callbackProgresoRef.current?.(progresoSeguro)
    }

    ajustarCanvas()
    window.addEventListener('resize', ajustarCanvas, { passive: true })

    const cargar = async () => {
      try {
        await almacen.preload((cantidad) => {
          if (vivo) setPreparados(cantidad)
        }, movimientoReducido ? [frames.length - 1] : undefined)
        // The visitor may have scrolled while the initial overlay was visible.
        // Prepare the current destination before exposing the animation.
        do {
          const destino = frameSolicitadoRef.current
          await almacen.prepare(destino)
          if (destino === frameSolicitadoRef.current) break
        } while (vivo)
        if (!vivo) return
        listoParaDibujar = true
        actualizar(movimientoReducido ? 1 : progresoActual)
        dibujarSolicitado()
        setListo(true)
      } catch (error) {
        if (!vivo) return
        console.error('No se pudo preparar la secuencia', error)
        almacen.dispose()
        setErrorCarga(true)
      }
    }

    if (movimientoReducido) {
      const ultimoIndice = frames.length - 1
      frameSolicitadoRef.current = ultimoIndice
      cargar()

      return () => {
        vivo = false
        window.removeEventListener('resize', ajustarCanvas)
        cancelAnimationFrame(dibujoPendiente)
        almacen.dispose()
      }
    }

    if (modo === 'mouse') {
      cargar()
      const alMover = (evento) => {
        const limites = contenedor.getBoundingClientRect()
        actualizar((evento.clientX - limites.left) / limites.width)
      }
      contenedor.addEventListener('pointermove', alMover, { passive: true })

      return () => {
        vivo = false
        contenedor.removeEventListener('pointermove', alMover)
        window.removeEventListener('resize', ajustarCanvas)
        cancelAnimationFrame(dibujoPendiente)
        almacen.dispose()
      }
    }

    const contextoGsap = gsap.context(() => {
      const cabezal = { progreso: 0 }
      gsap.to(cabezal, {
        progreso: 1,
        ease: 'none',
        onUpdate: () => actualizar(cabezal.progreso),
        scrollTrigger: {
          trigger: contenedor,
          start: 'top top',
          end: 'bottom bottom',
          scrub: .42,
          invalidateOnRefresh: true,
          onRefresh: (instancia) => actualizar(instancia.progress),
        },
      })
    }, contenedor)
    cargar()

    return () => {
      vivo = false
      window.removeEventListener('resize', ajustarCanvas)
      contextoGsap.revert()
      cancelAnimationFrame(dibujoPendiente)
      almacen.dispose()
    }
  }, [clips, frames, modo, movimientoReducido, notificarEscena, totalClips])

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

        <div ref={flashRef} className="image-sequence__spray-flash" aria-hidden="true" />

        {(!listo || errorCarga) && (
          <div className="image-sequence__loading" role="status" aria-live="polite">
            <strong>JOKER</strong>
            <div className="image-sequence__loading-track" aria-hidden="true">
              <span
                style={{
                  transform: `scaleX(${totalPreparacion ? preparados / totalPreparacion : 0})`,
                }}
              />
            </div>
            <span>{errorCarga ? 'No pudimos cargar la animación.' : `Preparando animación ${Math.round(preparados / totalPreparacion * 100) || 0}%`}</span>
            {errorCarga && <button type="button" onClick={() => window.location.reload()}>Reintentar</button>}
          </div>
        )}

        {children}
      </div>
    </div>
  )
})

export default ImageSequenceViewer
