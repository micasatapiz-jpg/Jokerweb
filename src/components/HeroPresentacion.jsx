import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import backgroundScroll from '../assets/home/background-scroll-illustrated.png'
import { serviceFamilies, siteConfig } from '../config/siteConfig'
import ImageSequenceViewer from './ImageSequenceViewer'
import WhatsAppButton from './WhatsAppButton'

const secuenciasMascota = [
  { ruta: '/secuencias/joker/clip-01', cantidad: 480, version: 'hq-3' },
  { ruta: '/secuencias/joker/clip-02', cantidad: 192, extension: 'png', version: 'original-rgb-lossless-2' },
  { ruta: '/secuencias/joker/clip-03', cantidad: 192, extension: 'png', version: 'original-rgb-lossless-2' },
]

const processSteps = [
  ['01', 'Pensamos', 'Entendemos qué necesitas y dónde debe verse.'],
  ['02', 'Diseñamos', 'Convertimos la idea en una propuesta visual.'],
  ['03', 'Producimos', 'Fabricamos e imprimimos cada pieza.'],
  ['04', 'Instalamos', 'Dejamos tu marca lista para entrar en escena.'],
]

const faqs = [
  ['¿Necesito tener mi diseño listo?', 'No. Podemos trabajar desde tu logo, una referencia o una idea.'],
  ['¿Realizan instalación?', 'Sí, según el tipo de proyecto y la ubicación.'],
  ['¿Puedo cotizar enviando una foto?', 'Sí. Una foto y medidas aproximadas son suficientes para empezar.'],
  ['¿Atienden empresas?', 'Sí. Atendemos negocios, empresas, agencias y organizaciones.'],
  ['¿Atienden en Lima?', 'Sí. La atención comercial en Lima es principalmente digital.'],
  ['¿Tienen presencia en Huancayo?', 'Sí. Contamos con un espacio Joker dentro de Casa Tapiz.'],
]

const PANEL_COUNT = 7

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

        <div className="hero-unified__brand" aria-hidden="true">
          <strong>JOKER</strong>
          <span>Producción publicitaria</span>
        </div>

        <div className="hero-unified__deck" aria-live="polite">
          <article ref={(element) => { panelesRef.current[0] = element }} className="hero-unified__panel hero-unified__panel--intro" aria-hidden={escena !== 0}>
            <p>Publicidad · Producción · Instalación</p>
            <h1 id="hero-title">Tu marca<br />entra en escena.</h1>
            <div className="hero-unified__actions">
              <WhatsAppButton servicio="general" origen="home-unified" texto="Cotizar por WhatsApp" />
              <Link to="/catalogo">Ver servicios ↗</Link>
            </div>
          </article>

          <article ref={(element) => { panelesRef.current[1] = element }} className="hero-unified__panel hero-unified__panel--services" aria-hidden={escena !== 1}>
            <p>Todo lo que hacemos</p>
            <h2>Servicios</h2>
            <div className="hero-unified__service-grid">
              {serviceFamilies.map((service) => (
                <Link key={service.id} to={service.detailPath ?? `/catalogo#${service.id}`}>
                  <span>{service.number}</span>
                  <strong>{service.title}</strong>
                  <small>{service.includes.slice(0, 3).join(' · ')}</small>
                </Link>
              ))}
            </div>
          </article>

          <article ref={(element) => { panelesRef.current[2] = element }} className="hero-unified__panel hero-unified__panel--process" aria-hidden={escena !== 2}>
            <p>Un solo equipo</p>
            <h2>Proceso</h2>
            <div className="hero-unified__process-grid">
              {processSteps.map(([number, title, text]) => (
                <div key={number}>
                  <span>{number}</span>
                  <strong>{title}</strong>
                  <small>{text}</small>
                </div>
              ))}
            </div>
          </article>

          <article ref={(element) => { panelesRef.current[3] = element }} className="hero-unified__panel hero-unified__panel--business" aria-hidden={escena !== 3}>
            <p>Empresas y proyectos recurrentes</p>
            <h2>Soluciones<br />para empresas</h2>
            <div className="hero-unified__text-block">
              <span>Negocios · Agencias · Arquitectos · Organizaciones</span>
              <small>Producimos una pieza puntual o acompañamos todo el proyecto, desde el diseño hasta la instalación.</small>
              <WhatsAppButton servicio="empresarial" origen="home-business" texto="Cotizar proyecto empresarial" />
            </div>
          </article>

          <article ref={(element) => { panelesRef.current[4] = element }} className="hero-unified__panel hero-unified__panel--about" aria-hidden={escena !== 4}>
            <p>Diseño · Producción · Instalación</p>
            <h2>Somos Joker</h2>
            <div className="hero-unified__text-block">
              <small>Somos un equipo creativo y de producción publicitaria que lleva una idea desde la pantalla hasta el lugar donde realmente importa: frente a las personas.</small>
              <Link to="/nosotros">Conocer a Joker ↗</Link>
            </div>
          </article>

          <article ref={(element) => { panelesRef.current[5] = element }} className="hero-unified__panel hero-unified__panel--faq" aria-hidden={escena !== 5}>
            <p>Información útil</p>
            <h2>Preguntas frecuentes</h2>
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
            <p>Lima + Huancayo · Cotización digital</p>
            <h2>Contacto</h2>
            <div className="hero-unified__contact-data">
              <a href={`tel:${siteConfig.phoneNumber}`}>{siteConfig.phoneDisplay}</a>
              <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
              <span>Envíanos una foto, medidas aproximadas y cuéntanos qué necesitas.</span>
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
