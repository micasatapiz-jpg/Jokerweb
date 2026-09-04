import { Link } from 'react-router-dom'
import WhatsAppButton from './WhatsAppButton'

function ServiceCard({ service, compact = false }) {
  return (
    <article
      id={service.id}
      className={`service-card ${service.featured ? 'service-card--featured' : ''} ${compact ? 'service-card--compact' : ''}`}
    >
      <span className="service-card__number">{service.number}</span>
      <div>
        <h3>{service.title}</h3>
        <p>{service.description}</p>
        <ul aria-label={`Aplicaciones de ${service.title}`}>
          {service.includes.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <div className="service-card__actions">
          <WhatsAppButton
            mensaje={service.message}
            origen={`service-${service.id}`}
            texto={service.cta}
            className="service-card__cta"
          />
          {service.detailPath && (
            <Link className="service-card__details" to={service.detailPath}>
              Ver productos <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
      </div>
    </article>
  )
}

export default ServiceCard
