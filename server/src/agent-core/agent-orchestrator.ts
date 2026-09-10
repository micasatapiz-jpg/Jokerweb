import { z } from 'zod'
import { permissionSchema } from './actor-policy.js'

export const workflowStateSchema = z.enum([
  'READY',
  'RUNNING',
  'WAITING_CUSTOMER',
  'WAITING_OWNER',
  'WAITING_EMPLOYEE',
  'WAITING_EXTERNAL',
  'WAITING_APPROVAL',
  'WAITING_TIME',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'NEEDS_HUMAN_REVIEW',
])

export const workflowStepStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'WAITING',
  'COMPLETED',
  'FAILED',
  'SKIPPED',
])

export const workflowStepTypeSchema = z.enum([
  'UNDERSTAND',
  'CHECK_CONTEXT',
  'CHECK_POLICY',
  'EXECUTE_TOOL',
  'CREATE_TASK',
  'CREATE_OWNER_REVIEW',
  'ASK_CUSTOMER',
  'ASK_OWNER',
  'WAIT',
  'RESUME',
  'VERIFY_RESULT',
  'COMPLETE',
  'ESCALATE',
])

export const agentEventTypeSchema = z.enum([
  'CUSTOMER_MESSAGE_RECEIVED',
  'CUSTOMER_FILE_RECEIVED',
  'OWNER_MESSAGE_RECEIVED',
  'OWNER_REVIEW_RESOLVED',
  'APPROVAL_RESOLVED',
  'COMMERCIAL_KNOWLEDGE_CREATED',
  'COMMERCIAL_KNOWLEDGE_VERIFIED',
  'JOB_UPDATED',
  'JOB_REQUIREMENTS_UPDATED',
  'QUOTE_CREATED',
  'QUOTE_APPROVED',
  'PAYMENT_REPORTED',
  'PAYMENT_CONFIRMED',
  'DESIGN_FEEDBACK_RECEIVED',
  'SUPPLIER_MESSAGE_RECEIVED',
  'MANUAL_RESUME',
  'TIME_REACHED',
])

export const actorTypeSchema = z.enum([
  'CUSTOMER',
  'OWNER',
  'EMPLOYEE',
  'SUPPLIER',
  'SYSTEM',
  'AI_AGENT',
])

export type WorkflowState = z.infer<typeof workflowStateSchema>
export type WorkflowStepStatus = z.infer<typeof workflowStepStatusSchema>
export type WorkflowStepType = z.infer<typeof workflowStepTypeSchema>
export type AgentEventType = z.infer<typeof agentEventTypeSchema>

export const workflowStepInputSchema = z.object({
  stepKey: z.string().trim().min(1).max(120),
  type: workflowStepTypeSchema,
  input: z.json().optional(),
}).strict()

export const createWorkflowSchema = z.object({
  conversationId: z.uuid().optional(),
  jobId: z.uuid().optional(),
  taskId: z.uuid().optional(),

  objective: z.string().trim().min(1).max(500),

  requestKey: z.string().trim().min(1).max(250),
  correlationKey: z.string().trim().min(1).max(250).optional(),

  context: z.json().optional(),

  steps: z.array(workflowStepInputSchema).min(1).max(100),
}).strict()

