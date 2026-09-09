import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { CommunicationsService } from '../communications/communications.service.js'
import { QuotePdfService } from '../quotes/quote-pdf.service.js'
import { QuotesService } from '../quotes/quotes.service.js'
import { Prisma } from '../generated/prisma/client.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { PrismaService } from '../database/prisma.service.js'
import { VisualProposalsService } from '../visual-proposals/visual-proposals.service.js'
import { AgentOutboxService } from '../agent-core/agent-outbox.service.js'
import { quoteWorkflowSnapshotSchema } from '../agent-core/quote-workflow.service.js'
import { WhatsAppGatewayService } from './whatsapp-gateway.service.js'
import { maySendAutomatically } from '../agent-core/actor-policy.js'

@Injectable()
export class WhatsAppDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: LocalTenantService,
    private readonly quotes: QuotesService,
    private readonly quotePdf: QuotePdfService,
    private readonly communications: CommunicationsService,
    private readonly visuals: VisualProposalsService,
    private readonly gateway: WhatsAppGatewayService,
    private readonly outbox: AgentOutboxService,
  ) {}

  async processAgentOutbox(conversationId: string) {
    const claimed = await this.outbox.claimNext(conversationId)

    if (claimed.status !== 'CLAIMED') {
      return claimed
    }

    if (claimed.type !== 'TEXT') {
      await this.outbox.uncertain(claimed.handle)

      throw new ConflictException(
        `El Agent Outbox todavía no tiene transporte configurado para mensajes ${claimed.type}.`,
      )
    }

    const payload = claimed.payload as {
      text?: unknown
    }

    if (
      typeof payload.text !== 'string' ||
      !payload.text.trim()
    ) {
      await this.outbox.uncertain(claimed.handle)

      throw new ConflictException(
        'El mensaje del Agent Outbox no contiene texto válido.',
      )
    }

    try {
      const sent = await this.gateway.sendTextRaw(
        {
          id: claimed.conversationId,
          externalId: claimed.externalId,
        },
        payload.text,
      )

      await this.outbox.acknowledge(
        claimed.handle,
        sent.externalMessageId,
      )

      return {
        status: 'SENT' as const,
        conversationId: claimed.conversationId,
        outboxId: claimed.handle.outboxId,
        externalMessageId: sent.externalMessageId,
        simulated: sent.simulated,
      }
    } catch (error) {
      await this.outbox
        .uncertain(claimed.handle)
        .catch(() => undefined)

      throw error
    }
  }

  async deliver(
    conversationId: string,
    quoteId: string,
  ) {
    const conversation =
      await this.prisma.conversation.findFirst({
        where: {
          id: conversationId,
          tenantId: this.tenant.tenantId,
          channel: 'WHATSAPP',
        },
      })

    if (!conversation) {
      throw new NotFoundException(
        'No encontramos la conversación de WhatsApp.',
      )
    }

    if (!maySendAutomatically(conversation)) throw new ConflictException('El modo actual del chat no permite envíos automáticos.')

    const quote =
      await this.quotes.get(quoteId)

    if (
      quote.status !== 'APPROVED' ||
      (
        quote.validUntil &&
        quote.validUntil <= new Date()
      )
    ) {
      throw new ConflictException(
        'Solo se puede enviar una cotización aprobada y vigente.',
      )
    }

    const phone = (
      value: string | null,
    ) =>
      value?.replace(/^\+/, '')

    if (
      !conversation.customerPhone ||
      !quote.customer.phone ||
      phone(conversation.customerPhone) !==
        phone(quote.customer.phone)
    ) {
      throw new ForbiddenException(
        'La cotización no corresponde al destinatario de WhatsApp.',
      )
    }

    if (quote.workflowSnapshot) {
      const snapshot =
        quoteWorkflowSnapshotSchema.parse(
          quote.workflowSnapshot,
        )

      const job =
        await this.prisma.job.findFirst({
          where: {
            id: snapshot.jobId,
            tenantId: this.tenant.tenantId,
            quoteId,
            conversationId,
            productId: snapshot.productId,
            requirementsRevision:
              snapshot.requirementsRevision,
            status: {
              in: [
                'REQUIERE_REVISION',
                'LISTO_PARA_COTIZAR',
                'COTIZADO',
                'ESPERANDO_CLIENTE',
              ],
            },
          },
        })

      if (!job) {
        throw new ConflictException(
          'Los requisitos, el trabajo o el canal cambiaron; revisa el presupuesto antes de enviarlo.',
        )
      }
    }

    const [
      {
        message,
        audio,
      },
      pdf,
    ] = await Promise.all([
      this.communications.speech(
        quoteId,
      ),
      this.quotePdf.render(
        quote,
      ),
    ])

    const visual =
      await this.prisma.visualProposal.findFirst(
        {
          where: {
            tenantId:
              this.tenant.tenantId,
            quoteId,
            status: 'GENERATED',
            outputStorageKey: {
              not: null,
            },
          },
          orderBy: {
            updatedAt: 'desc',
          },
        },
      )

    const visualBuffer =
      visual
        ? await this.visuals.image(
            visual.id,
          )
        : null

    await this.gateway.sendText(
      conversation,
      message.text,
    )

    if (visualBuffer) {
      await this.gateway.sendMedia(
        conversation,
        {
          type: 'image',
          buffer: visualBuffer,
          mimeType: 'image/png',
          fileName:
            `${quote.number}-propuesta.png`,
          caption:
            'Propuesta visual referencial',
        },
      )
    }

    await this.gateway.sendMedia(
      conversation,
      {
        type: 'document',
        buffer: pdf,
        mimeType: 'application/pdf',
        fileName:
          `${quote.number}.pdf`,
        caption:
          `Cotización ${quote.number}`,
      },
    )

    await this.gateway.sendMedia(
      conversation,
      {
        type: 'audio',
        buffer: audio,
        mimeType: 'audio/mpeg',
        fileName:
          `${quote.number}.mp3`,
      },
    )

    const previous =
      (conversation.context ??
        {}) as Record<
        string,
        unknown
      >

    await this.prisma.conversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        status: 'QUOTED',
        context: {
          ...previous,
          quoteId,
          pendingJobs: [],
        } as Prisma.InputJsonValue,
      },
    })

    return {
      delivered: true,
      simulated:
        this.gateway.mode ===
        'simulate',
      quoteId,
      includedVisual:
        Boolean(visualBuffer),
    }
  }
}
