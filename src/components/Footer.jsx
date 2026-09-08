import { Link } from 'react-router-dom'
import { createWhatsAppLink, siteConfig } from '../config/siteConfig'

function Footer() {
  return (
    <footer className="footer">
      <div className="footer__main">
        <div className="footer__brand">
          <Link to="/" aria-label="Joker Producción Publicitaria — Inicio">
            <strong>JOKER</strong>
            <span>Producción publicitaria</span>
          </Link>
          <p>Diseñamos, producimos e instalamos soluciones publicitarias en Lima y Huancayo.</p>
        </div>

        <div className="footer__contact">
          <h3>Hablemos</h3>
          <a className="footer__contact-primary" href={createWhatsAppLink()} target="_blank" rel="noreferrer">
            {siteConfig.whatsappDisplay}
          </a>
          <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
          <span>Atención comercial digital</span>
        </div>

        <nav className="footer__navigation" aria-label="Navegación del pie de página">
          <h3>Explora</h3>
          <Link to="/">Inicio</Link>
          <Link to="/catalogo">Servicios</Link>
          <Link to="/nosotros">Nosotros</Link>
          <Link to="/contacto">Contacto</Link>
        </nav>
      </div>

      <div className="footer__bottom">
        <p>© {new Date().getFullYear()} Joker Producción Publicitaria</p>
        <p>Lima <span aria-hidden="true">·</span> Huancayo, Perú</p>
      </div>
    </footer>
  )
}

export default Footer
