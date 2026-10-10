/** Use WhatsApp's direct send endpoint so the message avoids the wa.me redirect. */
export function buildWhatsAppLink(number, message) {
  const url = new URL('https://api.whatsapp.com/send')
  url.searchParams.set('phone', number)
  url.searchParams.set('text', message)
  return url.href
}
