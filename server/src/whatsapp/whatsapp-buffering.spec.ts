import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { Logger } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { WhatsAppProcessorService } from './whatsapp-processor.service.js'
import { WhatsAppConversationsService } from './whatsapp-conversations.service.js'

function worker() {
  const conversation = { id: randomUUID(), externalId: '51999000123', status: 'COLLECTING', greetedAt: null as Date | null,
    lastInboundAt: new Date(Date.now() - 30000), context: {}, messages: [{ id: randomUUID(), type: 'TEXT', text: 'Hola' }] }
  const db = { conversation: { findFirst: vi.fn().mockImplementation(async () => conversation), findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    conversationMessage: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    $transaction: vi.fn().mockImplementation(async (queries: Promise<unknown>[]) => Promise.all(queries)) }
  const ai = { analyze: vi.fn() }, communications = { transcribe: vi.fn() }, gateway = { sendText: vi.fn().mockResolvedValue({}), downloadMedia: vi.fn() }
  const processor = new WhatsAppProcessorService(new ConfigService({ WHATSAPP_DEBOUNCE_MS: '10000' }), db as any,
    { tenantId: randomUUID() } as any, ai as any, communications as any, gateway as any)
  return { processor, conversation, db, ai, communications, gateway }
}

describe('WhatsApp: pausa del cliente y respeto de atención humana', () => {
  it('no saluda ni usa IA antes de la pausa aunque se invoque el procesador directamente', async () => {
    const h = worker(); h.conversation.lastInboundAt = new Date()
    await h.processor.processConversation(h.conversation.id)
    expect(h.gateway.sendText).not.toHaveBeenCalled()
    expect(h.ai.analyze).not.toHaveBeenCalled()
    expect(h.db.conversationMessage.updateMany).not.toHaveBeenCalled()
  })
  it('saluda después de reunir el bloque y registra el saludo solo tras enviarlo', async () => {
    const h = worker()
    await h.processor.processConversation(h.conversation.id)
    expect(h.gateway.sendText).toHaveBeenCalledOnce()
    expect(h.gateway.sendText.mock.calls[0][1]).toContain('asistente virtual')
    expect(h.db.conversation.update).toHaveBeenCalledWith({ where: { id: h.conversation.id }, data: { greetedAt: expect.any(Date) } })
    expect(h.gateway.sendText.mock.invocationCallOrder[0]).toBeLessThan(h.db.conversation.update.mock.invocationCallOrder[0])
    expect(h.ai.analyze).not.toHaveBeenCalled()
  })
  it('un saludo que falla no queda registrado como enviado', async () => {
    const h = worker(); h.gateway.sendText.mockRejectedValueOnce(new Error('Fallo simulado'))
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try { await h.processor.processConversation(h.conversation.id) } finally { log.mockRestore() }
    expect(h.db.conversation.update).not.toHaveBeenCalled()
    expect(h.db.conversationMessage.updateMany).not.toHaveBeenCalled()
  })
  it.each(['HANDOFF', 'CLOSED'])('el estado %s detiene cualquier respuesta automática', async (status) => {
    const h = worker(); h.conversation.status = status
    await h.processor.processConversation(h.conversation.id)
    expect(h.gateway.sendText).not.toHaveBeenCalled()
    expect(h.ai.analyze).not.toHaveBeenCalled()
    expect(h.communications.transcribe).not.toHaveBeenCalled()
  })
  it('la consulta del worker excluye conversaciones de atención humana', async () => {
    const h = worker()
    await h.processor.processPending()
    expect(h.db.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { notIn: ['HANDOFF', 'CLOSED'] } }) }))
  })
  it('un mensaje nuevo no reactiva un chat derivado ni marca una bienvenida no enviada', async () => {
    const conversation = { id: randomUUID(), status: 'HANDOFF', greetedAt: null }
    const db = { conversation: { upsert: vi.fn().mockResolvedValue(conversation), update: vi.fn() },
      conversationMessage: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) } }
    const service = new WhatsAppConversationsService(db as any, { tenantId: randomUUID() } as any)
    const result = await service.ingest({ externalMessageId: 'msg-test', from: '51999000123', type: 'TEXT', text: 'Sigo esperando al dueño' })
    expect(result.conversation.status).toBe('HANDOFF')
    expect(result.conversation.greetedAt).toBeNull()
    expect(db.conversation.upsert.mock.calls[0][0].update).not.toHaveProperty('status')
    expect(db.conversation.update).not.toHaveBeenCalled()
  })
})
