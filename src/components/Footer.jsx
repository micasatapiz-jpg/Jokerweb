import { Link } from 'react-router-dom'
import { createWhatsAppLink, siteConfig } from '../config/siteConfig'

function Footer() {
  return (
    <footer className="footer">
      <div className="footer__brand">
        <img src="/src/assets/logo.png" alt="Joker Publicidad" />
        <p>Diseñamos, producimos e instalamos publicidad que hace visible tu negocio.</p>
      </div>

      <div className="footer__contact">
        <h2>Contacto</h2>
        <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
        <a href={createWhatsAppLink()} target="_blank" rel="noreferrer">
          WhatsApp: {siteConfig.whatsappDisplay}
        </a>
        <span>Lima + Huancayo</span>
      </div>

      <nav className="footer__navigation" aria-label="Navegación del pie de página">
        <h2>Enlaces rápidos</h2>
        <Link to="/">Inicio</Link>
        <Link to="/catalogo">Servicios</Link>
        <Link to="/nosotros">Nosotros</Link>
        <Link to="/contacto">Contacto</Link>
      </nav>

      <p className="footer__copyright">
        © {new Date().getFullYear()} Joker Publicidad
      </p>
    </footer>
  )
}

export default Footer
