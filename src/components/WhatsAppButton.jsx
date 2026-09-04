import { createWhatsAppLink } from '../config/siteConfig'

function WhatsAppButton({
  mensaje,
  servicio = 'general',
  origen = 'general',
  texto = 'Cotizar por WhatsApp',
  className = '',
}) {
  const link = createWhatsAppLink({ service: servicio, message: mensaje })
  const classes = ['whatsapp-button', className].filter(Boolean).join(' ')

  return (
    <a
      className={classes}
      href={link}
      target="_blank"
      rel="noreferrer"
      aria-label="Contactar a Joker por WhatsApp"
      data-contact-source={origen}
    >
      {texto}
    </a>
  )
}

export default WhatsAppButton
