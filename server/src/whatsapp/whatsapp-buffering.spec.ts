import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { Logger } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { WhatsAppProcessorService } from './whatsapp-processor.service.js'
import { WhatsAppConversationsService } from './whatsapp-conversations.service.js'

function worker() {
  const messageId = randomUUID()

  const conversation = {
    id: randomUUID(),
    externalId: '51999000123',
    status: 'COLLECTING',
    greetedAt: null as Date | null,
    lastInboundAt: new Date(Date.now() - 30000),
    context: {},
    messages: [
      {
        id: messageId,
        conversationId: '',
        direction: 'INBOUND',
        type: 'TEXT',
        text: 'Hola',
        createdAt: new Date(),
      },
    ],
  }

  conversation.messages[0].conversationId = conversation.id

  const db = {
    conversation: {
      findFirst: vi
        .fn()
        .mockImplementation(async () => conversation),

      findMany: vi.fn().mockResolvedValue([]),

      update: vi.fn().mockResolvedValue({}),

      updateMany: vi
        .fn()
        .mockResolvedValue({ count: 1 }),
    },

    conversationMessage: {
      findMany: vi
        .fn()
        .mockImplementation(async () => conversation.messages),

      updateMany: vi
        .fn()
        .mockResolvedValue({ count: 1 }),
    },

    $transaction: vi
      .fn()
      .mockImplementation(
        async (queries: Promise<unknown>[]) =>
          Promise.all(queries),
      ),
  }

  const ai = {
    analyze: vi.fn(),
  }

  const communications = {
    transcribe: vi.fn(),
  }

  const gateway = {
    sendText: vi.fn().mockResolvedValue({}),
    downloadMedia: vi.fn(),
  }

  const interpreter = {
    interpret: vi.fn().mockResolvedValue({
      intent: 'VENTA_NUEVA',
      productQuery: null,
      newJobExplicit: false,
      selectedJobId: null,
      requirements: {},
      ambiguousMeasurement: false,
      filePurpose: 'UNKNOWN',
    }),
  }

  const handle = {
    turnId: randomUUID(),
    leaseOwner: randomUUID(),
  }

  const salesAgent = {
    interpreterContext: vi.fn().mockResolvedValue(undefined),
    executePlan: vi.fn().mockImplementation(async (_handle, plan) => plan.reply),
    preflightTurn: vi.fn().mockResolvedValue(null),
    claimTurn: vi.fn().mockResolvedValue({
      status: 'CLAIMED',
      handle,
      sourceMessageIds: [messageId],
      plan: null,
      recovered: false,
    }),

    prepareTurn: vi.fn().mockResolvedValue({
      plan: {
        status: 'NEEDS_INFO',
        reply:
          'Hola, cuéntame qué producto necesitas y te ayudo.',
      },
    }),

    saveTurnPlan: vi.fn().mockResolvedValue({}),

    finishTurn: vi.fn().mockResolvedValue({
      text:
        'Hola, cuéntame qué producto necesitas y te ayudo.',
      outboxId: randomUUID(),
    }),
  }

  const processor = new WhatsAppProcessorService(
    new ConfigService({
      WHATSAPP_DEBOUNCE_MS: '10000',
    }),
    db as any,
    {
      tenantId: randomUUID(),
    } as any,
    ai as any,
    communications as any,
    gateway as any,
    interpreter as any,
    salesAgent as any,
  )

  return {
    processor,
    conversation,
    db,
    ai,
    communications,
    gateway,
    interpreter,
    salesAgent,
    handle,
  }
}

