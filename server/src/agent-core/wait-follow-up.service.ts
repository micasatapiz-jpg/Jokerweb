import { Injectable } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { isWaitingWorkflowState } from './agent-orchestrator.js'
import { record, waitContext } from './waiting-engine.js'

const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v))

/** Durable internal tasks only. No transport, money, approval or production actions. */
@Injectable()
export class WaitFollowUpService {
  constructor(private readonly db: PrismaService, private readonly tenant: LocalTenantService) {}

  async processDue(now = new Date(), limit = 100) {
    const tenantId = this.tenant.tenantId
    // Filter before limiting: disabled/exhausted waits cannot starve due reminders.
    const candidates = await this.db.$queryRaw<Array<{id: string}>>`
      SELECT id FROM "AgentWorkflow"
      WHERE "tenantId" = ${tenantId}::uuid
        AND state::text IN ('WAITING_CUSTOMER','WAITING_OWNER','WAITING_EMPLOYEE','WAITING_EXTERNAL','WAITING_APPROVAL')
        AND "contextJson"->'waiting'->>'status' = 'ACTIVE'
        AND "contextJson"->'waiting'->>'nextCheckAt' <= ${now.toISOString()}
      ORDER BY "contextJson"->'waiting'->>'nextCheckAt', id LIMIT ${Math.max(1, Math.min(100, limit))}
    `
    let created = 0
    for (const candidate of candidates) {
      created += await this.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "AgentWorkflow" WHERE id = ${candidate.id}::uuid AND "tenantId" = ${tenantId}::uuid FOR UPDATE`
        const workflow = await tx.agentWorkflow.findFirstOrThrow({where: {id: candidate.id, tenantId}})
        const waiting = waitContext(workflow)
        if (!isWaitingWorkflowState(workflow.state) || !waiting || waiting.status !== 'ACTIVE' || !waiting.nextCheckAt ||
          new Date(waiting.nextCheckAt) > now || waiting.followUpCount >= waiting.policy.maxFollowUps) return 0
        if (workflow.conversationId) {
          const chat = await tx.conversation.findFirstOrThrow({where: {id: workflow.conversationId, tenantId}})
          if (chat.automationMode !== 'AUTO') return 0
        }
        const context = record(workflow.contextJson)
        const condition = record(workflow.resumeConditionJson)
        let requirements: Record<string, unknown> = waiting.values
        if (workflow.jobId) {
          await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${workflow.jobId}::uuid AND "tenantId" = ${tenantId}::uuid FOR SHARE`
          const job = await tx.job.findFirstOrThrow({where: {id: workflow.jobId, tenantId}})
          if (['CANCELADO','ENTREGADO','PAUSADO','REQUIERE_HUMANO'].includes(job.status) ||
            typeof context.jobRevision === 'number' && context.jobRevision !== job.requirementsRevision) {
            // A changed revision is not permission to chase stale requirements.
            await tx.agentWorkflow.update({where: {id: workflow.id}, data: {contextJson: json({...context,
              waiting: {...waiting, nextCheckAt: null, reason: 'FOLLOW_UP_CONTEXT_CHANGED'}}), version: {increment: 1}}})
            return 0
          }
          // Job data can satisfy CUSTOMER data waits, never OWNER evidence/approval.
          if (workflow.state === 'WAITING_CUSTOMER') requirements = {...waiting.values, ...record(job.requirements)}
        }
        const missing = ((condition.requiredFields ?? []) as string[]).filter(key => {
          const value = requirements[key]
          return value == null || typeof value === 'string' && !value.trim() || typeof value === 'number' && (!Number.isFinite(value) || value <= 0)
        })
        const expectsFields = Array.isArray(condition.requiredFields) && condition.requiredFields.length > 0
        if (expectsFields && !missing.length && (!condition.fileType || waiting.evidence === condition.fileType)) return 0
        // Ingested/queued replies win over a reminder until the normal actor/buffer pipeline processes them.
        if (workflow.conversationId && await tx.conversationMessage.count({where: {conversationId: workflow.conversationId,
          direction: 'INBOUND', status: 'BUFFERED', createdAt: {gte: new Date(waiting.startedAt)}}})) return 0
        if (await tx.agentEvent.count({where: {tenantId, workflowId: workflow.id, consumedAt: null, processingFailedAt: null}})) return 0
        const ordinal = waiting.followUpCount + 1
        const dedupeKey = `wait-follow-up:${waiting.epoch}:${ordinal}`
        await tx.task.upsert({where: {tenantId_dedupeKey: {tenantId, dedupeKey}}, create: {
          tenantId, jobId: workflow.jobId, conversationId: workflow.conversationId, type: 'CHECK_REQUIREMENT',
          title: `Seguimiento pendiente: ${workflow.waitingForActorType ?? 'EXTERNAL'}`, dedupeKey,
          details: json({workflowId: workflow.id, waitEpoch: waiting.epoch, workflowVersion: workflow.version,
            ordinal, missingFields: missing, expectedActor: workflow.waitingForActorType, reason: workflow.waitingReason,
            authority: 'NO_COMMERCIAL_AUTHORIZATION', delivery: 'INTERNAL_ONLY'}),
        }, update: {}})
        const delay = Math.min(30 * 86400_000, waiting.policy.secondDelayMs * waiting.policy.backoff ** (ordinal - 1))
        await tx.agentWorkflow.update({where: {id: workflow.id}, data: {contextJson: json({...context, waiting: {...waiting,
          followUpCount: ordinal, nextCheckAt: ordinal >= waiting.policy.maxFollowUps ? null : new Date(now.getTime() + delay).toISOString()}}), version: {increment: 1}}})
        return 1
      })
    }
    return {scanned: candidates.length, created}
  }
}
