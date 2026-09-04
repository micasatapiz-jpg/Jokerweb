import WhatsAppButton from '../components/WhatsAppButton'
import { siteConfig } from '../config/siteConfig'

function Contacto() {
  return (
    <section className="page contact-page" aria-labelledby="contact-title">
      <p className="eyebrow">Contacto y cotizaciones</p>
      <h1 id="contact-title">Tienes una idea.<br />Hagámosla visible.</h1>
      <p>
        Envíanos una foto, las medidas aproximadas y cuéntanos qué necesitas.
        Con eso podemos comenzar a preparar tu cotización.
      </p>

      <div className="contact-primary">
        <div>
          <span>Canal principal</span>
          <h2>Cuéntanos tu proyecto por WhatsApp.</h2>
          <p>Foto + medidas aproximadas + idea = empezamos.</p>
        </div>
        <WhatsAppButton servicio="general" origen="contact" texto="Cotizar por WhatsApp" />
      </div>

      <div className="contact-grid">
        <article>
          <span>WhatsApp y llamadas</span>
          <a href={`tel:${siteConfig.phoneNumber}`}>{siteConfig.phoneDisplay}</a>
          <p>Consultas, cotizaciones y coordinación comercial.</p>
        </article>
        <article>
          <span>Correo</span>
          <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
          <p>Empresas, cotizaciones y documentación.</p>
        </article>
        <article>
          <span>Lima</span>
          <strong>{siteConfig.locations.lima}</strong>
          <p>No contamos con atención presencial abierta al público en Lima.</p>
        </article>
        <article>
          <span>Huancayo</span>
          <strong>{siteConfig.locations.huancayo}</strong>
          <p>La dirección completa se publicará cuando quede confirmada.</p>
        </article>
      </div>

      <section className="social-contact" aria-labelledby="social-contact-title">
        <p className="section-kicker">Procesos, trabajos y novedades</p>
        <h2 id="social-contact-title">Así se hace Joker.</h2>
        <p>
          Síguenos para ver cómo diseñamos, imprimimos, fabricamos e instalamos cada proyecto.
        </p>
        <div>
          <span>TikTok · {siteConfig.social.tiktok.label}</span>
          <span>Facebook · {siteConfig.social.facebook.label}</span>
          <span>{siteConfig.social.instagram.label}</span>
        </div>
      </section>
    </section>
  )
}

export default Contacto
