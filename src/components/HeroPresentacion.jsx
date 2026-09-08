import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import backgroundScroll from '../assets/home/background-scroll-illustrated.png'
import { serviceFamilies, siteConfig } from '../config/siteConfig'
import ImageSequenceViewer from './ImageSequenceViewer'
import WhatsAppButton from './WhatsAppButton'

const secuenciasMascota = [
  { ruta: '/secuencias/joker/clip-01', cantidad: 480, extension: 'webp', version: 'hq-3' },
  { ruta: '/secuencias/joker/clip-02', cantidad: 192, extension: 'webp', version: 'webp-lossless-3' },
  { ruta: '/secuencias/joker/clip-03', cantidad: 192, extension: 'webp', version: 'webp-lossless-3' },
]

const processSteps = [
  ['01', 'Pensamos'],
  ['02', 'Diseñamos'],
  ['03', 'Producimos'],
  ['04', 'Instalamos'],
]

const faqs = [
  ['¿Necesito diseño?', 'No. Basta una idea o referencia.'],
  ['¿Instalan?', 'Sí, según el proyecto.'],
  ['¿Cómo cotizo?', 'Envíanos foto y medidas.'],
]

const PANEL_COUNT = 7

function HeroHeading({ as: Tag = 'h2', id, lines, className = '' }) {
  return (
    <Tag id={id} className={`hero-unified__headline ${className}`.trim()}>
      {lines.map((line, index) => (
        <span
          key={line}
          className={index % 2 === 0 ? '' : 'hero-unified__headline-accent'}
        >
          {line}
        </span>
      ))}
    </Tag>
  )
}

