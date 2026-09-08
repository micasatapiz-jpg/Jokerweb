import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { WhatsAppDeliveryService } from './whatsapp-delivery.service.js'

function setup() {
  const conversation = {
    id: randomUUID(),
    customerPhone: '51999000123',
    context: {},
  }

  const quote = {
    id: randomUUID(),
    number: 'TEST',
    status: 'APPROVED',
    validUntil: new Date(Date.now() + 60000),
    customer: {
      phone: '+51999000123',
    },
    workflowSnapshot: null as unknown,
  }

  const db = {
    conversation: {
      findFirst: vi.fn().mockResolvedValue(conversation),
      update: vi.fn().mockResolvedValue({}),
    },

    job: {
      findFirst: vi.fn().mockResolvedValue(null),
    },

    visualProposal: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  }

  const communications = {
    speech: vi.fn().mockResolvedValue({
      message: {
        text: 'Texto fixture',
      },
      audio: Buffer.from('fixture'),
    }),
  }

  const pdf = {
    render: vi
      .fn()
      .mockResolvedValue(
        Buffer.from('fixture'),
      ),
  }

  const gateway = {
    mode: 'simulate',

    sendText: vi.fn(),

    sendMedia: vi.fn(),

    sendTextRaw: vi.fn().mockResolvedValue({
      simulated: true,
      externalMessageId: `sim-${randomUUID()}`,
    }),
  }

  const outbox = {
    claimNext: vi.fn(),

    acknowledge: vi
      .fn()
      .mockResolvedValue({}),

    uncertain: vi
      .fn()
      .mockResolvedValue({}),
  }

  const service =
    new WhatsAppDeliveryService(
      db as any,

      {
        tenantId: randomUUID(),
      } as any,

      {
        get: vi
          .fn()
          .mockImplementation(
            async () => quote,
          ),
      } as any,

      pdf as any,

      communications as any,

      {} as any,

      gateway as any,

      outbox as any,
    )

  return {
    service,
    db,
    conversation,
    quote,
    communications,
    pdf,
    gateway,
    outbox,
  }
}

describe(
  'Entrega de presupuestos: autorización antes de generar audio o enviar',
  () => {
    it.each([
      'DRAFT',
      'PENDING_APPROVAL',
      'REJECTED',
      'EXPIRED',
    ])(
      'no comunica %s al cliente',
      async (status) => {
        const h = setup()

        h.quote.status = status

        await expect(
          h.service.deliver(
            h.conversation.id,
            h.quote.id,
          ),
        ).rejects.toThrow(
          'aprobada y vigente',
        )

        expect(
          h.communications.speech,
        ).not.toHaveBeenCalled()

        expect(
          h.pdf.render,
        ).not.toHaveBeenCalled()

        expect(
          h.gateway.sendText,
        ).not.toHaveBeenCalled()
      },
    )

    it(
      'rechaza una cotización vencida aunque figure aprobada',
      async () => {
        const h = setup()

        h.quote.validUntil =
          new Date(0)

        await expect(
          h.service.deliver(
            h.conversation.id,
            h.quote.id,
          ),
        ).rejects.toThrow(
          'vigente',
        )

        expect(
          h.communications.speech,
        ).not.toHaveBeenCalled()
      },
    )

    it(
      'rechaza enviar datos de un cliente a otro número',
      async () => {
        const h = setup()

        h.quote.customer.phone =
          '51999000999'

        await expect(
          h.service.deliver(
            h.conversation.id,
            h.quote.id,
          ),
        ).rejects.toThrow(
          'destinatario',
        )

        expect(
          h.gateway.sendMedia,
        ).not.toHaveBeenCalled()

        expect(
          h.communications.speech,
        ).not.toHaveBeenCalled()
      },
    )

    it(
      'revalida el trabajo y la revisión de requisitos antes de preparar medios',
      async () => {
        const h = setup()

        const jobId = randomUUID()
        const productId = randomUUID()

        h.quote.workflowSnapshot = {
          jobId,
          productId,
          requirementsRevision: 2,
          configurationId:
            randomUUID(),
          configurationVersion: 1,
          priceRuleId:
            randomUUID(),
          priceRuleUpdatedAt:
            new Date().toISOString(),
        }

        await expect(
          h.service.deliver(
            h.conversation.id,
            h.quote.id,
          ),
        ).rejects.toThrow(
          'cambiaron',
        )

        expect(
          h.db.job.findFirst,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            where:
              expect.objectContaining({
                id: jobId,
                productId,
                quoteId:
                  h.quote.id,
                conversationId:
                  h.conversation.id,
                requirementsRevision:
                  2,
              }),
          }),
        )

        expect(
          h.communications.speech,
        ).not.toHaveBeenCalled()
      },
    )

    it(
      'permite un presupuesto aprobado del destinatario correcto usando solo servicios simulados',
      async () => {
        const h = setup()

        expect(
          (
            await h.service.deliver(
              h.conversation.id,
              h.quote.id,
            )
          ).delivered,
        ).toBe(true)

        expect(
          h.gateway.sendText,
        ).toHaveBeenCalledOnce()

        expect(
          h.gateway.sendMedia,
        ).toHaveBeenCalledTimes(2)
      },
    )
  },
)

