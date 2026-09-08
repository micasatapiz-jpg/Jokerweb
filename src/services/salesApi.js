const API_URL = (import.meta.env.VITE_SALES_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api')).replace(/\/$/, '')

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message
    throw new Error(message || (response.status >= 500
      ? 'El servicio local no está disponible en este momento.'
      : 'No pudimos comunicarnos con el sistema local.'))
  }

  return response.status === 204 ? null : response.json()
}

async function upload(path, formData) {
  const response = await fetch(`${API_URL}${path}`, { method: 'POST', body: formData })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message
    throw new Error(message || 'No pudimos procesar el archivo.')
  }
  return body
}

async function requestBlob(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message
    throw new Error(message || 'No pudimos generar el audio.')
  }
  return response.blob()
}

export const salesApi = {
  products: () => request('/products'),
  updatePriceRule: (productId, rule) => request(`/products/${productId}/price-rule`, {
    method: 'PUT',
    body: JSON.stringify(rule),
  }),
  analyze: (message) => request('/quote-drafts/analyze', {
    method: 'POST',
    body: JSON.stringify({ message }),
  }),
  calculate: (item) => request('/quotes/calculate', {
    method: 'POST',
    body: JSON.stringify(item),
  }),
  createCustomer: (customer) => request('/customers', {
    method: 'POST',
    body: JSON.stringify(customer),
  }),
  createQuote: (quote) => request('/quotes', {
    method: 'POST',
    body: JSON.stringify(quote),
  }),
  uploadQuoteAttachment: (quoteId, { file, kind, description }) => {
    const formData = new FormData()
    formData.append('kind', kind)
    formData.append('consent', 'true')
    if (description?.trim()) formData.append('description', description.trim())
    formData.append('file', file)
    return upload(`/quotes/${quoteId}/attachments`, formData)
  },
  quoteAttachmentUrl: (quoteId, attachmentId) => `${API_URL}/quotes/${quoteId}/attachments/${attachmentId}`,
  quotes: () => request('/quotes'),
  quote: (id) => request(`/quotes/${id}`),
  approveQuote: (id) => request(`/quotes/${id}/approve`, { method: 'POST' }),
  pdfUrl: (id) => `${API_URL}/quotes/${id}/pdf`,
  communicationsStatus: () => request('/communications/status'),
  transcribeAudio: (audio) => {
    const formData = new FormData()
    formData.append('audio', audio)
    return upload('/communications/transcriptions', formData)
  },
  quoteCustomerMessage: (id) => request(`/quotes/${id}/customer-message`),
  quoteCustomerAudio: (id) => requestBlob(`/quotes/${id}/customer-message/audio`, { method: 'POST' }),
  createVisualProposal: (formData) => upload('/visual-proposals', formData),
  generateVisualProposal: (id, formData) => upload(`/visual-proposals/${id}/generate`, formData),
  visualProposalImageUrl: (id) => `${API_URL}/visual-proposals/${id}/image`,
}
