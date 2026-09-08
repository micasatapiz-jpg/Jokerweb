import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { CommercialService } from './commercial.service.js'
import { ContextBuilderService } from './context-builder.service.js'
import { ProductConfigurationService } from './product-configuration.service.js'
import { interpretationSchema, planSalesTurn } from './agent-decision.js'
import { Prisma } from '../generated/prisma/client.js'
import { AgentTurnsService, type TurnHandle } from './agent-turns.service.js'

// Shared chat/call core. Interpretation is injected by channel adapters; this service performs no model/network calls.
@Injectable()
export class SalesAgentService {
  constructor(private readonly db: PrismaService, private readonly tenant: LocalTenantService,
    private readonly commercial: CommercialService, private readonly contexts: ContextBuilderService,
    private readonly configurations: ProductConfigurationService, private readonly turns: AgentTurnsService) {}

  claimTurn(conversationId: string, quietMs?: number) {
    return this.turns.claimNext(conversationId, quietMs)
  }

  saveTurnPlan(handle: TurnHandle, plan: unknown) {
    return this.turns.savePlan(handle, plan)
  }

  executeCustomerTool(handle: TurnHandle, callId: string, tool: unknown) {
    return this.turns.runCustomerTool(handle, callId, tool)
  }

  finishTurn(handle: TurnHandle, reply: string) {
    return this.turns.complete(handle, reply)
  }

  renewTurn(handle: TurnHandle) {
    return this.turns.renew(handle)
  }

  async prepareTurn(conversationId: string, sourceMessageIds: string[], rawInterpretation: unknown) {
    const interpretation = interpretationSchema.parse(rawInterpretation)
    const tenantId = this.tenant.tenantId
    const conversation = await this.db.conversation.findFirst({ where: { id: conversationId, tenantId } })
    if (!conversation?.customerPhone) throw new NotFoundException('Chat no encontrado.')
    if (!sourceMessageIds.length || sourceMessageIds.length > 30) throw new ConflictException('El turno requiere entre 1 y 30 mensajes.')
    const messages = await this.db.conversationMessage.findMany({ where: { conversationId, direction: 'INBOUND', id: { in: sourceMessageIds } }, orderBy: { createdAt: 'asc' } })
    if (messages.length !== new Set(sourceMessageIds).size) throw new ConflictException('Hay mensajes que no pertenecen al turno.')
    const contact = await this.commercial.ensureContact({ phone: conversation.customerPhone, name: conversation.customerName ?? undefined })
    const context = await this.contexts.build(conversationId, contact.id, interpretation.selectedJobId ?? undefined)
    const productMatches = interpretation.productQuery ? await this.db.product.findMany({
      where: { tenantId, isActive: true, OR: [{ name: { equals: interpretation.productQuery, mode: 'insensitive' } }, { slug: interpretation.productQuery }] }, take: 2,
    }) : !interpretation.newJobExplicit && context.facts.job?.productId ? await this.db.product.findMany({ where: { tenantId, id: context.facts.job.productId, isActive: true }, take: 1 }) : []
    const product = productMatches.length === 1 ? productMatches[0] : null
    const configuration = product ? await this.configurations.get(product.id) : null
    const values = { ...(!interpretation.newJobExplicit ? context.facts.job?.requirements as Record<string, unknown> ?? {} : {}), ...interpretation.requirements }
    const text = messages.map((message) => message.text ?? '').join('\n')
    const plan = planSalesTurn({ interpretation, rules: configuration?.rules ?? null, productResolved: Boolean(product),
      jobAmbiguous: context.jobResolution === 'AMBIGUOUS' && !interpretation.newJobExplicit, values,
      hasFile: messages.some((message) => ['IMAGE', 'DOCUMENT'].includes(message.type)),
      whatsappImage: messages.some((message) => message.type === 'IMAGE'),
      spacePhotoDeclined: Boolean(conversation.spacePhotoDeclinedAt) || /sin foto|fondo neutro|no puedo.*foto/i.test(text),
      spacePhotoAsked: Boolean(conversation.spacePhotoAskedAt),
    })
    return { plan, interpretation, context, contact, product, configuration,
      sourceMessageIds: messages.map((message) => message.id), values }
  }

  async recordReviewTask(conversationId: string, sourceMessageIds: string[], rawInterpretation: unknown) {
    const turn = await this.prepareTurn(conversationId, sourceMessageIds, rawInterpretation)
    // A deterministic key keeps repeated webhook processing from creating duplicate review tasks.
    const digest = createHash('sha256').update(JSON.stringify([...new Set(sourceMessageIds)].sort())).digest('hex')
    const dedupeKey = `turn:${conversationId}:${digest}:${turn.plan.task ?? 'none'}`
    if (!turn.plan.task) return turn
    const task = await this.commercial.createTask({ conversationId,
      jobId: turn.interpretation.newJobExplicit ? undefined : turn.context.facts.job?.id, type: turn.plan.task, title: turn.plan.reply.slice(0, 200),
      dedupeKey,
      details: { sourceMessageIds, intent: turn.interpretation.intent, productId: turn.product?.id ?? null, status: turn.plan.status },
    })
    if (turn.interpretation.intent === 'PROVEEDOR') await this.db.contactProfile.update({ where: { id: turn.contact.id }, data: { type: 'PROVEEDOR' } })
    if (turn.plan.status === 'HANDOFF') await this.db.conversation.update({ where: { id: conversationId }, data: { status: 'HANDOFF' } })
    await this.db.auditLog.create({ data: { tenantId: this.tenant.tenantId, action: 'AGENT_REVIEW_TASK', entityType: 'Task', entityId: task.id,
      details: { sourceMessageIds, intent: turn.interpretation.intent } as Prisma.InputJsonValue } })
    return { ...turn, task }
  }
}
