import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import ImageSequenceViewer from './ImageSequenceViewer'

const secuenciasMascota = [
  { ruta: '/secuencias/joker/clip-01', cantidad: 480 },
  { ruta: '/secuencias/joker/clip-02', cantidad: 480 },
  { ruta: '/secuencias/joker/clip-03', cantidad: 480 },
]

const mensajes = [
  {
    numero: '01',
    etiqueta: 'Joker Publicidad',
    lineas: ['Una pared', 'nunca está vacía.'],
    acento: 'Dale scroll. Él se encarga del resto.',
  },
  {
    numero: '02',
    etiqueta: 'Letreros que detienen miradas',
    lineas: ['Tu marca', 'entra en escena.'],
    acento: 'Volumen. Luz. Presencia.',
  },
  {
    numero: '03',
    etiqueta: 'Neón · Vinilo · Gran formato',
    lineas: ['La calle', 'se vuelve tuya.'],
    acento: 'Diseñamos para que te recuerden.',
  },
  {
    numero: '04',
    etiqueta: 'Impresión y diseño',
    lineas: ['Hazte', 'imposible', 'de ignorar.'],
    acento: 'Hacemos visible tu marca.',
  },
]

function HeroPresentacion() {
  const raizRef = useRef(null)
  const progresoRef = useRef(null)
  const pistaRef = useRef(null)
  const mensajesRef = useRef([])
  const [escena, setEscena] = useState(0)

  const cambiarEscena = useCallback((siguiente) => {
    setEscena(siguiente)
  }, [])

  const actualizarProgreso = useCallback((progreso) => {
    if (!progresoRef.current) return
    gsap.set(progresoRef.current, { scaleX: progreso })
  }, [])

  useLayoutEffect(() => {
    const paneles = mensajesRef.current.filter(Boolean)
    const activo = paneles[escena]
    const inactivos = paneles.filter((_, indice) => indice !== escena)

    const contexto = gsap.context(() => {
      gsap.killTweensOf(paneles)
      gsap.to(inactivos, {
        autoAlpha: 0,
        y: -34,
        filter: 'blur(8px)',
        duration: .3,
        ease: 'power2.in',
        overwrite: true,
      })
      gsap.fromTo(
        activo,
        { autoAlpha: 0, y: 58, filter: 'blur(12px)' },
        {
          autoAlpha: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: .68,
          delay: .08,
          ease: 'power3.out',
          overwrite: true,
        },
      )
      gsap.to(pistaRef.current, {
        autoAlpha: escena === 0 ? 1 : escena === secuenciasMascota.length ? .75 : .28,
        duration: .35,
      })
    }, raizRef)

    return () => contexto.revert()
  }, [escena])

  return (
    <section ref={raizRef} className="hero-presentacion" aria-labelledby="hero-titulo">
      <h1 id="hero-titulo" className="visually-hidden">
        Joker Publicidad: hacemos visible tu marca
      </h1>

      <ImageSequenceViewer
        secuencias={secuenciasMascota}
        modo="scroll"
        onSceneChange={cambiarEscena}
        onProgress={actualizarProgreso}
      >
        <div className="hero-presentacion__veil" aria-hidden="true" />
        <div className="hero-presentacion__grain" aria-hidden="true" />

        <div className="hero-presentacion__signature" aria-hidden="true">
          <span>Estudio creativo</span>
          <strong>JOKER®</strong>
        </div>

        <div className="hero-presentacion__scene-count" aria-hidden="true">
          <strong>{String(escena + 1).padStart(2, '0')}</strong>
          <span>/ {String(mensajes.length).padStart(2, '0')}</span>
        </div>

        <div className="hero-presentacion__copy-deck" aria-live="polite">
          {mensajes.map((mensaje, indice) => (
            <article
              key={mensaje.numero}
              ref={(elemento) => { mensajesRef.current[indice] = elemento }}
              className={`hero-presentacion__copy hero-presentacion__copy--${indice + 1}`}
              aria-hidden={escena !== indice}
            >
              <p>
                <span>{mensaje.numero}</span>
                {mensaje.etiqueta}
              </p>
              <h2>
                {mensaje.lineas.map((linea) => <span key={linea}>{linea}</span>)}
              </h2>
              <small>{mensaje.acento}</small>

              {indice === mensajes.length - 1 && (
                <Link className="hero-presentacion__action" to="/contacto">
                  Cuéntanos tu idea <b aria-hidden="true">↗</b>
                </Link>
              )}
            </article>
          ))}
        </div>

        <div ref={pistaRef} className="hero-presentacion__scroll-hint" aria-hidden="true">
          <span />
          {escena === secuenciasMascota.length
            ? 'Sigue para descubrir'
            : '↓ Avanza · ↑ Retrocede'}
        </div>

        <div className="hero-presentacion__services" aria-hidden="true">
          <span>Letreros 3D</span>
          <span>Neón</span>
          <span>Vinilos</span>
          <span>Impresión</span>
        </div>

        <div className="hero-presentacion__progress" aria-hidden="true">
          <span ref={progresoRef} />
        </div>
      </ImageSequenceViewer>
    </section>
  )
}

export default HeroPresentacion
