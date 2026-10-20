import WhatsAppButton from '../components/WhatsAppButton'
import { siteConfig } from '../config/siteConfig'
import contactoInstalacion from '../assets/editorial/contacto-instalacion-v2.webp'
import contactoAsesoria from '../assets/editorial/contacto-asesoria-v1.webp'
import contactoShowroom from '../assets/editorial/contacto-showroom-v1.webp'

function Contacto() {
  return (
    <section className="page editorial-page contact-page" aria-labelledby="contact-title">
      <header
        className="editorial-page__hero editorial-page__hero--photo contact-page__hero"
        style={{ '--editorial-photo': `url(${contactoInstalacion})` }}
      >
        <div>
          <p className="eyebrow">Cotiza tu proyecto publicitario</p>
          <h1 id="contact-title">Tienes una idea.<br />Hagámosla visible.</h1>
        </div>
        <p>
          Envíanos una foto, las medidas aproximadas y cuéntanos qué necesitas.
          Con eso podemos comenzar a preparar tu cotización.
        </p>
      </header>

      <div
        className="contact-primary contact-primary--visual"
        style={{ '--contact-primary-image': `url(${contactoAsesoria})` }}
      >
        <div>
          <span>Canal principal</span>
          <h2>Cuéntanos tu proyecto por WhatsApp.</h2>
          <p>Comparte fotos, medidas aproximadas, ciudad y fecha en que lo necesitas. Si tienes logo o una referencia, envíalos también.</p>
        </div>
        <WhatsAppButton servicio="general" origen="contact" texto="Cotizar por WhatsApp" />
      </div>

      <div
        className="contact-grid contact-grid--visual"
        style={{ '--contact-grid-image': `url(${contactoShowroom})` }}
      >
        <article>
          <span>WhatsApp y llamadas</span>
          <a href={`tel:${siteConfig.phoneNumber}`}>{siteConfig.phoneDisplay}</a>
          <p>Atención virtual de 9 a. m. a 7 p. m.</p>
        </article>
        <article>
          <span>Correo</span>
          <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
          <p>Empresas, cotizaciones y documentación.</p>
        </article>
        <article>
          <span>Ubicación</span>
          <strong>{siteConfig.locations.lima}</strong>
          <p>No contamos con atención presencial abierta al público en Lima.</p>
        </article>
        <article>
          <span>Cobertura</span>
          <strong>Envíos a todo el Perú.</strong>
          <p>Instalaciones previa coordinación. Confirma costo de transporte, acceso y montaje en tu cotización.</p>
        </article>
      </div>

      <section className="social-contact" aria-labelledby="social-contact-title">
        <p className="section-kicker">Antes de comenzar</p>
        <h2 id="social-contact-title">Una cotización clara, desde el inicio.</h2>
        <p>
          El costo depende de las medidas, materiales, acabado, cantidad y lugar de instalación.
          Todo trabajo se realiza con el 50 % de adelanto. Los trabajos de letras tienen
          un año de garantía; consulta su alcance y condiciones en la cotización.
          El plazo y el pago del saldo se coordinan para cada pedido.
        </p>
        <div>
          <span>Atendemos empresas y al sector público</span>
          <span>Contamos con RNP</span>
          <span>Entrega y montaje según cotización</span>
        </div>
      </section>
      <section className="social-contact" aria-labelledby="social-links-title">
        <p className="section-kicker">Canales oficiales</p>
        <h2 id="social-links-title">Sigue a Joker.</h2>
        <p>Encuentra nuestras novedades en Instagram, TikTok y Facebook.</p>
        <div>
          {Object.entries(siteConfig.social).filter(([, social]) => social.url).map(([key, social]) => (
            <a className="text-link" key={key} href={social.url} target="_blank" rel="noreferrer">{social.label} ↗</a>
          ))}
        </div>
      </section>
    </section>
  )
}

export default Contacto