export const waitForSchema = z.object({
  state: z.enum([
    'WAITING_CUSTOMER',
    'WAITING_OWNER',
    'WAITING_EMPLOYEE',
    'WAITING_EXTERNAL',
    'WAITING_APPROVAL',
    'WAITING_TIME',
  ]),

  actorType: actorTypeSchema.optional(),

  reason: z.string().trim().min(1).max(1000),

  resumeCondition: z.object({
    eventTypes: z.array(agentEventTypeSchema).min(1).max(10),

    conversationId: z.uuid().optional(),
    jobId: z.uuid().optional(),
    ownerReviewId: z.uuid().optional(),
    approvalId: z.uuid().optional(),
    knowledgeId: z.uuid().optional(),
    requiredFields: z.array(z.string().min(1)).max(40).optional(),
    fileType: z.enum(['IMAGE','DOCUMENT']).optional(),
    requiredPermission: permissionSchema.optional(),

    actorType: actorTypeSchema.optional(),
  }).strict(),

  wakeAt: z.coerce.date().optional(),
  followUp: z.object({
    firstDelayMs: z.number().int().min(60_000).max(30 * 86400_000).default(86400_000),
    secondDelayMs: z.number().int().min(60_000).max(30 * 86400_000).default(2 * 86400_000),
    backoff: z.number().min(1).max(10).default(2),
    maxFollowUps: z.number().int().min(0).max(10).default(2),
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.state === 'WAITING_TIME' && !value.wakeAt) {
    ctx.addIssue({
      code: 'custom',
      message: 'WAITING_TIME requiere wakeAt.',
      path: ['wakeAt'],
    })
  }

  if (value.state !== 'WAITING_TIME' && value.wakeAt) {
    ctx.addIssue({
      code: 'custom',
      message: 'wakeAt solo debe usarse con WAITING_TIME.',
      path: ['wakeAt'],
    })
  }

  if (
    value.state === 'WAITING_CUSTOMER' &&
    value.actorType &&
    value.actorType !== 'CUSTOMER'
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'WAITING_CUSTOMER solo puede esperar a CUSTOMER.',
      path: ['actorType'],
    })
  }

  if (
    value.state === 'WAITING_OWNER' &&
    value.actorType &&
    value.actorType !== 'OWNER'
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'WAITING_OWNER solo puede esperar a OWNER.',
      path: ['actorType'],
    })
  }

  if (
    value.state === 'WAITING_EMPLOYEE' &&
    value.actorType &&
    value.actorType !== 'EMPLOYEE'
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'WAITING_EMPLOYEE solo puede esperar a EMPLOYEE.',
      path: ['actorType'],
    })
  }
})

export const emitAgentEventSchema = z.object({
  workflowId: z.uuid().optional(),

  type: agentEventTypeSchema,

  conversationId: z.uuid().optional(),
  jobId: z.uuid().optional(),
  actorType: actorTypeSchema.optional(),

  sourceKey: z.string().trim().min(1).max(250),

  payload: z.json().optional(),
}).strict()

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>
export type WaitForInput = z.infer<typeof waitForSchema>
export type EmitAgentEventInput = z.infer<typeof emitAgentEventSchema>

export interface ResumeCondition {
  eventTypes: AgentEventType[]
  conversationId?: string
  jobId?: string
  ownerReviewId?: string
  approvalId?: string
  knowledgeId?: string
  requiredFields?: string[]
  fileType?: 'IMAGE'|'DOCUMENT'
  actorType?: z.infer<typeof actorTypeSchema>
}

export interface EventForMatching {
  type: AgentEventType
  conversationId?: string | null
  jobId?: string | null
  actorType?: z.infer<typeof actorTypeSchema> | null
  payload?: unknown
}

function payloadRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

/**
 * Decide únicamente si un evento satisface una condición persistida.
 *
 * No ejecuta herramientas.
 * No cambia precios.
 * No confirma pagos.
 * No inicia producción.
 * No hace inferencias lingüísticas.
 */
