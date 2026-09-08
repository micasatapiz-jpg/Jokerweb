import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { WhatsAppDeliveryService } from './whatsapp-delivery.service.js'

function setup() {
  const conversation = { id: randomUUID(), customerPhone: '51999000123', context: {} }
  const quote = { id: randomUUID(), number: 'TEST', status: 'APPROVED', validUntil: new Date(Date.now() + 60000),
    customer: { phone: '+51999000123' }, workflowSnapshot: null as unknown }
  const db = { conversation: { findFirst: vi.fn().mockResolvedValue(conversation), update: vi.fn().mockResolvedValue({}) },
    job: { findFirst: vi.fn().mockResolvedValue(null) }, visualProposal: { findFirst: vi.fn().mockResolvedValue(null) } }
  const communications = { speech: vi.fn().mockResolvedValue({ message: { text: 'Texto fixture' }, audio: Buffer.from('fixture') }) }
  const pdf = { render: vi.fn().mockResolvedValue(Buffer.from('fixture')) }
  const gateway = { mode: 'simulate', sendText: vi.fn(), sendMedia: vi.fn() }
  const service = new WhatsAppDeliveryService(db as any, { tenantId: randomUUID() } as any,
    { get: vi.fn().mockImplementation(async () => quote) } as any, pdf as any, communications as any, {} as any, gateway as any)
  return { service, db, conversation, quote, communications, pdf, gateway }
}

describe('Entrega de presupuestos: autorización antes de generar audio o enviar', () => {
  it.each(['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'EXPIRED'])('no comunica %s al cliente', async (status) => {
    const h = setup(); h.quote.status = status
    await expect(h.service.deliver(h.conversation.id, h.quote.id)).rejects.toThrow('aprobada y vigente')
    expect(h.communications.speech).not.toHaveBeenCalled()
    expect(h.pdf.render).not.toHaveBeenCalled()
    expect(h.gateway.sendText).not.toHaveBeenCalled()
  })
  it('rechaza una cotización vencida aunque figure aprobada', async () => {
    const h = setup(); h.quote.validUntil = new Date(0)
    await expect(h.service.deliver(h.conversation.id, h.quote.id)).rejects.toThrow('vigente')
    expect(h.communications.speech).not.toHaveBeenCalled()
  })
  it('rechaza enviar datos de un cliente a otro número', async () => {
    const h = setup(); h.quote.customer.phone = '51999000999'
    await expect(h.service.deliver(h.conversation.id, h.quote.id)).rejects.toThrow('destinatario')
    expect(h.gateway.sendMedia).not.toHaveBeenCalled()
    expect(h.communications.speech).not.toHaveBeenCalled()
  })
  it('revalida el trabajo y la revisión de requisitos antes de preparar medios', async () => {
    const h = setup()
    const jobId = randomUUID(), productId = randomUUID()
    h.quote.workflowSnapshot = { jobId, productId, requirementsRevision: 2, configurationId: randomUUID(), configurationVersion: 1,
      priceRuleId: randomUUID(), priceRuleUpdatedAt: new Date().toISOString() }
    await expect(h.service.deliver(h.conversation.id, h.quote.id)).rejects.toThrow('cambiaron')
    expect(h.db.job.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: jobId, productId, quoteId: h.quote.id, conversationId: h.conversation.id, requirementsRevision: 2,
    }) }))
    expect(h.communications.speech).not.toHaveBeenCalled()
  })
  it('permite un presupuesto aprobado del destinatario correcto usando solo servicios simulados', async () => {
    const h = setup()
    expect((await h.service.deliver(h.conversation.id, h.quote.id)).delivered).toBe(true)
    expect(h.gateway.sendText).toHaveBeenCalledOnce()
    expect(h.gateway.sendMedia).toHaveBeenCalledTimes(2)
  })
})
