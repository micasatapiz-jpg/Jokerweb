import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { AgentOrchestratorService } from './agent-orchestrator.service.js'
import { AgentEventWorkerService } from './agent-event-worker.service.js'
import { randomUUID } from 'node:crypto'

const TENANT_ID = randomUUID()

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

  it('reanuda automáticamente un evento pendiente al iniciar el worker', async () => {
    if (!db) return

    const workflow =
      await orchestrator.createWorkflow({
        objective:
          'Recuperar evento pendiente al iniciar',

        requestKey:
          `worker-bootstrap-${Date.now()}`,

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
          'Esperando conocimiento',

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
          `worker-bootstrap-event-${Date.now()}`,

        payload: {
          knowledgeId:
            'bootstrap-test',
        },
      })

    expect(
      event.consumedAt,
    ).toBeNull()

    const bootstrapConfig =
      new ConfigService({
        DATABASE_URL:
          process.env.TEST_DATABASE_URL ??
          process.env.DATABASE_URL,

        DEFAULT_TENANT_ID:
          TENANT_ID,
      })

    const bootstrapTenant =
      new LocalTenantService(
        bootstrapConfig,
      )

    const bootstrapWorker =
      new AgentEventWorkerService(
        db,
        bootstrapTenant,
        orchestrator,
      )

    bootstrapWorker.onApplicationBootstrap()

    try {
      const deadline =
        Date.now() + 5_000

      let current =
        await orchestrator.getWorkflow(
          workflow.id,
        )

      while (
        current.state !== 'RUNNING' &&
        Date.now() < deadline
      ) {
        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              100,
            ),
        )

        current =
          await orchestrator.getWorkflow(
            workflow.id,
          )
      }

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
    } finally {
      bootstrapWorker.onModuleDestroy()
    }
  })

  it('dos ciclos automáticos no duplican el mismo resume', async () => {
    if (!db) return

    const workflow =
      await orchestrator.createWorkflow({
        objective:
          'No duplicar resume automático',

        requestKey:
          `worker-auto-idempotent-${Date.now()}`,

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
          `worker-auto-idempotent-event-${Date.now()}`,

        payload: {},
      })

    await worker.processOnce()
    await worker.processOnce()

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

    const resumeAudits =
      await db.auditLog.findMany({
        where: {
          tenantId:
            TENANT_ID,

          entityType:
            'AgentWorkflow',

          entityId:
            workflow.id,

          action:
            'WORKFLOW_RESUMED',
        },
      })

    expect(
      resumeAudits.length,
    ).toBe(1)
  })

  it('dos réplicas concurrentes consumen el mismo evento una sola vez', async () => {
    if (!db) return

    const databaseUrl =
      process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL

    if (!databaseUrl) return

    /*
     * Segunda conexión PostgreSQL.
     *
     * Esto es importante:
     * no simulamos simplemente dos llamadas
     * sobre la misma conexión.
     *
     * Queremos representar dos instancias
     * reales del servidor.
     */
    const replicaConfig =
      new ConfigService({
        DATABASE_URL:
          databaseUrl,

        DEFAULT_TENANT_ID:
          TENANT_ID,
      })

    const replicaDb =
      new PrismaService(
        replicaConfig,
      )

    const replicaTenant =
      new LocalTenantService(
        replicaConfig,
      )

    const replicaOrchestrator =
      new AgentOrchestratorService(
        replicaDb,
        replicaTenant,
      )

    try {
      const workflow =
        await orchestrator.createWorkflow({
          objective:
            'Prueba de concurrencia entre réplicas',

          requestKey:
            `replica-race-${Date.now()}`,

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
            'Esperando evento concurrente',

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
            `replica-race-event-${Date.now()}`,

          payload: {},
        })

      expect(
        event.consumedAt,
      ).toBeNull()

      /*
       * Ambas réplicas intentan procesar
       * exactamente el mismo evento.
       *
       * El FOR UPDATE en AgentEvent debe
       * serializar las dos transacciones.
       */
      const [
        first,
        second,
      ] =
        await Promise.all([
          orchestrator.resumeFromEvent(
            event.id,
          ),

          replicaOrchestrator.resumeFromEvent(
            event.id,
          ),
        ])

      const results = [
        first,
        second,
      ]

      /*
       * Una sola réplica debe conseguir
       * reanudar el workflow.
       */
      expect(
        results.filter(
          (result) =>
            result.resumed,
        ).length,
      ).toBe(1)

      /*
       * La segunda debe encontrar el
       * evento ya consumido después
       * de esperar el lock.
       */
      expect(
        results.filter(
          (result) =>
            !result.resumed &&
            result.reason ===
              'EVENT_ALREADY_CONSUMED',
        ).length,
      ).toBe(1)

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
            id:
              event.id,
          },
        })

      expect(
        storedEvent.consumedAt,
      ).not.toBeNull()

      /*
       * La auditoría es una comprobación
       * adicional muy importante.
       *
       * Aunque existieron dos intentos,
       * solo puede existir un efecto
       * WORKFLOW_RESUMED.
       */
      const audits =
        await db.auditLog.findMany({
          where: {
            tenantId:
              TENANT_ID,

            entityType:
              'AgentWorkflow',

            entityId:
              workflow.id,

            action:
              'WORKFLOW_RESUMED',
          },
        })

      expect(
        audits.length,
      ).toBe(1)
    } finally {
      await replicaDb.$disconnect()
    }
  })
})
