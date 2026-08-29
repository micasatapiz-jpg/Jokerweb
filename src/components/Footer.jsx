import { Link } from 'react-router-dom'

const contactEmail = import.meta.env.VITE_CONTACT_EMAIL
const whatsappNumber = import.meta.env.VITE_WHATSAPP_NUMBER

function Footer() {
  return (
    <footer className="footer">
      <div className="footer__brand">
        <img src="/src/assets/logo.png" alt="Joker Publicidad" />
        <p>Diseño, impresión y letreros que hacen visible tu negocio.</p>
      </div>

      <div className="footer__contact">
        <h2>Contacto</h2>
        <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        <a href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noreferrer">
          WhatsApp: +{whatsappNumber}
        </a>
      </div>

      <nav className="footer__navigation" aria-label="Navegación del pie de página">
        <h2>Enlaces rápidos</h2>
        <Link to="/">Inicio</Link>
        <Link to="/catalogo">Catálogo</Link>
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
