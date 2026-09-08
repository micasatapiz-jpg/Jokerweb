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
          Somos un equipo creativo y de producción publicitaria que transforma ideas en
          piezas capaces de hacerse notar.
        </p>
      </header>

      <section className="about-page__statement" aria-labelledby="about-statement-title">
        <p className="section-kicker">De la idea al espacio</p>
        <h2 id="about-statement-title">Pensamos, fabricamos y colocamos.</h2>
        <p>
          Trabajamos entre diseño, impresión, estructuras, materiales, máquinas e
          instalación para llevar cada proyecto desde la pantalla hasta el lugar donde
          realmente importa: frente a las personas.
        </p>
      </section>

      <div className="about-page__principles" aria-label="Cómo trabajamos">
        <article>
          <img src={procesoDiseno} alt="Diseño de un proyecto publicitario con muestras de materiales" loading="lazy" decoding="async" />
          <span>01</span>
          <div><strong>Diseñamos</strong><p>Convertimos una necesidad comercial en una propuesta visual clara.</p></div>
        </article>
        <article>
          <img src={procesoProduccion} alt="Fabricación de letras corpóreas con iluminación LED" loading="lazy" decoding="async" />
          <span>02</span>
          <div><strong>Producimos</strong><p>Elegimos materiales y acabados que funcionan en el espacio real.</p></div>
        </article>
        <article>
          <img src={procesoInstalacion} alt="Instalación de un letrero luminoso en una fachada comercial" loading="lazy" decoding="async" />
          <span>03</span>
          <div><strong>Instalamos</strong><p>Cerramos el proceso cuidando presencia, resistencia y terminación.</p></div>
        </article>
      </div>
    </section>
  )
}

export default Nosotros
