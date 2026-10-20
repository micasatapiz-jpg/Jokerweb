import { Link } from 'react-router-dom'
import { serviceContent } from '../config/serviceContent'
import WhatsAppButton from './WhatsAppButton'
import '../styles/service-guide.css'

export default function ServiceGuide({ slug }) {
  const content = serviceContent[slug]
  if (!content) return null
  return (
    <section className="service-guide" aria-labelledby={`guide-${slug}`}>
      <p className="eyebrow">Guía para tu proyecto</p>
      <h2 id={`guide-${slug}`}>{content.selectionTitle}</h2>
      <p>{content.introduction}</p>
      <p>{content.selection}</p>
      <div className="service-guide__columns">
        <div>
          <h2>Qué enviar para cotizar</h2>
          <ul>{content.requirements.map((item) => <li key={item}>{item}</li>)}</ul>
          <p>Atención comercial por WhatsApp para proyectos en Lima y Huancayo. Confirma la cobertura y las condiciones de instalación al consultar.</p>
          <WhatsAppButton mensaje={`Hola, Joker. Quiero cotizar ${content.heading}. Tengo fotos y medidas para compartir.`} origen={`guia-${slug}`} texto="Consultar mi proyecto" />
        </div>
        <div>
          <h2>Preguntas frecuentes</h2>
          {content.questions.map(([question, answer]) => (
            <details key={question}><summary>{question}</summary><p>{answer}</p></details>
          ))}
        </div>
      </div>
      <nav aria-label="Otros servicios de Joker" className="service-guide__related">
        <h2>Otros servicios para tu negocio</h2>
        {Object.entries(serviceContent).filter(([key]) => key !== slug).map(([key, item]) => (
          <Link key={key} to={`/servicios/${key}`}>{item.heading}</Link>
        ))}
      </nav>
    </section>
  )
}
