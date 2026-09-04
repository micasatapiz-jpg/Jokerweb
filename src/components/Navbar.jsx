import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import WhatsAppButton from './WhatsAppButton'

const links = [
  { to: '/', label: 'Inicio' },
  { to: '/catalogo', label: 'Servicios' },
  { to: '/nosotros', label: 'Nosotros' },
  { to: '/contacto', label: 'Contacto' },
]

function Navbar() {
  const [menuAbierto, setMenuAbierto] = useState(false)
  const cerrarMenu = () => setMenuAbierto(false)

  return (
    <header className="navbar">
      <NavLink className="navbar__brand" to="/" onClick={cerrarMenu}>
        <img src="/src/assets/logo.png" alt="Joker Publicidad" />
      </NavLink>

      <button
        className="navbar__toggle"
        type="button"
        aria-label={menuAbierto ? 'Cerrar menú' : 'Abrir menú'}
        aria-expanded={menuAbierto}
        aria-controls="navbar-menu"
        onClick={() => setMenuAbierto((estadoActual) => !estadoActual)}
      >
        <span />
        <span />
        <span />
      </button>

      <div
        id="navbar-menu"
        className={`navbar__menu ${menuAbierto ? 'navbar__menu--open' : ''}`}
      >
        <nav aria-label="Navegación principal">
          <ul className="navbar__links">
            {links.map(({ to, label }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  className={({ isActive }) => (isActive ? 'active' : undefined)}
                  end={to === '/'}
                  onClick={cerrarMenu}
                >
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <WhatsAppButton
          servicio="general"
          origen="header"
          texto="Cotizar"
          className="navbar__quote"
        />
      </div>
    </header>
  )
}

export default Navbar
