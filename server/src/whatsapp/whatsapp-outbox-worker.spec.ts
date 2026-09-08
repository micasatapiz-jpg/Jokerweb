import 'reflect-metadata'
import { ConfigService } from '@nestjs/config'
import { Logger } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentCoreModule } from '../agent-core/agent-core.module.js'
import { AgentOutboxService } from '../agent-core/agent-outbox.service.js'
import { WhatsAppOutboxWorkerService } from './whatsapp-outbox-worker.service.js'

function setup() {
  const db = { $queryRaw: vi.fn().mockResolvedValue([{ conversationId: 'chat-a' }, { conversationId: 'chat-b' }]) }
  const delivery = { processAgentOutbox: vi.fn().mockResolvedValue({ status: 'SENT' }) }
  const worker = new WhatsAppOutboxWorkerService(new ConfigService(), db as never,
    { tenantId: 'tenant-test' } as never, delivery as never)
  return { db, delivery, worker }
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('Despachador persistente WhatsApp', () => {
  it('registra AgentOutboxService como proveedor además de exportarlo', () => {
    expect(Reflect.getMetadata('providers', AgentCoreModule)).toContain(AgentOutboxService)
  })

  it('consulta salidas independientemente de mensajes entrantes y delega las reservas', async () => {
    const h = setup()
    expect(await h.worker.processPending()).toEqual({ processed: 2 })
    expect(h.delivery.processAgentOutbox).toHaveBeenCalledWith('chat-a')
    expect(h.delivery.processAgentOutbox).toHaveBeenCalledWith('chat-b')
    expect(h.db.$queryRaw.mock.calls[0][1]).toBe('tenant-test')
  })

  it('no solapa ticks locales y vuelve a permitirlos al finalizar', async () => {
    const h = setup()
    let release!: (rows: Array<{ conversationId: string }>) => void
    h.db.$queryRaw.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const first = h.worker.processPending()
    expect(await h.worker.processPending()).toEqual({ processed: 0 })
    expect(h.db.$queryRaw).toHaveBeenCalledTimes(1)
    release([])
    await first
    await h.worker.processPending()
    expect(h.db.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('un envío fallido no bloquea los demás ni registra secretos', async () => {
    const h = setup()
    const logger = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    h.delivery.processAgentOutbox.mockRejectedValueOnce(new Error('secret-provider-body'))
    await h.worker.processPending()
    expect(h.delivery.processAgentOutbox).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(logger.mock.calls)).not.toContain('secret-provider-body')
  })

  it('recupera su bandera si falla la consulta y detiene el timer al cerrar', async () => {
    vi.useFakeTimers()
    const h = setup()
    h.db.$queryRaw.mockRejectedValueOnce(new Error('db unavailable'))
    await expect(h.worker.processPending()).rejects.toThrow('db unavailable')
    await h.worker.processPending()
    h.worker.onModuleInit()
    expect(vi.getTimerCount()).toBe(1)
    h.worker.onModuleDestroy()
    expect(vi.getTimerCount()).toBe(0)
  })
})