function HeroPresentacion() {
  const raizRef = useRef(null)
  const fondoRef = useRef(null)
  const progresoRef = useRef(null)
  const panelesRef = useRef([])
  const [escena, setEscena] = useState(0)

  const actualizarProgreso = useCallback((progreso) => {
    if (progresoRef.current) gsap.set(progresoRef.current, { scaleX: progreso })
    if (fondoRef.current) {
      gsap.set(fondoRef.current, {
        yPercent: -44 * progreso,
        scale: 1.04 + progreso * .035,
      })
    }
  }, [])

  useLayoutEffect(() => {
    const paneles = panelesRef.current.filter(Boolean)
    const activo = paneles[escena]
    const inactivos = paneles.filter((_, index) => index !== escena)

    const contexto = gsap.context(() => {
      gsap.killTweensOf(paneles)
      gsap.to(inactivos, {
        autoAlpha: 0,
        y: -28,
        filter: 'blur(7px)',
        duration: .24,
        overwrite: true,
      })
      gsap.fromTo(activo, {
        autoAlpha: 0,
        y: 42,
        filter: 'blur(9px)',
      }, {
        autoAlpha: 1,
        y: 0,
        filter: 'blur(0px)',
        duration: .58,
        ease: 'power3.out',
        overwrite: true,
      })
    }, raizRef)

    return () => contexto.revert()
  }, [escena])

  return (
    <section ref={raizRef} className="hero-presentacion hero-presentacion--unified" aria-labelledby="hero-title">
      <ImageSequenceViewer
        secuencias={secuenciasMascota}
        modo="scroll"
        alturaScroll={1500}
        sceneCount={PANEL_COUNT}
        onSceneChange={setEscena}
        onProgress={actualizarProgreso}
      >
        <div className="hero-unified__background" aria-hidden="true">
          <img ref={fondoRef} src={backgroundScroll} alt="" />
        </div>
        <div className="hero-unified__shade" aria-hidden="true" />

        <div className="hero-unified__deck" aria-live="polite">
          <article ref={(element) => { panelesRef.current[0] = element }} className="hero-unified__panel hero-unified__panel--intro" aria-hidden={escena !== 0}>
            <p>Letreros · Impresión · Viniles · Instalación</p>
            <HeroHeading as="h1" id="hero-title" lines={['HACEMOS VISIBLE', 'TU MARCA.']} className="hero-unified__headline--intro" />
            <div className="hero-unified__actions">
              <WhatsAppButton servicio="general" origen="home-unified" texto="Cotizar por WhatsApp" />
              <Link to="/catalogo">Ver servicios ↗</Link>
            </div>
          </article>

          <article ref={(element) => { panelesRef.current[1] = element }} className="hero-unified__panel hero-unified__panel--services" aria-hidden={escena !== 1}>
            <p>Todo para tu marca</p>
            <HeroHeading lines={['SERVICIOS']} />
            <div className="hero-unified__service-grid">
              {serviceFamilies.map((service) => (
                <Link key={service.id} to={service.detailPath ?? `/catalogo#${service.id}`}>
                  <span>{service.number}</span>
                  <strong>{service.title}</strong>
                </Link>
              ))}
            </div>
          </article>

          <article ref={(element) => { panelesRef.current[2] = element }} className="hero-unified__panel hero-unified__panel--process" aria-hidden={escena !== 2}>
            <p>De la idea a la calle</p>
            <HeroHeading lines={['PROCESO']} />
            <div className="hero-unified__process-grid">
              {processSteps.map(([number, title]) => (
                <div key={number}>
                  <span>{number}</span>
                  <strong>{title}</strong>
                </div>
              ))}
            </div>
          </article>

          <article ref={(element) => { panelesRef.current[3] = element }} className="hero-unified__panel hero-unified__panel--business" aria-hidden={escena !== 3}>
            <p>Para negocios y equipos</p>
            <HeroHeading lines={['SOLUCIONES', 'PARA EMPRESAS']} />
            <div className="hero-unified__text-block">
              <span>Diseño · Producción · Instalación</span>
              <WhatsAppButton servicio="empresarial" origen="home-business" texto="Cotizar proyecto" />
            </div>
          </article>

          <article ref={(element) => { panelesRef.current[4] = element }} className="hero-unified__panel hero-unified__panel--about" aria-hidden={escena !== 4}>
            <p>Creatividad que se fabrica</p>
            <HeroHeading lines={['SOMOS JOKER']} />
            <div className="hero-unified__text-block">
              <small>Hacemos visible tu marca.</small>
              <Link to="/nosotros">Conocer a Joker ↗</Link>
            </div>
          </article>

          <article ref={(element) => { panelesRef.current[5] = element }} className="hero-unified__panel hero-unified__panel--faq" aria-hidden={escena !== 5}>
            <p>Respuestas rápidas</p>
            <HeroHeading lines={['PREGUNTAS', 'FRECUENTES']} />
            <div className="hero-unified__faq-grid">
              {faqs.map(([question, answer]) => (
                <div key={question}>
                  <strong>{question}</strong>
                  <small>{answer}</small>
                </div>
              ))}
            </div>
          </article>

          <article ref={(element) => { panelesRef.current[6] = element }} className="hero-unified__panel hero-unified__panel--contact" aria-hidden={escena !== 6}>
            <p>Lima + Huancayo</p>
            <HeroHeading lines={['CONTACTO']} />
            <div className="hero-unified__contact-data">
              <a href={`tel:${siteConfig.phoneNumber}`}>{siteConfig.phoneDisplay}</a>
              <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
              <span>Foto + medidas + idea.</span>
            </div>
            <WhatsAppButton servicio="especial" origen="home-contact" texto="Empezar una cotización" />
          </article>
        </div>

        <div className="hero-unified__counter" aria-hidden="true">
          <strong>{String(escena + 1).padStart(2, '0')}</strong>
          <span>/ {String(PANEL_COUNT).padStart(2, '0')}</span>
        </div>
        <div className="hero-unified__hint" aria-hidden="true">↓ Explora Joker</div>
        <div className="hero-presentacion__progress" aria-hidden="true"><span ref={progresoRef} /></div>
      </ImageSequenceViewer>
    </section>
  )
}

export default HeroPresentacion