describe(
  'Agent Outbox → WhatsApp',
  () => {
    it(
      'envía un mensaje TEXT del outbox y lo confirma',
      async () => {
        const h = setup()

        const outboxId =
          randomUUID()

        const leaseOwner =
          randomUUID()

        h.outbox.claimNext.mockResolvedValueOnce({
          status: 'CLAIMED',

          handle: {
            outboxId,
            leaseOwner,
          },

          type: 'TEXT',

          payload: {
            text:
              'Hola, esta es una respuesta del Agent Core.',
          },

          conversationId:
            h.conversation.id,

          externalId:
            '51999000123',
        })

        h.gateway.sendTextRaw.mockResolvedValueOnce({
          simulated: true,
          externalMessageId:
            'sim-outbox-test',
        })

        const result =
          await h.service.processAgentOutbox(
            h.conversation.id,
          )

        expect(
          result.status,
        ).toBe('SENT')

        expect(
          h.outbox.claimNext,
        ).toHaveBeenCalledWith(
          h.conversation.id,
        )

        expect(
          h.gateway.sendTextRaw,
        ).toHaveBeenCalledWith(
          {
            id:
              h.conversation.id,

            externalId:
              '51999000123',
          },

          'Hola, esta es una respuesta del Agent Core.',
        )

        expect(
          h.outbox.acknowledge,
        ).toHaveBeenCalledWith(
          {
            outboxId,
            leaseOwner,
          },

          'sim-outbox-test',
        )

        expect(
          h.outbox.uncertain,
        ).not.toHaveBeenCalled()

        expect(
          h.gateway.sendText,
        ).not.toHaveBeenCalled()
      },
    )

    it(
      'si no hay mensaje pendiente no intenta enviar',
      async () => {
        const h = setup()

        h.outbox.claimNext.mockResolvedValueOnce({
          status: 'EMPTY',
        })

        const result =
          await h.service.processAgentOutbox(
            h.conversation.id,
          )

        expect(
          result.status,
        ).toBe('EMPTY')

        expect(
          h.gateway.sendTextRaw,
        ).not.toHaveBeenCalled()

        expect(
          h.outbox.acknowledge,
        ).not.toHaveBeenCalled()
      },
    )

    it(
      'si el proveedor falla marca el intento como incierto',
      async () => {
        const h = setup()

        const outboxId =
          randomUUID()

        const leaseOwner =
          randomUUID()

        h.outbox.claimNext.mockResolvedValueOnce({
          status: 'CLAIMED',

          handle: {
            outboxId,
            leaseOwner,
          },

          type: 'TEXT',

          payload: {
            text:
              'Mensaje que falla',
          },

          conversationId:
            h.conversation.id,

          externalId:
            '51999000123',
        })

        h.gateway.sendTextRaw.mockRejectedValueOnce(
          new Error(
            'Meta no respondió',
          ),
        )

        await expect(
          h.service.processAgentOutbox(
            h.conversation.id,
          ),
        ).rejects.toThrow(
          'Meta no respondió',
        )

        expect(
          h.outbox.uncertain,
        ).toHaveBeenCalledWith({
          outboxId,
          leaseOwner,
        })

        expect(
          h.outbox.acknowledge,
        ).not.toHaveBeenCalled()
      },
    )

    it(
      'rechaza tipos de outbox todavía no soportados',
      async () => {
        const h = setup()

        const outboxId =
          randomUUID()

        const leaseOwner =
          randomUUID()

        h.outbox.claimNext.mockResolvedValueOnce({
          status: 'CLAIMED',

          handle: {
            outboxId,
            leaseOwner,
          },

          type: 'DOCUMENT',

          payload: {},

          conversationId:
            h.conversation.id,

          externalId:
            '51999000123',
        })

        await expect(
          h.service.processAgentOutbox(
            h.conversation.id,
          ),
        ).rejects.toThrow(
          'todavía no tiene transporte configurado',
        )

        expect(
          h.outbox.uncertain,
        ).toHaveBeenCalledWith({
          outboxId,
          leaseOwner,
        })

        expect(
          h.gateway.sendTextRaw,
        ).not.toHaveBeenCalled()
      },
    )
  },
)