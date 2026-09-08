import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { Prisma, type AgentTurn, type Conversation } from '../generated/prisma/client.js'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { CommercialService } from './commercial.service.js'
import { ProductConfigurationService } from './product-configuration.service.js'
import { QuoteWorkflowService } from './quote-workflow.service.js'
import { CustomerToolsService, customerToolSchema } from './customer-tools.service.js'
import { transactionScope } from './transaction-scope.js'
import { durableSalesPlanSchema } from './durable-sales-plan.js'

const handleSchema = z.object({ turnId: z.uuid(), leaseOwner: z.uuid() }).strict()
export type TurnHandle = z.infer<typeof handleSchema>
const idsSchema = z.array(z.uuid()).min(1).max(30)
const storedJson = (value: unknown): Prisma.InputJsonValue => {
  const encoded = JSON.stringify(value ?? null)
  if (Buffer.byteLength(encoded) > 131072) throw new ConflictException('El resultado excede el límite de contexto del turno.')
  return JSON.parse(encoded)
}
const LEASE_MS = 90000
const MAX_ATTEMPTS = 3

// Internal decision plans may request review, never operator approval. Keep this
// list narrower than TaskType; it is not an arbitrary model-driven task endpoint.
const reviewPlanSchema = z.object({
  status: z.string(),
  task: z.enum(['CONTACT_CUSTOMER', 'HANDLE_COMPLAINT', 'CHECK_REQUIREMENT', 'CONFIRM_PAYMENT', 'CHECK_PRODUCT_RULE', 'APPROVE_QUOTE']),
  reply: z.string().trim().min(1).max(4000),
}).passthrough()
const reviewTypesByStatus: Record<string, readonly string[]> = {
  HANDOFF: ['CONTACT_CUSTOMER', 'HANDLE_COMPLAINT'],
  SUPPLIER: ['CHECK_REQUIREMENT'],
  PAYMENT_REVIEW: ['CONFIRM_PAYMENT'],
  RULE_NOT_CONFIGURED: ['CHECK_PRODUCT_RULE'],
  HUMAN_REVIEW: ['APPROVE_QUOTE'],
}

export function assertTurnLease(turn: Pick<AgentTurn, 'status' | 'leaseOwner' | 'leaseUntil'>, handle: TurnHandle, now = new Date()) {
  if (turn.status !== 'IN_PROGRESS' || turn.leaseOwner !== handle.leaseOwner || turn.leaseUntil <= now) throw new ConflictException('La reserva del turno expiró o pertenece a otro procesador.')
}

@Injectable()
export class AgentTurnsService {
  constructor(private readonly db: PrismaService, private readonly tenant: LocalTenantService) {}
  private get tenantId() { return this.tenant.tenantId }

