import HeroPresentacion from '../components/HeroPresentacion'
import { Link } from 'react-router-dom'
import { serviceContent } from '../config/serviceContent'
import '../styles/service-guide.css'

function Home() {
  return (
    <>
      <HeroPresentacion />
      <section className="service-guide" aria-labelledby="home-services-title">
        <p className="eyebrow">Diseño, fabricación e instalación</p>
        <h2 id="home-services-title">Publicidad para negocios en Lima y Huancayo</h2>
        <p>En Joker producimos letreros luminosos, letras corpóreas 3D, gigantografías, viniles y señalética. Cuéntanos dónde irá tu proyecto, comparte fotos y medidas aproximadas y revisaremos materiales, diseño e instalación para preparar una cotización.</p>
        <nav className="service-guide__related" aria-label="Servicios publicitarios">
          {Object.entries(serviceContent).map(([slug, item]) => <Link key={slug} to={`/servicios/${slug}`}>{item.heading}</Link>)}
        </nav>
        <p>La atención en Lima es comercial y digital; no contamos con atención presencial abierta al público en Lima. <Link to="/contacto">Contacta a Joker para coordinar tu proyecto.</Link></p>
      </section>
    </>
  )
}

export default Home

