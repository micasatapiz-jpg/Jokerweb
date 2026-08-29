const whatsappNumber = import.meta.env.VITE_WHATSAPP_NUMBER

function WhatsAppButton({ mensaje, texto = 'Cotizar por WhatsApp', className = '' }) {
  const link = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(mensaje)}`
  const classes = ['whatsapp-button', className].filter(Boolean).join(' ')

  return (
    <a
      className={classes}
      href={link}
      target="_blank"
      rel="noreferrer"
      aria-label="Contactar a Joker por WhatsApp"
    >
      {texto}
    </a>
  )
}

export default WhatsAppButton
