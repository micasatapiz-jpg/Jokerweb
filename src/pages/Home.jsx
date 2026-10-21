import ServiceCard from '../components/ServiceCard'
import { serviceFamilies } from '../config/siteConfig'
import HeroPresentacion from '../components/HeroPresentacion'
import { Link } from 'react-router-dom'
import '../styles/service-guide.css'

function Home() {
  return (
    <>
      <HeroPresentacion />
      <section className="page services-page" aria-labelledby="home-product-families">
        <header>
          <p className="eyebrow">Impresión y producción publicitaria</p>
          <h2 id="home-sign-types">¿Qué necesita tu marca?</h2>
          <p>Desde un banner o un vinil hasta letras corpóreas y estructuras publicitarias. Encuentra el producto que necesitas y conoce sus opciones.</p>
        </header>
        <div className="services-grid services-grid--catalog">
          {serviceFamilies.map(service => <ServiceCard key={service.id} service={service} />)}
        </div>
      </section>
      <section className="service-guide" aria-labelledby="home-services-title">
        <p className="eyebrow">Diseño, fabricación e instalación</p>
        <h2 id="home-services-title">Publicidad desde Lima para todo el Perú</h2>
        <p>En Joker imprimimos banners, gigantografías y viniles; fabricamos letras corpóreas, letreros, señalética y exhibidores. También creamos neón LED y espejos infinitos. Cuéntanos dónde irá tu proyecto, comparte fotos y medidas aproximadas y revisaremos materiales, diseño e instalación para preparar una cotización.</p>
        <h3>¿Qué necesitamos para cotizar?</h3>
        <p>Indica producto, medidas, cantidad, ciudad y fecha deseada. Para trabajos con aplicación o montaje, añade fotos del espacio. Adjunta tu logo o una referencia si los tienes. Si todavía no sabes qué material elegir, cuéntanos qué quieres comunicar y te orientamos.</p>
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






