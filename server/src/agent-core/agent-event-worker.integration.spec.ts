import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { AgentOrchestratorService } from './agent-orchestrator.service.js'
import { AgentEventWorkerService } from './agent-event-worker.service.js'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'

describe('AgentEventWorkerService integration', () => {
  let db: PrismaService
  let orchestrator: AgentOrchestratorService
  let worker: AgentEventWorkerService

  beforeAll(async () => {
    const databaseUrl =
      process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL

    if (!databaseUrl) {
      return
    }

    const config = new ConfigService({
      DATABASE_URL: databaseUrl,
      DEFAULT_TENANT_ID: TENANT_ID,
    })

    db = new PrismaService(config)

    const tenant =
      new LocalTenantService(config)

    orchestrator =
      new AgentOrchestratorService(
        db,
        tenant,
      )

    worker =
      new AgentEventWorkerService(
        db,
        tenant,
        orchestrator,
      )

    await db.tenant.upsert({
      where: {
        id: TENANT_ID,
      },

      create: {
        id: TENANT_ID,
        name: 'Joker Worker Test',
        slug: `joker-worker-test-${Date.now()}`,
      },

      update: {},
    })
  })

  afterAll(async () => {
    if (db) {
      await db.$disconnect()
    }
  })

  it('reanuda un workflow pendiente desde un evento persistido', async () => {
    if (!db) return

    const workflow =
      await orchestrator.createWorkflow({
        objective:
          'Esperar conocimiento comercial',

        requestKey:
          `worker-resume-${Date.now()}`,

        steps: [
          {
            stepKey:
              'wait-owner',

            type:
              'ASK_OWNER',
          },
        ],
      })

    await orchestrator.startWorkflow(
      workflow.id,
    )

    await orchestrator.wait(
      workflow.id,
      {
        state:
          'WAITING_OWNER',

        actorType:
          'OWNER',

        reason:
          'Falta conocimiento comercial',

        resumeCondition: {
          eventTypes: [
            'COMMERCIAL_KNOWLEDGE_VERIFIED',
          ],

          actorType:
            'OWNER',
        },
      },
    )

    const event =
      await orchestrator.emitEvent({
        workflowId:
          workflow.id,

        type:
          'COMMERCIAL_KNOWLEDGE_VERIFIED',

        actorType:
          'OWNER',

        sourceKey:
          `worker-event-${Date.now()}`,

        payload: {},
      })

    expect(
      event.consumedAt,
    ).toBeNull()

    const result =
      await worker.processPendingEvents()

    expect(
      result.resumed,
    ).toBeGreaterThanOrEqual(1)

    const current =
      await orchestrator.getWorkflow(
        workflow.id,
      )

    expect(
      current.state,
    ).toBe('RUNNING')

    const storedEvent =
      await db.agentEvent.findUniqueOrThrow({
        where: {
          id: event.id,
        },
      })

    expect(
      storedEvent.consumedAt,
    ).not.toBeNull()
  })

  it('un segundo ciclo no repite el mismo evento consumido', async () => {
    if (!db) return

    const workflow =
      await orchestrator.createWorkflow({
        objective:
          'Prueba de idempotencia del worker',

        requestKey:
          `worker-idempotent-${Date.now()}`,

        steps: [
          {
            stepKey:
              'wait-owner',

            type:
              'ASK_OWNER',
          },
        ],
      })

    await orchestrator.startWorkflow(
      workflow.id,
    )

    await orchestrator.wait(
      workflow.id,
      {
        state:
          'WAITING_OWNER',

        actorType:
          'OWNER',

        reason:
          'Esperando OWNER',

        resumeCondition: {
          eventTypes: [
            'OWNER_MESSAGE_RECEIVED',
          ],

          actorType:
            'OWNER',
        },
      },
    )

    const event =
      await orchestrator.emitEvent({
        workflowId:
          workflow.id,

        type:
          'OWNER_MESSAGE_RECEIVED',

        actorType:
          'OWNER',

        sourceKey:
          `worker-idempotent-event-${Date.now()}`,

        payload: {},
      })

    const first =
      await worker.processPendingEvents()

    expect(
      first.resumed,
    ).toBeGreaterThanOrEqual(1)

    const firstStored =
      await db.agentEvent.findUniqueOrThrow({
        where: {
          id: event.id,
        },
      })

    expect(
      firstStored.consumedAt,
    ).not.toBeNull()

    const second =
      await worker.processPendingEvents()

    const secondResult =
      second.results.find(
        (item) =>
          item.eventId === event.id,
      )

    expect(
      secondResult,
    ).toBeUndefined()

    const current =
      await orchestrator.getWorkflow(
        workflow.id,
      )

    expect(
      current.state,
    ).toBe('RUNNING')
  })

  it('crea TIME_REACHED para workflow vencido y lo reanuda', async () => {
    if (!db) return

    const workflow =
      await orchestrator.createWorkflow({
        objective:
          'Esperar temporizador',

        requestKey:
          `worker-timer-${Date.now()}`,

        steps: [
          {
            stepKey:
              'wait-time',

            type:
              'WAIT',
          },
        ],
      })

    await orchestrator.startWorkflow(
      workflow.id,
    )

    const wakeAt =
      new Date(
        Date.now() - 60_000,
      )

    await orchestrator.wait(
      workflow.id,
      {
        state:
          'WAITING_TIME',

        reason:
          'Seguimiento programado',

        resumeCondition: {
          eventTypes: [
            'TIME_REACHED',
          ],
        },

        wakeAt,
      },
    )

    const result =
      await worker.processOnce(
        new Date(),
      )

    expect(
      result.timers.due,
    ).toBeGreaterThanOrEqual(1)

    const current =
      await orchestrator.getWorkflow(
        workflow.id,
      )

    expect(
      current.state,
    ).toBe('RUNNING')

    const timerEvents =
      await db.agentEvent.findMany({
        where: {
          tenantId:
            TENANT_ID,

          workflowId:
            workflow.id,

          type:
            'TIME_REACHED',
        },
      })

    expect(
      timerEvents.length,
    ).toBe(1)

    expect(
      timerEvents[0]!.consumedAt,
    ).not.toBeNull()
  })

  it('no crea TIME_REACHED para un timer futuro', async () => {
    if (!db) return

    const workflow =
      await orchestrator.createWorkflow({
        objective:
          'Timer futuro',

        requestKey:
          `worker-future-timer-${Date.now()}`,

        steps: [
          {
            stepKey:
              'wait-time',

            type:
              'WAIT',
          },
        ],
      })

    await orchestrator.startWorkflow(
      workflow.id,
    )

    const wakeAt =
      new Date(
        Date.now() + 60 * 60 * 1000,
      )

    await orchestrator.wait(
      workflow.id,
      {
        state:
          'WAITING_TIME',

        reason:
          'Todavía no vence',

        resumeCondition: {
          eventTypes: [
            'TIME_REACHED',
          ],
        },

        wakeAt,
      },
    )

    await worker.processOnce(
      new Date(),
    )

    const current =
      await orchestrator.getWorkflow(
        workflow.id,
      )

    expect(
      current.state,
    ).toBe('WAITING_TIME')

    const timerEvents =
      await db.agentEvent.findMany({
        where: {
          tenantId:
            TENANT_ID,

          workflowId:
            workflow.id,

          type:
            'TIME_REACHED',
        },
      })

    expect(
      timerEvents.length,
    ).toBe(0)
  })
})