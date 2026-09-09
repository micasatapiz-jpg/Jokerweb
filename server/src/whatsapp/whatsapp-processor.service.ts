import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AIService } from '../ai/ai.service.js'
import { CommunicationsService } from '../communications/communications.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { PrismaService } from '../database/prisma.service.js'
import { WhatsAppGatewayService } from './whatsapp-gateway.service.js'
import { AgentInterpreterService } from '../agent-core/agent-interpreter.service.js'
import { SalesAgentService } from '../agent-core/sales-agent.service.js'
import { z } from 'zod'


@Injectable()
export class WhatsAppProcessorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WhatsAppProcessorService.name)
  private readonly debounceMs: number
  private readonly pollMs: number
  private timer?: NodeJS.Timeout
  private readonly processing = new Set<string>()

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tenant: LocalTenantService,
    private readonly ai: AIService,
    private readonly communications: CommunicationsService,
    private readonly gateway: WhatsAppGatewayService,
    private readonly interpreter: AgentInterpreterService,
    private readonly salesAgent: SalesAgentService,
  ) {
    this.debounceMs = Math.max(
      1000,
      Number(config.get<string>('WHATSAPP_DEBOUNCE_MS', '10000')),
    )

    this.pollMs = Math.max(
      500,
      Number(config.get<string>('WHATSAPP_POLL_MS', '1500')),
    )
  }

  onModuleInit() {
    this.timer = setInterval(
      () =>
        void this.salesAgent.expireWaitingConversations().then(()=>this.processPending()).catch((error) =>
          this.logger.error(error),
        ),
      this.pollMs,
    )

    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async processPending() {
    const cutoff = new Date(Date.now() - this.debounceMs)

    const conversations = await this.prisma.conversation.findMany({
      where: {
        tenantId: this.tenant.tenantId,
        channel: 'WHATSAPP',
        status: { notIn: ['HANDOFF', 'CLOSED'] },
        lastInboundAt: { lte: cutoff },
        messages: {
          some: {
            direction: 'INBOUND',
            status: 'BUFFERED',
          },
        },
      },
      orderBy: {
        lastInboundAt: 'asc',
      },
      take: 10,
    })

    await Promise.all(
      conversations.map((conversation) =>
        this.processConversation(conversation.id),
      ),
    )

    return {
      processed: conversations.length,
    }
  }

  private async prepareAgentTurn(conversationId: string) {
    const claim = await this.salesAgent.claimTurn(
      conversationId,
      this.debounceMs,
    )

    if (claim.status !== 'CLAIMED') {
      return claim
    }

    // A recovered turn must execute the saved decision, not reinterpret messages
    // against context that may have changed since the first attempt.
    if (claim.plan !== null) {
      const plan = z.object({
        status: z.string().min(1),
        reply: z.string().trim().min(1).max(4000),
      }).passthrough().parse(claim.plan)
      return { status: 'PREPARED' as const, claim, prepared: { plan } }
    }

    const controlled = await this.salesAgent.preflightTurn(claim.handle)
    if (controlled) return { status: 'PREPARED' as const, claim, prepared: { plan: z.object({ status:z.string(),reply:z.string() }).passthrough().parse(controlled) } }

    const messages = await this.prisma.conversationMessage.findMany({
      where: {
        id: {
          in: claim.sourceMessageIds,
        },
        conversationId,
        direction: 'INBOUND',
      },
      orderBy: {
        createdAt: 'asc',
      },
    })

    const text = messages
      .map((message) => message.text ?? '')
      .filter(Boolean)
      .join('\n')
      .trim()

    const interpreterContext = await this.salesAgent.interpreterContext(conversationId)
    const interpretation = await this.interpreter.interpret({
      text,
      ...(interpreterContext ? { context: interpreterContext } : {}),
      hasImage: messages.some(
        (message) => message.type === 'IMAGE',
      ),
      hasDocument: messages.some(
        (message) => message.type === 'DOCUMENT',
      ),
    })

    const prepared = await this.salesAgent.prepareTurn(
      conversationId,
      claim.sourceMessageIds,
      interpretation,
      claim.handle,
    )

    await this.salesAgent.saveTurnPlan(
      claim.handle,
      prepared.plan,
    )

    return {
      status: 'PREPARED' as const,
      claim,
      interpretation,
      prepared,
    }
  }

  async processConversation(conversationId: string) {
    if (this.processing.has(conversationId)) return

    this.processing.add(conversationId)

    try {
      const conversation = await this.prisma.conversation.findFirst({
        where: {
          id: conversationId,
          tenantId: this.tenant.tenantId,
        },
        include: {
          messages: {
            where: {
              direction: 'INBOUND',
              status: 'BUFFERED',
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      })

      if (!conversation || conversation.messages.length === 0) return

      if (['HANDOFF', 'CLOSED'].includes(conversation.status)) return

      if (
        !conversation.lastInboundAt ||
        conversation.lastInboundAt.getTime() >
          Date.now() - this.debounceMs
      ) {
        return
      }

      const prepared = await this.prepareAgentTurn(
        conversation.id,
      )

      if (prepared.status !== 'PREPARED') {
        return
      }

      const reply = await this.salesAgent.executePlan(prepared.claim.handle, prepared.prepared.plan)
      await this.salesAgent.finishTurn(
        prepared.claim.handle,
        reply,
      )

      this.logger.debug(
        `Turno Agent Core completado para ${conversation.id}`,
      )
    } catch (error) {
      this.logger.error(error)

      await this.prisma.conversation
        .updateMany({
          where: {
            id: conversationId,
            tenantId: this.tenant.tenantId,
            status: {
              notIn: ['HANDOFF', 'CLOSED'],
            },
          },
          data: {
            status: 'ERROR',
          },
        })
        .catch(() => undefined)
    } finally {
      this.processing.delete(conversationId)
    }
  }
}
