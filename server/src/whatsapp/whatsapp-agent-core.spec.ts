import { describe, expect, it, vi } from 'vitest'
import { WhatsAppProcessorService } from './whatsapp-processor.service.js'

describe('WhatsAppProcessorService - Agent Core bridge', () => {
  it('prepara un turno persistente desde mensajes buffered', async () => {
    const conversationId = '11111111-1111-4111-8111-111111111111'
    const messageId = '22222222-2222-4222-8222-222222222222'

    const prisma = {
      conversationMessage: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: messageId,
            conversationId,
            direction: 'INBOUND',
            type: 'TEXT',
            text: 'Ya hice el Yape',
            createdAt: new Date(),
          },
        ]),
      },
    }

    const salesAgent = {
      interpreterContext: vi.fn().mockResolvedValue(undefined),
      claimTurn: vi.fn().mockResolvedValue({
        status: 'CLAIMED',
        handle: {
          turnId: '33333333-3333-4333-8333-333333333333',
          leaseOwner: '44444444-4444-4444-8444-444444444444',
        },
        sourceMessageIds: [messageId],
        plan: null,
        recovered: false,
      }),
      prepareTurn: vi.fn().mockResolvedValue({
        plan: {
          status: 'PAYMENT_REVIEW',
          reply: 'Gracias por avisarnos.',
          task: 'CONFIRM_PAYMENT',
        },
      }),
      saveTurnPlan: vi.fn().mockResolvedValue({
        status: 'PAYMENT_REVIEW',
      }),
    }

    const interpreter = {
      interpret: vi.fn().mockResolvedValue({
        intent: 'PAGO',
        productQuery: null,
        newJobExplicit: false,
        selectedJobId: null,
        requirements: {},
        ambiguousMeasurement: false,
        filePurpose: 'UNKNOWN',
      }),
    }

    const service = new WhatsAppProcessorService(
      {
        get: vi.fn((key: string, fallback?: string) => {
          if (key === 'WHATSAPP_DEBOUNCE_MS') return '10000'
          if (key === 'WHATSAPP_POLL_MS') return '1500'
          return fallback
        }),
      } as never,
      prisma as never,
      {
        tenantId: '55555555-5555-4555-8555-555555555555',
      } as never,
      {} as never,
      {} as never,
      {} as never,
      interpreter as never,
      salesAgent as never,
    )

    const result = await (
      service as unknown as {
        prepareAgentTurn: (conversationId: string) => Promise<{
          status: string
        }>
      }
    ).prepareAgentTurn(conversationId)

    expect(result.status).toBe('PREPARED')

    expect(salesAgent.claimTurn).toHaveBeenCalledWith(
      conversationId,
      10000,
    )

    expect(interpreter.interpret).toHaveBeenCalledWith({
      text: 'Ya hice el Yape',
      hasImage: false,
      hasDocument: false,
    })

    expect(salesAgent.prepareTurn).toHaveBeenCalled()

    expect(salesAgent.saveTurnPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: '33333333-3333-4333-8333-333333333333',
      }),
      expect.objectContaining({
        status: 'PAYMENT_REVIEW',
      }),
    )
  })

  it('no interpreta si no pudo reclamar un turno', async () => {
    const salesAgent = {
      claimTurn: vi.fn().mockResolvedValue({
        status: 'WAITING',
      }),
    }

    const interpreter = {
      interpret: vi.fn(),
    }

    const prisma = {
      conversationMessage: {
        findMany: vi.fn(),
      },
    }

    const service = new WhatsAppProcessorService(
      {
        get: vi.fn((key: string, fallback?: string) => {
          if (key === 'WHATSAPP_DEBOUNCE_MS') return '10000'
          if (key === 'WHATSAPP_POLL_MS') return '1500'
          return fallback
        }),
      } as never,
      prisma as never,
      {
        tenantId: '55555555-5555-4555-8555-555555555555',
      } as never,
      {} as never,
      {} as never,
      {} as never,
      interpreter as never,
      salesAgent as never,
    )

    const result = await (
      service as unknown as {
        prepareAgentTurn: (conversationId: string) => Promise<{
          status: string
        }>
      }
    ).prepareAgentTurn(
      '11111111-1111-4111-8111-111111111111',
    )

    expect(result.status).toBe('WAITING')
    expect(interpreter.interpret).not.toHaveBeenCalled()
    expect(prisma.conversationMessage.findMany).not.toHaveBeenCalled()
  })
})