  async claimNext(conversationId: string, quietMs = 10000) {
    z.uuid().parse(conversationId)
    z.number().int().min(1000).max(120000).parse(quietMs)
    return this.db.$transaction(async (tx) => {
      // Every turn operation locks conversation before turn/job to avoid inverse lock order.
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId}::uuid AND "tenantId" = ${this.tenantId}::uuid FOR UPDATE`
      const conversation = await tx.conversation.findFirst({ where: { id: conversationId, tenantId: this.tenantId } })
      if (!conversation) throw new NotFoundException('Conversación no encontrada.')
      if (['HANDOFF', 'CLOSED'].includes(conversation.status)) return { status: 'PAUSED' as const }
      const prior = await tx.agentTurn.findFirst({ where: { tenantId: this.tenantId, conversationId,
        status: { in: ['IN_PROGRESS', 'REQUIRES_REVIEW'] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
      const now = new Date()
      if (prior?.status === 'REQUIRES_REVIEW') return { status: 'REQUIRES_REVIEW' as const }
      if (prior && prior.leaseUntil > now) return { status: 'BUSY' as const }
      if (prior && prior.attempts >= MAX_ATTEMPTS) {
        await tx.agentTurn.update({ where: { id: prior.id }, data: { status: 'REQUIRES_REVIEW', failureCode: 'RETRY_LIMIT' } })
        await this.reviewTask(tx, prior, 'RETRY_LIMIT')
        return { status: 'REQUIRES_REVIEW' as const }
      }
      const leaseOwner = randomUUID(), leaseUntil = new Date(now.getTime() + LEASE_MS)
      if (prior) {
        const turn = await tx.agentTurn.update({ where: { id: prior.id }, data: { leaseOwner, leaseUntil, attempts: { increment: 1 }, failureCode: null } })
        return { status: 'CLAIMED' as const, handle: { turnId: turn.id, leaseOwner }, sourceMessageIds: idsSchema.parse(turn.sourceMessageIds), plan: turn.plan, recovered: true }
      }
      if (!conversation.lastInboundAt || conversation.lastInboundAt.getTime() > now.getTime() - quietMs) return { status: 'WAITING' as const }
      const messages = await tx.conversationMessage.findMany({ where: { conversationId, direction: 'INBOUND', status: 'BUFFERED', turnMemberships: { none: {} } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 30, select: { id: true } })
      if (!messages.length) return { status: 'EMPTY' as const }
      const sourceMessageIds = messages.map((message) => message.id)
      const turn = await tx.agentTurn.create({ data: { tenantId: this.tenantId, conversationId, sourceMessageIds, leaseOwner, leaseUntil } })
      await tx.agentTurnMessage.createMany({ data: sourceMessageIds.map((messageId) => ({ tenantId: this.tenantId, conversationId, turnId: turn.id, messageId })) })
      return { status: 'CLAIMED' as const, handle: { turnId: turn.id, leaseOwner }, sourceMessageIds, plan: null, recovered: false }
    })
  }

  private async withLease<T>(rawHandle: TurnHandle, action: (tx: Prisma.TransactionClient, turn: AgentTurn, conversation: Conversation) => Promise<T>): Promise<T> {
    const handle = handleSchema.parse(rawHandle)
    return this.db.$transaction(async (tx) => {
      const initial = await tx.agentTurn.findFirst({ where: { id: handle.turnId, tenantId: this.tenantId } })
      if (!initial) throw new NotFoundException('Turno no encontrado.')
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${initial.conversationId}::uuid AND "tenantId" = ${this.tenantId}::uuid FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM "AgentTurn" WHERE id = ${initial.id}::uuid AND "tenantId" = ${this.tenantId}::uuid FOR UPDATE`
      const turn = await tx.agentTurn.findFirstOrThrow({ where: { id: initial.id, tenantId: this.tenantId } })
      assertTurnLease(turn, handle)
      const conversation = await tx.conversation.findFirstOrThrow({ where: { id: turn.conversationId, tenantId: this.tenantId } })
      const result = await action(tx, turn, conversation)
      // A slow operation must not commit past its lease. All database effects roll back together.
      if (turn.leaseUntil <= new Date()) throw new ConflictException('La operación excedió la reserva del turno.')
      return result
    }, { maxWait: 10000, timeout: 30000 })
  }

  renew(handle: TurnHandle) {
    return this.withLease(handle, (tx, turn) => tx.agentTurn.update({ where: { id: turn.id }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } }))
  }

  savePlan(handle: TurnHandle, rawPlan: unknown) {
    const plan = storedJson(z.record(z.string(), z.json()).parse(rawPlan))
    return this.withLease(handle, async (tx, turn) => {
      if (turn.plan !== null) {
        if (!isDeepStrictEqual(turn.plan, plan)) throw new ConflictException('El turno ya tiene un plan persistido diferente.')
        return turn.plan
      }
      await tx.agentTurn.update({ where: { id: turn.id }, data: { plan } })
      return plan
    })
  }

  runCustomerTool(handle: TurnHandle, callId: string, rawTool: unknown) {
    z.string().min(1).max(150).parse(callId)
    const tool = customerToolSchema.parse(rawTool)
    const request = storedJson(tool)
    return this.withLease(handle, async (tx, turn) => {
      const prior = await tx.agentToolCall.findUnique({ where: { tenantId_turnId_callId: { tenantId: this.tenantId, turnId: turn.id, callId } } })
      if (prior) {
        if (!isDeepStrictEqual(prior.request, request)) throw new ConflictException('El identificador de herramienta ya tiene otros argumentos.')
        return prior.result
      }
      const scope = transactionScope(tx)
      const commercial = new CommercialService(scope, this.tenant)
      const tools = new CustomerToolsService(scope, this.tenant, commercial,
        new ProductConfigurationService(scope, this.tenant), new QuoteWorkflowService(scope, this.tenant))
      const result = storedJson(await tools.execute({ conversationId: turn.conversationId,
        sourceMessageIds: idsSchema.parse(turn.sourceMessageIds), callId }, tool))
      await tx.agentToolCall.create({ data: { tenantId: this.tenantId, turnId: turn.id, callId, request, result: result === null ? Prisma.JsonNull : result } })
      return result
    })
  }

  complete(handle: TurnHandle, rawReply: string) {
    const reply = z.string().trim().min(1).max(4000).parse(rawReply)
    return this.withLease(handle, async (tx, turn, conversation) => {
      if (conversation.status === 'CLOSED') throw new ConflictException('La conversación está cerrada.')
      const saved = turn.plan as Record<string, unknown> | null
      if (saved?.tools !== undefined) {
        const plan = durableSalesPlanSchema.parse(saved)
        const refs: Record<string, unknown> = {}
        for (const step of plan.tools) {
          const receipt = await tx.agentToolCall.findUnique({ where: { tenantId_turnId_callId: { tenantId: this.tenantId, turnId: turn.id, callId: step.callId } } })
          const args = Object.fromEntries(Object.entries(step.args).map(([key, value]) => [key,
            value === '$jobId' || value === '$revision' ? refs[value] : value]))
          const request = customerToolSchema.parse({ name: step.name, args })
          if (!receipt || !isDeepStrictEqual(receipt.request, request)) throw new ConflictException('El plan tiene herramientas pendientes o recibos diferentes.')
          const result = receipt.result as Record<string, unknown> | null
          if (result?.jobId) refs.$jobId = result.jobId
          if (typeof result?.requirementsRevision === 'number') refs.$revision = result.requirementsRevision
        }
      }
      let handoff = conversation.status === 'HANDOFF'
      if (saved?.task !== undefined) {
        const plan = reviewPlanSchema.parse(saved)
        if (!reviewTypesByStatus[plan.status]?.includes(plan.task)) throw new ConflictException('La tarea no corresponde al plan del turno.')
        // The source chat is known; do not guess a job or claim a payment has
        // been verified. Job-specific execution remains in the tool layer.
        await tx.task.upsert({ where: { tenantId_dedupeKey: { tenantId: this.tenantId, dedupeKey: `turn-plan:${turn.id}` } },
          create: { tenantId: this.tenantId, conversationId: turn.conversationId, type: plan.task,
            title: plan.reply.slice(0, 200), dedupeKey: `turn-plan:${turn.id}`,
            details: { turnId: turn.id, sourceMessageIds: idsSchema.parse(turn.sourceMessageIds), decisionStatus: plan.status } }, update: {} })
        if (plan.status === 'HANDOFF') {
          handoff = true
          await tx.conversation.update({ where: { id: conversation.id }, data: { status: 'HANDOFF' } })
        }
      }
      const text = handoff ? 'Claro, tu consulta queda pendiente de atención del encargado.' : reply
      const outbox = await tx.agentOutbox.create({ data: { tenantId: this.tenantId, turnId: turn.id, conversationId: turn.conversationId,
        sequence: 0, type: 'TEXT', payload: { text, handoffAcknowledgement: handoff } } })
      const result = { text, outboxId: outbox.id }
      await tx.agentTurn.update({ where: { id: turn.id }, data: { status: 'COMPLETED', result } })
      await tx.conversationMessage.updateMany({ where: { conversationId: turn.conversationId, direction: 'INBOUND',
        id: { in: idsSchema.parse(turn.sourceMessageIds) } }, data: { status: 'PROCESSED', processedAt: new Date() } })
      await tx.conversation.update({ where: { id: turn.conversationId }, data: { lastProcessedAt: new Date() } })
      return result
    })
  }

  fail(handle: TurnHandle, code: 'MODEL_UNAVAILABLE' | 'INVALID_PLAN' | 'TOOL_FAILED') {
    z.enum(['MODEL_UNAVAILABLE', 'INVALID_PLAN', 'TOOL_FAILED']).parse(code)
    return this.withLease(handle, async (tx, turn) => {
      await tx.agentTurn.update({ where: { id: turn.id }, data: { status: 'REQUIRES_REVIEW', failureCode: code } })
      await this.reviewTask(tx, turn, code)
      return { status: 'REQUIRES_REVIEW' as const }
    })
  }

  private reviewTask(tx: Prisma.TransactionClient, turn: AgentTurn, code: string) {
    return tx.task.upsert({ where: { tenantId_dedupeKey: { tenantId: this.tenantId, dedupeKey: `turn-review:${turn.id}` } },
      create: { tenantId: this.tenantId, conversationId: turn.conversationId, type: 'CONTACT_CUSTOMER', title: 'Revisar turno que no pudo completarse',
        dedupeKey: `turn-review:${turn.id}`, details: { turnId: turn.id, code } }, update: {} })
  }
}