describe(
  'WhatsApp: pausa del cliente y respeto de atención humana',
  () => {
    it('reanuda el plan guardado sin volver a interpretar ni prepararlo', async () => {
      const h = worker()
      h.salesAgent.claimTurn.mockResolvedValueOnce({
        status: 'CLAIMED', handle: h.handle,
        sourceMessageIds: [h.conversation.messages[0].id], recovered: true,
        plan: { status: 'NEEDS_INFO', reply: 'Respuesta guardada antes del reinicio' },
      } as never)
      await h.processor.processConversation(h.conversation.id)
      expect(h.interpreter.interpret).not.toHaveBeenCalled()
      expect(h.salesAgent.prepareTurn).not.toHaveBeenCalled()
      expect(h.salesAgent.saveTurnPlan).not.toHaveBeenCalled()
      expect(h.salesAgent.finishTurn).toHaveBeenCalledWith(h.handle, 'Respuesta guardada antes del reinicio')
    })

    it(
      'no procesa antes de que termine la pausa del cliente',
      async () => {
        const h = worker()

        h.conversation.lastInboundAt = new Date()

        await h.processor.processConversation(
          h.conversation.id,
        )

        expect(
          h.salesAgent.claimTurn,
        ).not.toHaveBeenCalled()

        expect(
          h.interpreter.interpret,
        ).not.toHaveBeenCalled()

        expect(
          h.salesAgent.finishTurn,
        ).not.toHaveBeenCalled()

        expect(
          h.gateway.sendText,
        ).not.toHaveBeenCalled()
      },
    )

    it(
      'después de la pausa entrega el bloque al nuevo Agent Core',
      async () => {
        const h = worker()

        await h.processor.processConversation(
          h.conversation.id,
        )

        expect(
          h.salesAgent.claimTurn,
        ).toHaveBeenCalledOnce()

        expect(
          h.salesAgent.claimTurn,
        ).toHaveBeenCalledWith(
          h.conversation.id,
          10000,
        )

        expect(
          h.interpreter.interpret,
        ).toHaveBeenCalledOnce()

        expect(
          h.salesAgent.prepareTurn,
        ).toHaveBeenCalledOnce()

        expect(
          h.salesAgent.saveTurnPlan,
        ).toHaveBeenCalledOnce()

        expect(
          h.salesAgent.finishTurn,
        ).toHaveBeenCalledOnce()

        /*
         * El procesador ya NO debe enviar directamente
         * por WhatsApp.
         *
         * finishTurn crea el AgentOutbox.
         * El envío real será responsabilidad del delivery.
         */
        expect(
          h.gateway.sendText,
        ).not.toHaveBeenCalled()

        expect(
          h.ai.analyze,
        ).not.toHaveBeenCalled()
      },
    )

    it(
      'si Agent Core falla el procesador registra ERROR sin enviar directamente',
      async () => {
        const h = worker()

        h.salesAgent.claimTurn.mockRejectedValueOnce(
          new Error('Fallo simulado'),
        )

        const log = vi
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined)

        try {
          await h.processor.processConversation(
            h.conversation.id,
          )
        } finally {
          log.mockRestore()
        }

        expect(
          h.gateway.sendText,
        ).not.toHaveBeenCalled()

        expect(
          h.db.conversation.updateMany,
        ).toHaveBeenCalledWith({
          where: {
            id: h.conversation.id,
            tenantId: expect.any(String),
            status: {
              notIn: ['HANDOFF', 'CLOSED'],
            },
          },
          data: {
            status: 'ERROR',
          },
        })
      },
    )

    it.each(['HANDOFF', 'CLOSED'])(
      'el estado %s detiene cualquier respuesta automática',
      async (status) => {
        const h = worker()

        h.conversation.status = status

        await h.processor.processConversation(
          h.conversation.id,
        )

        expect(
          h.salesAgent.claimTurn,
        ).not.toHaveBeenCalled()

        expect(
          h.interpreter.interpret,
        ).not.toHaveBeenCalled()

        expect(
          h.salesAgent.finishTurn,
        ).not.toHaveBeenCalled()

        expect(
          h.gateway.sendText,
        ).not.toHaveBeenCalled()

        expect(
          h.communications.transcribe,
        ).not.toHaveBeenCalled()
      },
    )

    it(
      'la consulta del worker excluye conversaciones de atención humana',
      async () => {
        const h = worker()

        await h.processor.processPending()

        expect(
          h.db.conversation.findMany,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status: {
                notIn: ['HANDOFF', 'CLOSED'],
              },
            }),
          }),
        )
      },
    )

    it(
      'un mensaje nuevo no reactiva un chat derivado',
      async () => {
        const conversation = {
          id: randomUUID(),
          status: 'HANDOFF',
          greetedAt: null,
        }

        const db = {
          $executeRaw:vi.fn().mockResolvedValue(1),
          agentEvent:{upsert:vi.fn().mockImplementation(async({create})=>({...create,workflowId:null,jobId:null}))},
          conversation: {
            findFirst:vi.fn().mockResolvedValue(conversation),
            upsert: vi
              .fn()
              .mockResolvedValue(conversation),

            update: vi.fn(),
          },

          conversationMessage: {
            findUnique: vi
              .fn()
              .mockResolvedValue(null),

            create: vi
              .fn()
              .mockResolvedValue({id:randomUUID()}),
          },
        }

        const service =
          new WhatsAppConversationsService(
            {...db,$transaction:async(work:Function)=>work(db)} as any,
            {
              tenantId: randomUUID(),
            } as any,
          )

        const result = await service.ingest({
          externalMessageId: 'msg-test',
          from: '51999000123',
          type: 'TEXT',
          text: 'Sigo esperando al dueño',
        })

        expect(
          result.conversation.status,
        ).toBe('HANDOFF')

        expect(
          result.conversation.greetedAt,
        ).toBeNull()

        expect(
          db.conversation.upsert.mock
            .calls[0][0].update,
        ).not.toHaveProperty('status')

        expect(
          db.conversation.update,
        ).not.toHaveBeenCalled()
      },
    )
  },
)
