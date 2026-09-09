import { describe, expect, it } from 'vitest'
import {
  canTransitionWorkflow,
  createWorkflowSchema,
  emitAgentEventSchema,
  eventMatchesResumeCondition,
  isTerminalWorkflowState,
  isWaitingWorkflowState,
  waitForSchema,
} from './agent-orchestrator.js'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'
const UUID_D = '44444444-4444-4444-8444-444444444444'

describe('Agent Orchestrator contract', () => {
  it('acepta un workflow mínimo válido', () => {
    const result = createWorkflowSchema.parse({
      conversationId: UUID_A,
      jobId: UUID_B,
      objective: 'Completar cotización compuesta',
      requestKey: 'workflow:test:1',
      correlationKey: 'job:test:1',
      context: {
        productResolution: 'COMPOSITE',
      },
      steps: [
        {
          stepKey: 'understand',
          type: 'UNDERSTAND',
        },
        {
          stepKey: 'wait-owner',
          type: 'ASK_OWNER',
        },
        {
          stepKey: 'resume',
          type: 'RESUME',
        },
      ],
    })

    expect(result.objective).toBe(
      'Completar cotización compuesta',
    )

    expect(result.steps).toHaveLength(3)
  })

  it('rechaza workflow sin steps', () => {
    const result = createWorkflowSchema.safeParse({
      conversationId: UUID_A,
      objective: 'Workflow inválido',
      requestKey: 'workflow:test:empty',
      steps: [],
    })

    expect(result.success).toBe(false)
  })

  it('WAITING_OWNER acepta OWNER', () => {
    const result = waitForSchema.parse({
      state: 'WAITING_OWNER',
      actorType: 'OWNER',
      reason: 'Falta criterio comercial',
      resumeCondition: {
        eventTypes: [
          'COMMERCIAL_KNOWLEDGE_VERIFIED',
        ],
        jobId: UUID_B,
        actorType: 'OWNER',
      },
    })

    expect(result.state).toBe('WAITING_OWNER')
  })

  it('WAITING_OWNER rechaza CUSTOMER como actor esperado', () => {
    const result = waitForSchema.safeParse({
      state: 'WAITING_OWNER',
      actorType: 'CUSTOMER',
      reason: 'Configuración inválida',
      resumeCondition: {
        eventTypes: [
          'COMMERCIAL_KNOWLEDGE_VERIFIED',
        ],
        jobId: UUID_B,
      },
    })

    expect(result.success).toBe(false)
  })

  it('WAITING_CUSTOMER acepta CUSTOMER', () => {
    const result = waitForSchema.safeParse({
      state: 'WAITING_CUSTOMER',
      actorType: 'CUSTOMER',
      reason: 'Falta medida',
      resumeCondition: {
        eventTypes: [
          'CUSTOMER_MESSAGE_RECEIVED',
        ],
        conversationId: UUID_A,
        jobId: UUID_B,
        actorType: 'CUSTOMER',
      },
    })

    expect(result.success).toBe(true)
  })

  it('WAITING_TIME requiere wakeAt', () => {
    const result = waitForSchema.safeParse({
      state: 'WAITING_TIME',
      reason: 'Esperar seguimiento',
      resumeCondition: {
        eventTypes: [
          'TIME_REACHED',
        ],
      },
    })

    expect(result.success).toBe(false)
  })

  it('WAITING_TIME acepta wakeAt', () => {
    const result = waitForSchema.safeParse({
      state: 'WAITING_TIME',
      reason: 'Esperar seguimiento',
      resumeCondition: {
        eventTypes: [
          'TIME_REACHED',
        ],
      },
      wakeAt: '2026-09-10T10:00:00.000Z',
    })

    expect(result.success).toBe(true)
  })

  it('un evento correcto reanuda por tipo + job + actor', () => {
    const condition = {
      eventTypes: [
        'COMMERCIAL_KNOWLEDGE_VERIFIED',
      ],
      jobId: UUID_B,
      actorType: 'OWNER',
    }

    const matches = eventMatchesResumeCondition(
      condition,
      {
        type: 'COMMERCIAL_KNOWLEDGE_VERIFIED',
        jobId: UUID_B,
        actorType: 'OWNER',
        payload: {},
      },
    )

    expect(matches).toBe(true)
  })

  it('un evento de otro trabajo no reanuda', () => {
    const condition = {
      eventTypes: [
        'COMMERCIAL_KNOWLEDGE_VERIFIED',
      ],
      jobId: UUID_B,
      actorType: 'OWNER',
    }

    const matches = eventMatchesResumeCondition(
      condition,
      {
        type: 'COMMERCIAL_KNOWLEDGE_VERIFIED',
        jobId: UUID_C,
        actorType: 'OWNER',
        payload: {},
      },
    )

    expect(matches).toBe(false)
  })

  it('un evento de CUSTOMER no satisface condición OWNER', () => {
    const condition = {
      eventTypes: [
        'OWNER_MESSAGE_RECEIVED',
      ],
      conversationId: UUID_A,
      actorType: 'OWNER',
    }

    const matches = eventMatchesResumeCondition(
      condition,
      {
        type: 'OWNER_MESSAGE_RECEIVED',
        conversationId: UUID_A,
        actorType: 'CUSTOMER',
        payload: {},
      },
    )

    expect(matches).toBe(false)
  })

  it('ownerReviewId debe coincidir con payload', () => {
    const condition = {
      eventTypes: [
        'OWNER_REVIEW_RESOLVED',
      ],
      ownerReviewId: UUID_C,
    }

    expect(
      eventMatchesResumeCondition(
        condition,
        {
          type: 'OWNER_REVIEW_RESOLVED',
          payload: {
            ownerReviewId: UUID_C,
          },
        },
      ),
    ).toBe(true)

    expect(
      eventMatchesResumeCondition(
        condition,
        {
          type: 'OWNER_REVIEW_RESOLVED',
          payload: {
            ownerReviewId: UUID_D,
          },
        },
      ),
    ).toBe(false)
  })

  it('approvalId debe coincidir con payload', () => {
    const condition = {
      eventTypes: [
        'APPROVAL_RESOLVED',
      ],
      approvalId: UUID_C,
    }

    expect(
      eventMatchesResumeCondition(
        condition,
        {
          type: 'APPROVAL_RESOLVED',
          payload: {
            approvalId: UUID_C,
          },
        },
      ),
    ).toBe(true)

    expect(
      eventMatchesResumeCondition(
        condition,
        {
          type: 'APPROVAL_RESOLVED',
          payload: {
            approvalId: UUID_D,
          },
        },
      ),
    ).toBe(false)
  })

  it('knowledgeId debe coincidir con payload', () => {
    const condition = {
      eventTypes: [
        'COMMERCIAL_KNOWLEDGE_VERIFIED',
      ],
      knowledgeId: UUID_C,
    }

    expect(
      eventMatchesResumeCondition(
        condition,
        {
          type: 'COMMERCIAL_KNOWLEDGE_VERIFIED',
          payload: {
            knowledgeId: UUID_C,
          },
        },
      ),
    ).toBe(true)

    expect(
      eventMatchesResumeCondition(
        condition,
        {
          type: 'COMMERCIAL_KNOWLEDGE_VERIFIED',
          payload: {
            knowledgeId: UUID_D,
          },
        },
      ),
    ).toBe(false)
  })

  it('clasifica correctamente estados de espera', () => {
    expect(
      isWaitingWorkflowState(
        'WAITING_CUSTOMER',
      ),
    ).toBe(true)

    expect(
      isWaitingWorkflowState(
        'WAITING_OWNER',
      ),
    ).toBe(true)

    expect(
      isWaitingWorkflowState(
        'RUNNING',
      ),
    ).toBe(false)
  })

  it('clasifica estados terminales', () => {
    expect(
      isTerminalWorkflowState('COMPLETED'),
    ).toBe(true)

    expect(
      isTerminalWorkflowState('CANCELLED'),
    ).toBe(true)

    expect(
      isTerminalWorkflowState('FAILED'),
    ).toBe(true)

    expect(
      isTerminalWorkflowState('RUNNING'),
    ).toBe(false)
  })

  it('READY puede pasar a RUNNING', () => {
    expect(
      canTransitionWorkflow(
        'READY',
        'RUNNING',
      ),
    ).toBe(true)
  })

  it('RUNNING puede pasar a WAITING_OWNER', () => {
    expect(
      canTransitionWorkflow(
        'RUNNING',
        'WAITING_OWNER',
      ),
    ).toBe(true)
  })

  it('WAITING_OWNER puede volver a RUNNING', () => {
    expect(
      canTransitionWorkflow(
        'WAITING_OWNER',
        'RUNNING',
      ),
    ).toBe(true)
  })

  it('COMPLETED no puede volver a RUNNING', () => {
    expect(
      canTransitionWorkflow(
        'COMPLETED',
        'RUNNING',
      ),
    ).toBe(false)
  })

  it('CANCELLED no puede reactivarse', () => {
    expect(
      canTransitionWorkflow(
        'CANCELLED',
        'RUNNING',
      ),
    ).toBe(false)
  })

  it('acepta evento interno válido', () => {
    const result = emitAgentEventSchema.parse({
      workflowId: UUID_A,
      type: 'OWNER_REVIEW_RESOLVED',
      conversationId: UUID_B,
      jobId: UUID_C,
      actorType: 'OWNER',
      sourceKey: 'owner-review:test:1',
      payload: {
        ownerReviewId: UUID_D,
      },
    })

    expect(result.type).toBe(
      'OWNER_REVIEW_RESOLVED',
    )
  })

  it('rechaza tipo de evento inventado', () => {
    const result = emitAgentEventSchema.safeParse({
      type: 'CUSTOM_EVENT_INVENTED',
      sourceKey: 'event:test:bad',
    })

    expect(result.success).toBe(false)
  })
})