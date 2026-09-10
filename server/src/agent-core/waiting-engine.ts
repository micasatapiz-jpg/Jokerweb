import { z } from 'zod'
import type { AgentWorkflow, AgentEvent } from '../generated/prisma/client.js'
import { eventMatchesResumeCondition, isWaitingWorkflowState, waitForSchema } from './agent-orchestrator.js'

export const followUpPolicySchema = z.object({
  firstDelayMs: z.number().int().min(60_000).max(30 * 86400_000).default(86400_000),
  secondDelayMs: z.number().int().min(60_000).max(30 * 86400_000).default(2 * 86400_000),
  backoff: z.number().min(1).max(10).default(2),
  maxFollowUps: z.number().int().min(0).max(10).default(2),
}).strict()

export const waitingContextSchema = z.object({
  epoch: z.string().min(1), startedAt: z.iso.datetime(), status: z.enum(['ACTIVE', 'SATISFIED', 'SUPERSEDED', 'REQUIRES_HUMAN_REVIEW']),
  values: z.record(z.string(), z.json()).default({}),
  fields: z.array(z.string()).default([]), evidence: z.string().nullable().default(null),
  followUpCount: z.number().int().nonnegative().default(0),
  nextCheckAt: z.iso.datetime().nullable().default(null),
  policy: followUpPolicySchema,
  resumeCurrentStep: z.boolean().default(false),
  reason: z.string().nullable().default(null),
})
export type WaitingContext = z.infer<typeof waitingContextSchema>
export const record = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {}
export function waitContext(workflow: Pick<AgentWorkflow, 'contextJson'>): WaitingContext | null {
  const parsed = waitingContextSchema.safeParse(record(workflow.contextJson).waiting)
  return parsed.success ? parsed.data : null
}
export function newWaitContext(epoch: string, now: Date, policy?: unknown, resumeCurrentStep = false): WaitingContext {
  const config = followUpPolicySchema.parse(policy ?? {maxFollowUps: 0})
  return {epoch, startedAt: now.toISOString(), status: 'ACTIVE', values: {}, fields: [], evidence: null,
    followUpCount: 0, nextCheckAt: config.maxFollowUps ? new Date(now.getTime() + config.firstDelayMs).toISOString() : null,
    policy: config, resumeCurrentStep, reason: null}
}
export type WaitEvaluationKind = 'NOT_RELATED' | 'PARTIALLY_SATISFIED' | 'SATISFIED' | 'UPDATED' | 'SUPERSEDED' | 'STILL_WAITING' | 'REQUIRES_HUMAN_REVIEW'
export type WaitEvaluation = {kind: WaitEvaluationKind; waiting: WaitingContext | null; missingFields: string[]}

/** Pure decision. Event actors come from trusted ingestion/services, never from message text.
 * No commercial effect is authorized here. The orchestrator still applies its security gates. */
export function reevaluateWait(workflow: AgentWorkflow, event: Pick<AgentEvent, 'tenantId'|'workflowId'|'conversationId'|'jobId'|'actorType'|'type'|'payloadJson'|'createdAt'>): WaitEvaluation {
  const stored = waitContext(workflow)
  const condition = record(workflow.resumeConditionJson)
  const missing = (condition.requiredFields ?? []) as string[]
  const none = (kind: WaitEvaluationKind): WaitEvaluation => ({kind, waiting: stored, missingFields: missing})
  if (!isWaitingWorkflowState(workflow.state) || !workflow.resumeConditionJson || stored && stored.status !== 'ACTIVE') return none('NOT_RELATED')
  if (workflow.tenantId !== event.tenantId || event.workflowId && workflow.id !== event.workflowId ||
    workflow.jobId && workflow.jobId !== event.jobId || workflow.conversationId && event.conversationId && workflow.conversationId !== event.conversationId ||
    workflow.waitingForActorType && workflow.waitingForActorType !== event.actorType) return none('NOT_RELATED')
  if (!waitForSchema.shape.resumeCondition.safeParse(condition).success) {
    // Corrupt durable conditions must not become successful matches or endless retries.
    const waiting = stored ?? newWaitContext(`invalid:${workflow.id}`, workflow.updatedAt)
    return {kind: 'REQUIRES_HUMAN_REVIEW', waiting: {...waiting, status: 'REQUIRES_HUMAN_REVIEW', nextCheckAt: null, reason: 'INVALID_WAIT_CONDITION'}, missingFields: []}
  }
  const payload = record(event.payloadJson)
  if (payload.waitEpoch && payload.waitEpoch !== stored?.epoch) return none('NOT_RELATED')
  // Partial evidence belongs to an explicit workflow, not a broadcast across a chat.
  const structured = event.workflowId === workflow.id && payload.waitInput === true
  const base = {...condition}
  if (structured) { delete base.requiredFields; delete base.fileType }
  if (!eventMatchesResumeCondition(base, {...event, payload: event.payloadJson})) return none('NOT_RELATED')
  if (!structured) return none('SATISFIED')
  const waiting = stored ?? newWaitContext(`legacy:${workflow.id}:${workflow.currentStep}`, workflow.updatedAt)
  if (payload.supersede === true && event.actorType === 'CUSTOMER' && workflow.state === 'WAITING_CUSTOMER' && condition.fileType &&
    typeof payload.replacementProductId === 'string') {
    return {kind: 'SUPERSEDED', waiting: {...waiting, status: 'SUPERSEDED', nextCheckAt: null, reason: 'EXPLICIT_CUSTOMER_REPLACEMENT'}, missingFields: missing}
  }
  const incoming = record(payload.values)
  const accepted = Object.fromEntries(Object.entries(incoming).filter(([key, value]) => missing.includes(key) && value !== null && value !== '' && value !== undefined &&
    (typeof value !== 'number' || Number.isFinite(value) && value > 0)))
  const evidence = condition.fileType && payload.fileType === condition.fileType ? payload.fileType as string : waiting.evidence
  const fields = [...new Set([...waiting.fields, ...Object.keys(accepted)])]
  const values = {...waiting.values, ...accepted}
  const remaining = missing.filter(key => !fields.includes(key))
  if (!Object.keys(accepted).length && evidence === waiting.evidence) return none('NOT_RELATED')
  const next = {...waiting, values, fields, evidence}
  if (!remaining.length && (!condition.fileType || evidence === condition.fileType)) return {kind: 'SATISFIED', waiting: {...next, status: 'SATISFIED', nextCheckAt: null}, missingFields: []}
  const changed = Object.keys(accepted).some(key => key in waiting.values && waiting.values[key] !== accepted[key])
  const added = Object.keys(accepted).some(key => !(key in waiting.values)) || evidence !== waiting.evidence
  return {kind: changed ? 'UPDATED' : added ? 'PARTIALLY_SATISFIED' : 'STILL_WAITING', waiting: next, missingFields: remaining}
}
