import { Link } from 'react-router-dom'
import WhatsAppButton from '../components/WhatsAppButton'

function NoEncontrado() {
  return (
    <section className="page not-found-page" aria-labelledby="not-found-title">
      <p className="eyebrow">Error 404</p>
      <h1 id="not-found-title">Esta página no existe.</h1>
      <p>Puede que el enlace haya cambiado. Revisa nuestros productos o escríbenos y te ayudamos con tu proyecto.</p>
      <div className="not-found-page__actions">
        <Link className="not-found-page__link" to="/catalogo">Ver productos</Link>
        <WhatsAppButton origen="404" />
      </div>
    </section>
  )
}

export default NoEncontrado
