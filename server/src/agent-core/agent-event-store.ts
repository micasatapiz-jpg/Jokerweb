import { ConflictException, NotFoundException } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client.js'
import { emitAgentEventSchema } from './agent-orchestrator.js'

/** Internal transactional boundary, never a public actor-authority endpoint. */
export async function emitStoredEvent(tx: Prisma.TransactionClient, tenantId: string, raw: unknown) {
  const input = emitAgentEventSchema.parse(raw)
  for (const [id, delegate] of [[input.workflowId, tx.agentWorkflow], [input.conversationId, tx.conversation], [input.jobId, tx.job]] as const) {
    if (id && !await (delegate.findFirst as Function)({ where: { id, tenantId } })) throw new NotFoundException('Fuente del evento fuera del tenant.')
  }
  const key = { tenantId, sourceKey: input.sourceKey }
  // Prisma can emulate an upsert for this compound relation schema. Serialize
  // the source key in PostgreSQL as well, so an emulated upsert cannot race.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':' + input.sourceKey}, 0))`
  const event = await tx.agentEvent.upsert({
    where: { tenantId_sourceKey: key }, update: {},
    create: { ...key, type: input.type, workflowId: input.workflowId, conversationId: input.conversationId,
      jobId: input.jobId, actorType: input.actorType, payloadJson: JSON.parse(JSON.stringify(input.payload ?? {})) },
  })
  if (event.type !== input.type || event.workflowId !== (input.workflowId ?? null) ||
      event.conversationId !== (input.conversationId ?? null) || event.jobId !== (input.jobId ?? null) ||
      event.actorType !== (input.actorType ?? null)) throw new ConflictException('La clave del evento ya corresponde a otra fuente.')
  return event
}

export async function deferStoredEvent(tx: Prisma.TransactionClient, tenantId: string, eventId: string, reason: string, now = new Date(), terminal = false) {
  const event = await tx.agentEvent.findFirstOrThrow({ where: { id: eventId, tenantId } })
  if (event.consumedAt || event.processingFailedAt) return event
  const attempts = event.processingAttempts + 1
  const failed = terminal || attempts >= 12
  const updated = await tx.agentEvent.update({ where: { id: eventId }, data: {
    processingAttempts: attempts, lastAttemptAt: now, lastProcessingReason: reason,
    nextAttemptAt: failed ? null : new Date(now.getTime() + Math.min(3600000, 5000 * 2 ** (attempts - 1))),
    processingFailedAt: failed ? now : null,
  } })
  await tx.auditLog.create({ data: { tenantId, entityType: 'AgentEvent', entityId: eventId,
    action: failed ? 'AGENT_EVENT_REVIEW_REQUIRED' : 'AGENT_EVENT_DEFERRED', details: { reason, attempts } } })
  return updated
}
