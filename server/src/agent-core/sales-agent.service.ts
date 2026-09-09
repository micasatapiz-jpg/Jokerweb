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
import { executeDurableSalesPlan, type DurableSalesPlan } from './durable-sales-plan.js'
import { evaluateProductRules } from './product-configuration.schema.js'

// Shared chat/call core. Interpretation is injected by channel adapters; this service performs no model/network calls.
@Injectable()
export class SalesAgentService {
  constructor(private readonly db: PrismaService, private readonly tenant: LocalTenantService,
    private readonly commercial: CommercialService, private readonly contexts: ContextBuilderService,
    private readonly configurations: ProductConfigurationService, private readonly turns: AgentTurnsService) {}

  claimTurn(conversationId: string, quietMs?: number) {
    return this.turns.claimNext(conversationId, quietMs)
  }

  preflightTurn(handle: TurnHandle) { return this.turns.preflight(handle) }

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

  executePlan(handle: TurnHandle, plan: unknown) {
    return executeDurableSalesPlan(plan, async (callId, tool) => {
      await this.renewTurn(handle)
      return this.executeCustomerTool(handle, callId, tool)
    })
  }

  async interpreterContext(conversationId: string) {
    const conversation = await this.db.conversation.findFirst({ where: { id: conversationId, tenantId: this.tenant.tenantId } })
    if (!conversation?.customerPhone) throw new NotFoundException('Chat no encontrado.')
    const contact = await this.commercial.ensureContact({ phone: conversation.customerPhone, name: conversation.customerName ?? undefined })
    const context = await this.contexts.build(conversationId, contact.id)
    const products = await this.db.product.findMany({ where: { tenantId: this.tenant.tenantId, isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 100,
      select: { id: true, name: true, slug: true } })
    const catalog = await Promise.all(products.map(async p => ({ ...p, rules: (await this.configurations.get(p.id))?.rules ?? null })))
    // Never send commercialRates or prices to the interpreter.
    return { catalog, jobs: await this.commercial.findJobs(contact.id), context }
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
    let plan: DurableSalesPlan = { ...planSalesTurn({ interpretation, rules: configuration?.rules ?? null, productResolved: Boolean(product),
      jobAmbiguous: context.jobResolution === 'AMBIGUOUS' && !interpretation.newJobExplicit, values,
      hasFile: messages.some((message) => ['IMAGE', 'DOCUMENT'].includes(message.type)),
      whatsappImage: messages.some((message) => message.type === 'IMAGE'),
      spacePhotoDeclined: Boolean(conversation.spacePhotoDeclinedAt) || /sin foto|fondo neutro|no puedo.*foto/i.test(text),
      spacePhotoAsked: Boolean(conversation.spacePhotoAskedAt),
    }), tools: [] }
    const job = interpretation.newJobExplicit ? null : context.facts.job
    const step = (name: string, args: Record<string, any>) => plan.tools.push({ callId: `step-${plan.tools.length}-${name}`, name, args })
    if (context.jobResolution === 'AMBIGUOUS' && !interpretation.newJobExplicit && !['SOLICITA_HUMANO', 'RECLAMO'].includes(interpretation.intent)) {
      plan = { status: 'AMBIGUOUS_JOB', reply: 'Tienes varios trabajos. Indica el identificador del trabajo que quieres consultar: ' + context.candidateJobs.map(j => `${j.title} (${j.id})`).join('; '), tools: [] }
    } else if (interpretation.intent === 'PAGO' && job && ['ACEPTADO', 'ESPERANDO_ADELANTO', 'PAGO_POR_CONFIRMAR'].includes(job.status)) {
      delete plan.task
      step('updateJobStatus', { jobId: job.id, event: 'PAYMENT_REPORTED' })
    } else if (interpretation.intent === 'SEGUIMIENTO_PEDIDO' && job) {
      step('findQuote', { jobId: job.id })
    } else if (['VENTA_NUEVA', 'CLIENTE_EXISTENTE'].includes(interpretation.intent) && product) {
      if (job?.productId && job.productId !== product.id) {
        plan = { status: 'CLARIFY_NEW_JOB', reply: 'Ese producto es distinto al del trabajo actual. ¿Quieres crear otro trabajo aparte?', tools: [] }
      } else {
        if (!job) step('createJob', { title: product.name, requestSlot: 0 })
        const permitted = new Set([...Object.keys(configuration?.rules.quotationRules.fields ?? {}), 'location', 'designBrief', 'installationNotes', 'customerRequest'])
        const safeValues = Object.fromEntries(Object.entries(interpretation.requirements).filter(([key]) => permitted.has(key)))
        if (interpretation.ambiguousMeasurement) for (const m of configuration?.rules.commercialPricing?.measurements ?? []) safeValues[m.unitField] = null
        step('saveRequirements', { jobId: job?.id ?? '$jobId', productId: product.id, expectedRevision: job?.requirementsRevision ?? '$revision', values: safeValues })
        const evaluation = evaluateProductRules(configuration?.rules ?? null, values)
        const sameRequirements = job && Object.entries(safeValues).every(([key, value]) => (job.requirements as Record<string, unknown>)[key] === value)
        const existingQuote = sameRequirements && context.facts.quote && ['PENDING_APPROVAL', 'APPROVED'].includes(context.facts.quote.status)
        if (existingQuote) {
          delete plan.task
          plan.reply = 'Este trabajo ya tiene una cotización registrada. Consultaré si hay un importe aprobado vigente.'
          step('findQuote', { jobId: job.id })
        } else if (!interpretation.ambiguousMeasurement && evaluation.status !== 'MISSING_DATA' && plan.status !== 'CLARIFY_FILE') {
          delete plan.task
          step('calculateQuote', { jobId: job?.id ?? '$jobId', expectedRevision: '$revision' })
        }
      }
    }
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
