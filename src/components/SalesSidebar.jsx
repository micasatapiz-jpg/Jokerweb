import { Link, NavLink } from 'react-router-dom'

function SalesSidebar() {
  return (
    <aside className="sales-sidebar">
      <Link to="/" className="sales-sidebar__brand">JOKER <small>Ventas</small></Link>
      <nav aria-label="Panel de ventas">
        <NavLink to="/app" end className={({ isActive }) => (isActive ? 'is-active' : '')}>Cotizaciones</NavLink>
        <NavLink to="/app/precios" className={({ isActive }) => (isActive ? 'is-active' : '')}>Productos y precios</NavLink>
        <Link to="/cotizar">Nueva cotización</Link>
      </nav>
      <p>Sistema local · Huancayo</p>
    </aside>
  )
}

export default SalesSidebar
