import { Link } from 'react-router-dom'
import { serviceFamilies, siteConfig } from '../config/siteConfig'
import ServiceCard from './ServiceCard'
import WhatsAppButton from './WhatsAppButton'

const processSteps = [
  ['01', 'Lo pensamos', 'Cuéntanos qué necesitas, dónde irá y qué quieres conseguir.'],
  ['02', 'Lo diseñamos', 'Convertimos tu idea en una propuesta visual lista para producir.'],
  ['03', 'Lo producimos', 'Fabricamos e imprimimos según las necesidades del proyecto.'],
  ['04', 'Lo instalamos', 'Llevamos el proyecto al espacio final y dejamos tu marca lista.'],
]

const faqs = [
  ['¿Necesito tener mi diseño listo?', 'No. Podemos trabajar desde tu logo, una referencia o una idea.'],
  ['¿Realizan instalación?', 'Sí, según el tipo de proyecto y la ubicación.'],
  ['¿Puedo cotizar enviando una foto?', 'Sí. Una foto, medidas aproximadas y tu necesidad son suficientes para empezar.'],
  ['¿Atienden empresas?', 'Sí. Trabajamos con negocios, empresas, agencias, arquitectos y organizaciones.'],
  ['¿Atienden en Lima?', 'Sí. Nuestra atención comercial en Lima es principalmente digital.'],
  ['¿Tienen presencia en Huancayo?', 'Sí. Contamos con un espacio Joker dentro de Casa Tapiz.'],
]

function ResumenComercial() {
  const featuredServices = serviceFamilies.filter((service) => service.featured)

  return (
    <div className="commercial-home">
      <section className="commercial-section commercial-positioning" aria-labelledby="positioning-title">
        <p className="section-kicker">Producción publicitaria integral</p>
        <h2 id="positioning-title">Hacemos publicidad.<br />Hacemos que te vean.</h2>
        <p className="section-lead">
          En Joker transformamos ideas en piezas que terminan frente a miles de personas:
          en fachadas, negocios, calles, campañas y espacios comerciales. Diseñamos,
          imprimimos, fabricamos e instalamos.
        </p>
        <strong>Si vas a aparecer, que se note.</strong>
      </section>

      <section className="commercial-section" aria-labelledby="home-services-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Servicios principales</p>
            <h2 id="home-services-title">Todo lo que tu marca necesita para entrar en escena.</h2>
          </div>
          <Link className="text-link" to="/catalogo">Ver todos los servicios ↗</Link>
        </div>
        <div className="services-grid services-grid--featured">
          {featuredServices.map((service) => (
            <ServiceCard key={service.id} service={service} compact />
          ))}
        </div>
        <p className="also-do">
          <strong>También hacemos:</strong> stickers personalizados, rotulado vehicular,
          neón LED, tótems publicitarios y proyectos especiales.
        </p>
      </section>

      <section className="commercial-section process-section" aria-labelledby="process-title">
        <p className="section-kicker">Un solo equipo. Todo el proceso.</p>
        <h2 id="process-title">De la idea a la calle.</h2>
        <div className="process-grid">
          {processSteps.map(([number, title, text]) => (
            <article key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
        <strong className="process-closing">Tú pones la marca. Nosotros hacemos que se vea.</strong>
      </section>

      <section className="commercial-section b2b-section" aria-labelledby="b2b-title">
        <p className="section-kicker">Empresas y proyectos recurrentes</p>
        <h2 id="b2b-title">Cuando el proyecto crece, nosotros también.</h2>
        <p className="section-lead">
          Trabajamos con negocios, empresas, agencias, arquitectos y organizaciones.
          Podemos producir una pieza puntual o acompañar todo el proyecto, desde el diseño
          hasta la instalación.
        </p>
        <p className="service-line">Impresión · Letreros · Señalética · Fachadas · Producción publicitaria</p>
        <WhatsAppButton servicio="empresarial" origen="b2b" texto="Cotizar proyecto empresarial" />
      </section>

      <section className="commercial-section about-summary" aria-labelledby="about-summary-title">
        <div>
          <p className="section-kicker">Somos Joker</p>
          <h2 id="about-summary-title">Diseñamos. Producimos. Instalamos.</h2>
        </div>
        <div>
          <p>
            Somos un equipo creativo y de producción publicitaria que lleva una idea desde
            la pantalla hasta el lugar donde realmente importa: frente a las personas.
          </p>
          <Link className="text-link" to="/nosotros">Conocer a Joker ↗</Link>
        </div>
      </section>

      <section className="commercial-section faq-section" aria-labelledby="faq-title">
        <p className="section-kicker">Preguntas frecuentes</p>
        <h2 id="faq-title">Antes de cotizar.</h2>
        <div className="faq-list">
          {faqs.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="commercial-section final-cta" aria-labelledby="final-cta-title">
        <p className="section-kicker">Lima + Huancayo · Atención y cotización digital</p>
        <h2 id="final-cta-title">¿Tienes una idea?<br />Hagámosla visible.</h2>
        <p>Envíanos una foto, las medidas aproximadas y cuéntanos qué necesitas.</p>
        <WhatsAppButton servicio="especial" origen="final" texto="Cotizar por WhatsApp" />
        <small>{siteConfig.whatsappDisplay} · Foto + medidas + idea = empezamos.</small>
      </section>
    </div>
  )
}

export default ResumenComercial
