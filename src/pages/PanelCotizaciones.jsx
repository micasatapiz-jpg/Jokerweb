import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import SalesSidebar from '../components/SalesSidebar'
import { salesApi } from '../services/salesApi'

const money = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' })
const date = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium' })
const statusLabel = { DRAFT: 'Borrador', SENT: 'Enviada', APPROVED: 'Aprobada', REJECTED: 'Rechazada', EXPIRED: 'Vencida' }

function PanelCotizaciones() {
  const [quotes, setQuotes] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    salesApi.quotes().then(setQuotes).catch((reason) => setError(reason.message))
  }, [])

  return (
    <div className="sales-shell">
      <SalesSidebar />
      <section className="sales-workspace">
        <header className="sales-workspace__header"><div><p>Panel comercial</p><h1>Cotizaciones</h1></div><Link className="sales-button" to="/cotizar">+ Nueva cotización</Link></header>
        {error && <div className="sales-notice sales-notice--error">{error} Verifica que el servidor local esté encendido.</div>}
        {!error && quotes.length === 0 && <div className="sales-empty"><span>J</span><h2>Aún no hay cotizaciones</h2><p>Crea la primera y aparecerá aquí para revisarla.</p><Link className="sales-button" to="/cotizar">Crear cotización</Link></div>}
        {quotes.length > 0 && (
          <div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>Número</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th>Total</th><th /></tr></thead><tbody>
            {quotes.map((quote) => <tr key={quote.id}><td><strong>{quote.number}</strong></td><td>{quote.customer.name}<small>{quote.customer.company}</small></td><td>{date.format(new Date(quote.createdAt))}</td><td><span className={`status status--${quote.status.toLowerCase()}`}>{statusLabel[quote.status]}</span></td><td><strong>{money.format(Number(quote.total))}</strong></td><td><Link className="sales-row-link" to={`/app/cotizaciones/${quote.id}`}>Ver →</Link></td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </div>
  )
}

export default PanelCotizaciones
