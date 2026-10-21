import nosotrosTaller from '../assets/editorial/nosotros-taller-v2.webp'
import procesoDiseno from '../assets/editorial/proceso-diseno-v1.webp'
import procesoInstalacion from '../assets/editorial/proceso-instalacion-v1.webp'
import procesoProduccion from '../assets/editorial/proceso-produccion-v1.webp'

function Nosotros() {
  return (
    <section className="page editorial-page about-page" aria-labelledby="about-title">
      <header
        className="editorial-page__hero editorial-page__hero--photo about-page__hero"
        style={{ '--editorial-photo': `url(${nosotrosTaller})` }}
      >
        <div>
          <p className="eyebrow">Somos Joker</p>
          <h1 id="about-title">Hacemos visible tu marca.</h1>
        </div>
        <p>
          En Joker imprimimos banners, gigantografías y viniles, y fabricamos letras corpóreas,
          letreros, señalética y exhibidores para que tu negocio se reconozca desde la fachada hasta el interior.
        </p>
      </header>

      <section className="about-page__statement" aria-labelledby="about-statement-title">
        <p className="section-kicker">De la idea al espacio</p>
        <h2 id="about-statement-title">Pensamos, fabricamos y colocamos.</h2>
        <p>
          Partimos de lo que necesitas comunicar y del espacio donde se verá tu marca.
          Revisamos medidas, distancia de lectura, iluminación y superficie para proponer
          materiales y acabados adecuados. Comparte fotos del lugar, tu logo y la fecha
          que tienes en mente para comenzar a definir el proyecto.
        </p>
      </section>

      <div className="about-page__principles" aria-label="Cómo trabajamos">
        <article>
          <img src={procesoDiseno} alt="Diseño de un proyecto publicitario con muestras de materiales" loading="lazy" decoding="async" />
          <span>01</span>
          <div><strong>Diseñamos</strong><p>Organizamos tu logo, textos y colores para que el mensaje se lea en el lugar donde irá instalado.</p></div>
        </article>
        <article>
          <img src={procesoProduccion} alt="Fabricación de letras corpóreas con iluminación LED" loading="lazy" decoding="async" />
          <span>02</span>
          <div><strong>Producimos</strong><p>Imprimimos y fabricamos cada pieza según las medidas, materiales y acabados acordados. La iluminación se define cuando el producto la requiere.</p></div>
        </article>
        <article>
          <img src={procesoInstalacion} alt="Instalación de un letrero luminoso en una fachada comercial" loading="lazy" decoding="async" />
          <span>03</span>
          <div><strong>Instalamos</strong><p>Coordinamos la instalación según ubicación, acceso y superficie. Confirma su alcance e inclusión en tu cotización.</p></div>
        </article>
      </div>
      <p className="page">Imágenes referenciales de diseño, producción e instalación.</p>
      <section className="about-page__statement" aria-labelledby="about-coverage-title">
        <p className="section-kicker">Lima, Perú</p>
        <h2 id="about-coverage-title">Tu proyecto, donde lo necesitas.</h2>
        <p>Atendemos de lunes a sábado, de 9 a. m. a 7 p. m. y enviamos a todo el Perú. Las instalaciones se realizan previa coordinación. Trabajamos con empresas y entidades públicas; contamos con RNP.</p>
      </section>
    </section>
  )
}

export default Nosotros



