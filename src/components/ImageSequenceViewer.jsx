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

const LIMITE_CACHE = 72
const RADIO_PRECARGA = 24

function limitar(valor, minimo, maximo) {
  return Math.min(Math.max(valor, minimo), maximo)
}

function rutaFrame(ruta, numero, digitos = 3) {
  return `${ruta}/frame-${String(numero).padStart(digitos, '0')}.png`
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
      (_, indice) => rutaFrame(clip.ruta, indice + 1, clip.digitos ?? 3),
    )
  )), [clips])

  const totalClips = clips.length
  const alto = alturaScroll ?? Math.max(totalClips * 360 + 100, 460)
  const cantidadCalentamiento = Math.min(16, frames.length)

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
    const cache = new Map()
    const pendientes = new Map()
    const contextoCanvas = canvas.getContext('2d', { alpha: false })

    setListo(false)
    setPreparados(0)

    const dibujarImagen = (imagen) => {
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
        if (indiceAntiguo === frameSolicitadoRef.current) {
          const protegido = cache.get(indiceAntiguo)
          cache.delete(indiceAntiguo)
          cache.set(indiceAntiguo, protegido)
          continue
        }
        const imagen = cache.get(indiceAntiguo)
        cache.delete(indiceAntiguo)
        imagen.src = ''
      }
    }

    const cargarFrame = (indice) => {
      const indiceSeguro = limitar(indice, 0, frames.length - 1)
      const existente = tocarCache(indiceSeguro)
      if (existente) return Promise.resolve(existente)
      if (pendientes.has(indiceSeguro)) return pendientes.get(indiceSeguro)

      const promesa = new Promise((resolver, rechazar) => {
        const imagen = new Image()
        imagen.decoding = 'async'
        imagen.onload = () => {
          if (!vivo) return
          pendientes.delete(indiceSeguro)
          cache.set(indiceSeguro, imagen)
          reducirCache()
          resolver(imagen)
        }
        imagen.onerror = () => {
          pendientes.delete(indiceSeguro)
          rechazar(new Error(`No se pudo cargar ${frames[indiceSeguro]}`))
        }
        imagen.src = frames[indiceSeguro]
      })

      pendientes.set(indiceSeguro, promesa)
      return promesa
    }

    const buscarCercano = (indice) => {
      let mejor = null
      let distanciaMejor = Number.POSITIVE_INFINITY
      cache.forEach((imagen, posicion) => {
        const distancia = Math.abs(posicion - indice)
        if (distancia < distanciaMejor) {
          mejor = imagen
          distanciaMejor = distancia
        }
      })
      return mejor
    }

    const precargarEntorno = (indice) => {
      for (let distancia = 1; distancia <= RADIO_PRECARGA; distancia += 1) {
        cargarFrame(indice + distancia).catch(() => {})
        cargarFrame(indice - distancia).catch(() => {})
      }
    }

    const mostrarFrame = (indice) => {
      const indiceSeguro = limitar(Math.round(indice), 0, frames.length - 1)
      frameSolicitadoRef.current = indiceSeguro
      canvas.dataset.frame = String(indiceSeguro + 1)

      const disponible = tocarCache(indiceSeguro)
      if (disponible) dibujarImagen(disponible)
      else {
        const cercano = buscarCercano(indiceSeguro)
        if (cercano) dibujarImagen(cercano)
        cargarFrame(indiceSeguro)
          .then((imagen) => {
            if (vivo && frameSolicitadoRef.current === indiceSeguro) dibujarImagen(imagen)
          })
          .catch(() => {})
      }

      precargarEntorno(indiceSeguro)
    }

    const ajustarCanvas = () => {
      const limites = canvas.getBoundingClientRect()
      const densidad = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.max(Math.round(limites.width * densidad), 1)
      canvas.height = Math.max(Math.round(limites.height * densidad), 1)
      const imagen = tocarCache(frameSolicitadoRef.current)
      if (imagen) dibujarImagen(imagen)
    }

    const actualizar = (progreso) => {
      const progresoSeguro = limitar(progreso, 0, 1)
      const posicionGlobal = progresoSeguro * totalClips
      const indiceClip = Math.min(Math.floor(posicionGlobal), totalClips - 1)
      const clip = clips[indiceClip]
      const progresoClip = indiceClip === totalClips - 1 && progresoSeguro === 1
        ? 1
        : posicionGlobal - indiceClip
      const indiceFrame = clip.inicio + Math.round(progresoClip * (clip.cantidad - 1))

      mostrarFrame(indiceFrame)

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

    const esenciales = [
      ...Array.from({ length: cantidadCalentamiento }, (_, indice) => indice),
      ...clips.map((clip) => clip.inicio),
    ]
    const esencialesUnicos = [...new Set(esenciales)]
    cargarFrame(0).then((imagen) => dibujarImagen(imagen)).catch(() => {})
    Promise.all(esencialesUnicos.map((indice) => (
      cargarFrame(indice)
        .then(() => setPreparados((valor) => valor + 1))
        .catch(() => setPreparados((valor) => valor + 1))
    ))).then(() => {
      if (vivo) setListo(true)
    })

    const movimientoReducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (movimientoReducido) {
      const ultimoIndice = frames.length - 1
      mostrarFrame(ultimoIndice)
      notificarEscena(totalClips)
      callbackProgresoRef.current?.(1)

      return () => {
        vivo = false
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
        vivo = false
        contenedor.removeEventListener('pointermove', alMover)
        window.removeEventListener('resize', ajustarCanvas)
        cache.forEach((imagen) => { imagen.src = '' })
        cache.clear()
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

    return () => {
      vivo = false
      window.removeEventListener('resize', ajustarCanvas)
      contextoGsap.revert()
      cache.forEach((imagen) => { imagen.src = '' })
      cache.clear()
      pendientes.clear()
    }
  }, [cantidadCalentamiento, clips, frames, modo, notificarEscena, totalClips])

  const totalPreparacion = Math.min(cantidadCalentamiento + Math.max(totalClips - 1, 0), frames.length)

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

        {!listo && (
          <div className="image-sequence__loading" role="status" aria-live="polite">
            <strong>JOKER</strong>
            <div className="image-sequence__loading-track" aria-hidden="true">
              <span
                style={{
                  transform: `scaleX(${totalPreparacion ? preparados / totalPreparacion : 0})`,
                }}
              />
            </div>
            <span>Preparando fotogramas {Math.min(preparados, totalPreparacion)}/{totalPreparacion}</span>
          </div>
        )}

        {children}
      </div>
    </div>
  )
})

export default ImageSequenceViewer