export function eventMatchesResumeCondition(
  rawCondition: unknown,
  event: EventForMatching,
): boolean {
  const condition = z.object({
    eventTypes: z.array(agentEventTypeSchema).min(1).max(10),
    conversationId: z.uuid().optional(),
    jobId: z.uuid().optional(),
    ownerReviewId: z.uuid().optional(),
    approvalId: z.uuid().optional(),
    knowledgeId: z.uuid().optional(),
    requiredFields: z.array(z.string().min(1)).max(40).optional(),
    fileType: z.enum(['IMAGE','DOCUMENT']).optional(),
    requiredPermission: permissionSchema.optional(),
    actorType: actorTypeSchema.optional(),
  }).strict().parse(rawCondition)

  if (!condition.eventTypes.includes(event.type)) {
    return false
  }

  if (
    condition.conversationId &&
    condition.conversationId !== event.conversationId
  ) {
    return false
  }

  if (
    condition.jobId &&
    condition.jobId !== event.jobId
  ) {
    return false
  }

  if (
    condition.actorType &&
    condition.actorType !== event.actorType
  ) {
    return false
  }

  const payload = payloadRecord(event.payload)
  if(condition.requiredFields?.some(key=>!Array.isArray(payload.fields)||!payload.fields.includes(key)))return false
  if(condition.fileType && payload.fileType!==condition.fileType)return false

  if (
    condition.ownerReviewId &&
    payload.ownerReviewId !== condition.ownerReviewId
  ) {
    return false
  }

  if (
    condition.approvalId &&
    payload.approvalId !== condition.approvalId
  ) {
    return false
  }

  if (
    condition.knowledgeId &&
    payload.knowledgeId !== condition.knowledgeId
  ) {
    return false
  }

  return true
}

/**
 * Prioridad de interrupciones que pueden modificar un workflow en espera.
 *
 * Esto es clasificación de dominio.
 * La autorización real continúa en SalesPolicy / actor policies /
 * workflows comerciales existentes.
 */
export const workflowInterruptSchema = z.enum([
  'NONE',
  'CHANGE_REQUEST',
  'CANCELLATION',
  'COMPLAINT',
  'HUMAN_REQUEST',
  'SECURITY',
])

export type WorkflowInterrupt = z.infer<typeof workflowInterruptSchema>

export function isTerminalWorkflowState(state: WorkflowState): boolean {
  return [
    'COMPLETED',
    'CANCELLED',
    'FAILED',
  ].includes(state)
}

export function isWaitingWorkflowState(state: WorkflowState): boolean {
  return [
    'WAITING_CUSTOMER',
    'WAITING_OWNER',
    'WAITING_EMPLOYEE',
    'WAITING_EXTERNAL',
    'WAITING_APPROVAL',
    'WAITING_TIME',
  ].includes(state)
}

export function canTransitionWorkflow(
  from: WorkflowState,
  to: WorkflowState,
): boolean {
  if (from === to) {
    return true
  }

  if (isTerminalWorkflowState(from)) {
    return false
  }

  const allowed: Record<WorkflowState, WorkflowState[]> = {
    READY: [
      'RUNNING',
      'CANCELLED',
      'NEEDS_HUMAN_REVIEW',
      'FAILED',
    ],

    RUNNING: [
      'WAITING_CUSTOMER',
      'WAITING_OWNER',
      'WAITING_EMPLOYEE',
      'WAITING_EXTERNAL',
      'WAITING_APPROVAL',
      'WAITING_TIME',
      'COMPLETED',
      'CANCELLED',
      'FAILED',
      'NEEDS_HUMAN_REVIEW',
    ],

    WAITING_CUSTOMER: [
      'RUNNING',
      'CANCELLED',
      'NEEDS_HUMAN_REVIEW',
      'FAILED',
    ],

    WAITING_OWNER: [
      'RUNNING',
      'CANCELLED',
      'NEEDS_HUMAN_REVIEW',
      'FAILED',
    ],

    WAITING_EMPLOYEE: [
      'RUNNING',
      'CANCELLED',
      'NEEDS_HUMAN_REVIEW',
      'FAILED',
    ],

    WAITING_EXTERNAL: [
      'RUNNING',
      'CANCELLED',
      'NEEDS_HUMAN_REVIEW',
      'FAILED',
    ],

    WAITING_APPROVAL: [
      'RUNNING',
      'CANCELLED',
      'NEEDS_HUMAN_REVIEW',
      'FAILED',
    ],

    WAITING_TIME: [
      'RUNNING',
      'CANCELLED',
      'NEEDS_HUMAN_REVIEW',
      'FAILED',
    ],

    COMPLETED: [],
    CANCELLED: [],
    FAILED: [],

    NEEDS_HUMAN_REVIEW: [
      'RUNNING',
      'CANCELLED',
      'FAILED',
    ],
  }

  return allowed[from].includes(to)
}
