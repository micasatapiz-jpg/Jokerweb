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
        <h2 id="home-services-title">Publicidad desde Lima para todo el Perú</h2>
        <p>En Joker producimos letreros luminosos, letras corpóreas 3D, gigantografías, viniles y señalética. Cuéntanos dónde irá tu proyecto, comparte fotos y medidas aproximadas y revisaremos materiales, diseño e instalación para preparar una cotización.</p>
        <nav className="service-guide__related" aria-label="Servicios publicitarios">
          {Object.entries(serviceContent).map(([slug, item]) => <Link key={slug} to={`/servicios/${slug}`}>{item.heading}</Link>)}
        </nav>
        <h3>¿Qué necesitamos para cotizar?</h3>
        <p>Envíanos una foto del espacio, medidas aproximadas, ciudad y fecha deseada. Adjunta tu logo o una referencia si los tienes. Si todavía no sabes qué material elegir, cuéntanos qué quieres comunicar y te orientamos.</p>
        <h3>¿Qué debes confirmar antes de aprobar?</h3>
        <p>Revisa el diseño, materiales, medidas y si el precio incluye instalación, transporte o envío. Trabajamos con el 50 % de adelanto y ofrecemos un año de garantía en trabajos de letras, según las condiciones de la cotización. Enviamos a todo el Perú; la instalación se realiza previa coordinación.</p>
        <h3>Empresas y sector público</h3>
        <p>Atendemos empresas y entidades públicas. Contamos con RNP: comparte tus especificaciones técnicas, cantidades y lugar de entrega para preparar la propuesta.</p>
        <p>Lima, Perú. Horario: lunes a sábado, de 9 a. m. a 7 p. m. <Link to="/contacto">Contacta a Joker para coordinar tu proyecto.</Link></p>
      </section>
    </>
  )
}

export default Home



