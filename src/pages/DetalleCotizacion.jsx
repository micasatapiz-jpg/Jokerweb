import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import SalesSidebar from '../components/SalesSidebar'
import { salesApi } from '../services/salesApi'

const money = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' })
const statusLabel = { DRAFT: 'Borrador', SENT: 'Enviada', APPROVED: 'Aprobada', REJECTED: 'Rechazada', EXPIRED: 'Vencida' }

function DetalleCotizacion() {
  const { id } = useParams()
  const [quote, setQuote] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [customerMessage, setCustomerMessage] = useState(null)
  const [audioUrl, setAudioUrl] = useState('')
  const [communicationBusy, setCommunicationBusy] = useState('')
  const [communicationNotice, setCommunicationNotice] = useState('')

  useEffect(() => {
    salesApi.quote(id).then(setQuote).catch((reason) => setError(reason.message))
    salesApi.quoteCustomerMessage(id).then(setCustomerMessage).catch((reason) => setCommunicationNotice(reason.message))
  }, [id])

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }, [audioUrl])

  const approve = async () => {
    setBusy(true); setError('')
    try { setQuote(await salesApi.approveQuote(id)) } catch (reason) { setError(reason.message) } finally { setBusy(false) }
  }

  const copyMessage = async () => {
    if (!customerMessage?.text) return
    await navigator.clipboard.writeText(customerMessage.text)
    setCommunicationNotice('Mensaje copiado. Ya puedes enviarlo por WhatsApp.')
  }

  const generateAudio = async () => {
    setCommunicationBusy('audio'); setCommunicationNotice('')
    try {
      const blob = await salesApi.quoteCustomerAudio(id)
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      setAudioUrl(URL.createObjectURL(blob))
      setCommunicationNotice('Audio generado. Escúchalo y revísalo antes de enviarlo.')
    } catch (reason) {
      setCommunicationNotice(reason.message)
    } finally {
      setCommunicationBusy('')
    }
  }

  return (
    <div className="sales-shell">
      <SalesSidebar />
      <section className="sales-workspace">
        <header className="sales-workspace__header"><div><Link className="sales-back" to="/app">← Volver a cotizaciones</Link><h1>{quote?.number || 'Cotización'}</h1></div>{quote && <div className="sales-actions"><a className="sales-button sales-button--secondary" href={salesApi.pdfUrl(id)}>Descargar PDF</a>{quote.status !== 'APPROVED' && <button className="sales-button" onClick={approve} disabled={busy}>{busy ? 'Aprobando…' : 'Aprobar'}</button>}</div>}</header>
        {error && <div className="sales-notice sales-notice--error">{error}</div>}
        {!quote && !error && <div className="sales-loading">Cargando cotización…</div>}
        {quote && <><article className="quote-detail">
          <header><div><small>Cliente</small><h2>{quote.customer.name}</h2><p>{[quote.customer.company, quote.customer.phone, quote.customer.email].filter(Boolean).join(' · ')}</p></div><span className={`status status--${quote.status.toLowerCase()}`}>{statusLabel[quote.status]}</span></header>
          <div className="quote-detail__items">{quote.items.map((item) => <div key={item.id}><div><strong>{item.description}</strong><small>{item.widthM && item.heightM ? `${Number(item.widthM)} m × ${Number(item.heightM)} m · ` : ''}{item.quantity} unidad(es)</small></div><b>{money.format(Number(item.subtotal))}</b></div>)}</div>
          <dl className="quote-totals"><div><dt>Subtotal</dt><dd>{money.format(Number(quote.subtotal))}</dd></div>{Number(quote.discount) > 0 && <div><dt>Descuento</dt><dd>− {money.format(Number(quote.discount))}</dd></div>}<div><dt>IGV</dt><dd>{money.format(Number(quote.tax))}</dd></div><div className="quote-totals__final"><dt>Total</dt><dd>{money.format(Number(quote.total))}</dd></div></dl>
          {quote.sourceText && <blockquote><small>Solicitud original</small>{quote.sourceText}</blockquote>}
          {quote.designBrief && <blockquote><small>Idea para el diseño</small>{quote.designBrief}</blockquote>}
          {quote.installationNotes && <blockquote><small>Lugar de instalación</small>{quote.serviceAddress && <strong>{quote.serviceAddress}</strong>}{quote.installationNotes}</blockquote>}
          {quote.attachments?.length > 0 && <section className="quote-attachments"><h3>Imágenes enviadas por el cliente</h3><div className="quote-attachments__grid">{quote.attachments.map((attachment) => <figure key={attachment.id}><a href={salesApi.quoteAttachmentUrl(quote.id, attachment.id)} target="_blank" rel="noreferrer"><img src={salesApi.quoteAttachmentUrl(quote.id, attachment.id)} alt={attachment.kind === 'LOGO' ? 'Logo enviado por el cliente' : attachment.kind === 'INSTALLATION_SPACE' ? 'Lugar de instalación' : 'Referencia visual del cliente'} /></a><figcaption>{attachment.kind === 'LOGO' ? 'Logo' : attachment.kind === 'INSTALLATION_SPACE' ? 'Lugar de instalación' : 'Referencia'} · {attachment.originalName}</figcaption></figure>)}</div></section>}
        </article>
        <section className="customer-message-card" aria-labelledby="customer-message-title">
          <header>
            <div><small>Mensaje para el cliente</small><h2 id="customer-message-title">Resumen comercial y voz</h2></div>
            <span>Revisión humana requerida</span>
          </header>
          {customerMessage ? <>
            <p>{customerMessage.text}</p>
            {customerMessage.visit.enabled
              ? <div className="visit-setting">Visita habilitada: {customerMessage.visit.label}{customerMessage.visit.appointmentRequired ? ' · con cita previa' : ''}</div>
              : <div className="visit-setting">La visita presencial está desactivada; el mensaje ofrece llamada o reunión coordinada.</div>}
            {audioUrl && <audio controls src={audioUrl}>Tu navegador no puede reproducir este audio.</audio>}
            <div className="sales-actions">
              <button className="sales-button sales-button--secondary" type="button" onClick={copyMessage}>Copiar texto</button>
              <button className="sales-button" type="button" onClick={generateAudio} disabled={communicationBusy === 'audio'}>{communicationBusy === 'audio' ? 'Generando voz…' : 'Generar audio'}</button>
            </div>
            <small className="ai-voice-disclosure">La voz que escucha el cliente es generada por inteligencia artificial.</small>
          </> : <p>Preparando el mensaje con el total registrado…</p>}
          {communicationNotice && <div className="sales-notice sales-notice--warning">{communicationNotice}</div>}
        </section></>}
      </section>
    </div>
  )
}

export default DetalleCotizacion
