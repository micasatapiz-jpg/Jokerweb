import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { AgentOrchestratorService } from './agent-orchestrator.service.js'
import { WorkflowStepRunnerService } from './workflow-step-runner.service.js'
import { deferStoredEvent } from './agent-event-store.js'
import { WaitFollowUpService } from './wait-follow-up.service.js'

const WORKER_INTERVAL_MS =
  2_000

/*
 * Evita que un solo workflow monopolice
 * completamente un ciclo del worker.
 *
 * Si hay más pasos determinísticos,
 * continuarán en el siguiente ciclo.
 */
const MAX_STEPS_PER_WORKFLOW_CYCLE =
  20

@Injectable()
export class AgentEventWorkerService
  implements
    OnApplicationBootstrap,
    OnModuleDestroy
{
  private readonly logger =
    new Logger(
      AgentEventWorkerService.name,
    )

  private timer:
    | ReturnType<typeof setInterval>
    | undefined

  private running =
    false

  constructor(
    private readonly db:
      PrismaService,

    private readonly tenant:
      LocalTenantService,

    private readonly orchestrator:
      AgentOrchestratorService,
  ) {}

  private get tenantId() {
    return this.tenant.tenantId
  }

  onApplicationBootstrap() {
    /*
     * Primer ciclo después de iniciar Nest.
     *
     * Esto recupera:
     *
     * - timers vencidos;
     * - eventos persistidos sin consumir;
     * - workflows que quedaron RUNNING
     *   antes de un reinicio/crash.
     */
    void this.runSafely()

    this.timer =
      setInterval(
        () => {
          void this.runSafely()
        },
        WORKER_INTERVAL_MS,
      )

    /*
     * El timer no debe impedir que
     * Node termine normalmente.
     */
    this.timer.unref?.()
  }

  onModuleDestroy() {
    if (
      this.timer
    ) {
      clearInterval(
        this.timer,
      )

      this.timer =
        undefined
    }
  }

  /**
   * Evita ejecutar dos ciclos simultáneos
   * dentro de la misma instancia.
   *
   * La protección entre réplicas vive
   * además en PostgreSQL mediante locks,
   * versiones e idempotencia.
   */
  private async runSafely() {
    if (
      this.running
    ) {
      return
    }

    this.running =
      true

    try {
      const result =
        await this.processOnce()

      if (
        result.events.resumed >
          0 ||
        result.workflows.stepsCompleted >
          0 ||
        result.workflows.completed >
          0
      ) {
        this.logger.debug(
          [
            `Eventos reanudados: ${result.events.resumed}`,
            `steps ejecutados: ${result.workflows.stepsCompleted}`,
            `workflows completados: ${result.workflows.completed}`,
          ].join(', '),
        )
      }
    } catch (error) {
      /*
       * Un ciclo fallido no debe matar
       * el servidor.
       *
       * El estado durable permanece
       * en PostgreSQL para el siguiente
       * intento.
       */
      this.logger.error(
        'Error procesando trabajo durable del agente.',
        error instanceof Error
          ? error.stack
          : String(error),
      )
    } finally {
      this.running =
        false
    }
  }

  /**
   * Procesa AgentEvent persistidos que
   * todavía no fueron consumidos.
   *
   * Este método solo satisface condiciones
   * WAIT/RESUME.
   *
   * La continuación de steps RUNNING ocurre
   * posteriormente en processRunnableWorkflows().
   */
  async processPendingEvents(
    limit = 100,
    now = new Date(),
  ) {
    const safeLimit =
      Math.max(
        1,
        Math.min(
          limit,
          100,
        ),
      )

    const events =
      await this.db.agentEvent.findMany({
        where: {
          tenantId:
            this.tenantId,

          consumedAt:
            null,

          processingFailedAt:
            null,

          OR: [
            {
              nextAttemptAt:
                null,
            },
            {
              nextAttemptAt: {
                lte:
                  now,
              },
            },
          ],
        },

        orderBy: {
          createdAt:
            'asc',
        },

        take:
          safeLimit,
      })

    const results:
      Array<{
        eventId: string
        resumed: boolean
        workflowId?: string
        reason?: string
        error?: string
      }> = []

    for (
      const event of
      events
    ) {
      try {
        const result =
          await this.orchestrator.resumeFromEvent(
            event.id,
            now,
          )

        if (
          result.resumed
        ) {
          results.push({
            eventId:
              event.id,

            resumed:
              true,

            workflowId:
              result.workflowId,
          })

          continue
        }

        results.push({
          eventId:
            event.id,

          resumed:
            false,

          reason:
            result.reason,
        })
      } catch (error) {
        /*
         * Persistimos el fallo del evento.
         *
         * No se elimina.
         * No se considera consumido.
         */
        await this.db.$transaction(
          async (
            tx,
          ) => {
            await tx.$queryRaw`
              SELECT id
              FROM "AgentEvent"
              WHERE id = ${event.id}::uuid
                AND "tenantId" = ${this.tenantId}::uuid
              FOR UPDATE
            `

            const current =
              await tx.agentEvent.findFirstOrThrow({
                where: {
                  id:
                    event.id,

                  tenantId:
                    this.tenantId,
                },
              })

            if (
              !current.nextAttemptAt ||
              current.nextAttemptAt <=
                now
            ) {
              await deferStoredEvent(
                tx,
                this.tenantId,
                event.id,
                'PROCESSING_ERROR',
                now,
              )
            }
          },
        )

        results.push({
          eventId:
            event.id,

          resumed:
            false,

          error:
            error instanceof Error
              ? error.message
              : 'UNKNOWN_ERROR',
        })
      }
    }

    return {
      scanned:
        events.length,

      resumed:
        results.filter(
          (
            item,
          ) =>
            item.resumed,
        ).length,

      results,
    }
  }

  /**
   * Continúa workflows persistidos cuyo
   * estado es RUNNING.
   *
   * Este método es deliberadamente
   * determinístico.
   *
   * No:
   *
   * - llama OpenAI;
   * - envía WhatsApp;
   * - confirma pagos;
   * - publica precios;
   * - inicia producción;
   * - inventa reglas.
   *
   * WorkflowStepRunnerService decide qué
   * tipos de step son seguros.
   */
  async processRunnableWorkflows(
    limit = 100,
  ) {
    const safeLimit =
      Math.max(
        1,
        Math.min(
          limit,
          100,
        ),
      )

    const workflows =
      await this.db.agentWorkflow.findMany({
        where: {
          tenantId:
            this.tenantId,

          state:
            'RUNNING',
        },

        orderBy: [
          {
            updatedAt:
              'asc',
          },
          {
            id:
              'asc',
          },
        ],

        take:
          safeLimit,

        select: {
          id:
            true,
        },
      })

    const runner =
      new WorkflowStepRunnerService(
        this.db,
        this.tenant,
      )

    const results:
      Array<{
        workflowId: string
        stepsCompleted: number
        completed: boolean
        reason?: string
      }> = []

    let totalStepsCompleted =
      0

    let totalCompleted =
      0

    for (
      const candidate of
      workflows
    ) {
      let stepsCompleted =
        0

      let completed =
        false

      let reason:
        string |
        undefined

      /*
       * Podemos ejecutar varios steps
       * determinísticos seguidos.
       *
       * Hay un límite para evitar loops
       * accidentales o monopolizar el worker.
       */
      for (
        let cycleStep = 0;
        cycleStep <
        MAX_STEPS_PER_WORKFLOW_CYCLE;
        cycleStep +=
          1
      ) {
        const workflow =
          await this.db.agentWorkflow.findFirst({
            where: {
              id:
                candidate.id,

              tenantId:
                this.tenantId,
            },

            include: {
              steps: {
                orderBy: {
                  position:
                    'asc',
                },
              },
            },
          })

        /*
         * Otra operación pudo eliminarlo
         * o cambiarlo antes de este punto.
         */
        if (
          !workflow
        ) {
          reason =
            'WORKFLOW_NOT_FOUND'

          break
        }

        /*
         * Otra réplica pudo haberlo terminado,
         * puesto en espera o enviado a revisión.
         */
        if (
          workflow.state !==
          'RUNNING'
        ) {
          reason =
            `WORKFLOW_STATE_${workflow.state}`

          break
        }

        const currentPosition =
          workflow.currentStep

        const step =
          workflow.steps.find(
            (
              item,
            ) =>
              item.position ===
              currentPosition,
          )

        /*
         * No quedan steps.
         *
         * Un workflow RUNNING sin un siguiente
         * step pendiente significa que su plan
         * terminó correctamente.
         */
        if (
          !step
        ) {
          await this.orchestrator.transition(
            workflow.id,
            'COMPLETED',
          )

          completed =
            true

          totalCompleted +=
            1

          reason =
            'WORKFLOW_COMPLETED'

          break
        }

        const result =
          await runner.run(
            workflow.id,
            step.stepKey,
          )

        if (
          result.status ===
          'COMPLETED'
        ) {
          stepsCompleted +=
            1

          totalStepsCompleted +=
            1

          continue
        }

        /*
         * REPLAY puede ocurrir si otra réplica
         * terminó el mismo step mientras esta
         * instancia estaba esperando el lock.
         *
         * Volvemos a leer el workflow antes
         * de asumir inconsistencia.
         */
        if (
          result.status ===
          'REPLAY'
        ) {
          const fresh =
            await this.db.agentWorkflow.findFirst({
              where: {
                id:
                  workflow.id,

                tenantId:
                  this.tenantId,
              },

              select: {
                state:
                  true,

                currentStep:
                  true,
              },
            })

          if (
            fresh?.state ===
              'RUNNING' &&
            fresh.currentStep ===
              currentPosition
          ) {
            /*
             * El step figura COMPLETED pero
             * currentStep no avanzó.
             *
             * Eso representa estado inconsistente,
             * así que no adivinamos.
             */
            await this.orchestrator.transition(
              workflow.id,
              'NEEDS_HUMAN_REVIEW',
            )

            reason =
              'INCONSISTENT_COMPLETED_STEP'

            break
          }

          /*
           * Otra réplica probablemente avanzó.
           * Releemos desde PostgreSQL.
           */
          continue
        }

        if (
          result.status ===
          'NOT_READY'
        ) {
          /*
           * Otra réplica pudo haber avanzado
           * el step. Releeremos una vez más
           * en este mismo ciclo.
           */
          const fresh =
            await this.db.agentWorkflow.findFirst({
              where: {
                id:
                  workflow.id,

                tenantId:
                  this.tenantId,
              },

              select: {
                state:
                  true,

                currentStep:
                  true,
              },
            })

          if (
            fresh?.state ===
              'RUNNING' &&
            fresh.currentStep !==
              currentPosition
          ) {
            continue
          }

          reason =
            'STEP_NOT_READY'

          break
        }

        if (
          result.status ===
          'MODE_BLOCKED'
        ) {
          /*
           * ASSIST / HUMAN_TAKEOVER / PAUSED
           * preservan el workflow.
           *
           * Cuando vuelva a AUTO, un próximo
           * ciclo podrá continuar.
           */
          reason =
            'CONVERSATION_MODE_BLOCKED'

          break
        }

        if (
          result.status ===
          'RETRY_REQUIRED'
        ) {
          /*
           * El fallo ya quedó persistido
           * por WorkflowStepRunnerService.
           *
           * No hacemos un retry agresivo
           * dentro del mismo ciclo.
           */
          reason =
            'STEP_RETRY_REQUIRED'

          break
        }

        if (
          result.status ===
          'NEEDS_HUMAN_REVIEW'
        ) {
          reason =
            'STEP_NEEDS_HUMAN_REVIEW'

          break
        }

        if (result.status === 'WAITING_CUSTOMER') {
          reason = 'WAITING_CUSTOMER'
          break
        }

        /*
         * Fail closed para cualquier estado
         * futuro que todavía no entendamos.
         */
        reason =
          'UNKNOWN_STEP_RESULT'

        break
      }

      /*
       * Si alcanzó el presupuesto de steps,
       * simplemente continuará en otro ciclo.
       *
       * No lo marcamos como error porque un
       * plan válido puede contener muchos steps.
       */
      if (
        !completed &&
        !reason &&
        stepsCompleted >=
          MAX_STEPS_PER_WORKFLOW_CYCLE
      ) {
        reason =
          'CYCLE_STEP_LIMIT'
      }

      results.push({
        workflowId:
          candidate.id,

        stepsCompleted,

        completed,

        ...(reason
          ? {
              reason,
            }
          : {}),
      })
    }

    return {
      scanned:
        workflows.length,

      stepsCompleted:
        totalStepsCompleted,

      completed:
        totalCompleted,

      results,
    }
  }

  /**
   * Convierte WAITING_TIME vencidos
   * en eventos TIME_REACHED.
   *
   * sourceKey determinístico evita
   * duplicados.
   */
  async createDueTimerEvents(
    now = new Date(),
  ) {
    const workflows =
      await this.orchestrator.dueWorkflows(
        now,
      )

    const events =
      []

    for (
      const workflow of
      workflows
    ) {
      if (
        !workflow.wakeAt
      ) {
        continue
      }

      const event =
        await this.orchestrator.emitEvent({
          workflowId:
            workflow.id,

          type:
            'TIME_REACHED',

          conversationId:
            workflow.conversationId ??
            undefined,

          jobId:
            workflow.jobId ??
            undefined,

          actorType:
            'SYSTEM',

          sourceKey:
            `time-reached:${workflow.id}:${workflow.wakeAt.toISOString()}`,

          payload: {
            workflowId:
              workflow.id,

            scheduledWakeAt:
              workflow.wakeAt.toISOString(),

            observedAt:
              now.toISOString(),
          },
        })

      events.push(
        event,
      )
    }

    return {
      due:
        workflows.length,

      createdOrExisting:
        events.length,

      events,
    }
  }

  /**
   * Ciclo durable completo:
   *
   * 1. timers vencidos → AgentEvent
   * 2. AgentEvent → resume de workflows
   * 3. RUNNING → steps determinísticos
   *
   * El paso 3 también recupera workflows
   * que quedaron RUNNING antes de un crash.
   */
  async processOnce(
    now = new Date(),
  ) {
    const timers = {
      due:
        0,

      createdOrExisting:
        0,
    }

    const events = {
      scanned:
        0,

      resumed:
        0,
    }

    const workflows = {
      scanned:
        0,

      stepsCompleted:
        0,

      completed:
        0,
    }

    /*
     * El worker global enumera tenants
     * explícitamente habilitados.
     *
     * Cada tenant recibe servicios
     * completamente scopeados.
     */
    const tenants =
      await this.db.tenant.findMany({
        where: {
          agentProcessingEnabled:
            true,
        },

        select: {
          id:
            true,
        },

        orderBy: {
          id:
            'asc',
        },
      })

    for (
      const tenant of
      tenants
    ) {
      const scope = {
        tenantId:
          tenant.id,
      } as LocalTenantService

      const tenantOrchestrator =
        new AgentOrchestratorService(
          this.db,
          scope,
        )

      const processor =
        new AgentEventWorkerService(
          this.db,
          scope,
          tenantOrchestrator,
        )

      /*
       * 1. Recuperar timers.
       */
      const timerResult =
        await processor.createDueTimerEvents(
          now,
        )

      /*
       * 2. Consumir eventos y reanudar WAIT.
       */
      const eventResult =
        await processor.processPendingEvents(
          100,
          now,
        )

      /*
       * 3. Continuar workflows RUNNING.
       *
       * Esto incluye:
       *
       * - los recién reanudados;
       * - los que ya estaban RUNNING
       *   antes de reiniciar el servidor.
       */
      const workflowResult =
        await processor.processRunnableWorkflows(
          100,
        )

      await new WaitFollowUpService(this.db, scope).processDue(now)

      timers.due +=
        timerResult.due

      timers.createdOrExisting +=
        timerResult.createdOrExisting

      events.scanned +=
        eventResult.scanned

      events.resumed +=
        eventResult.resumed

      workflows.scanned +=
        workflowResult.scanned

      workflows.stepsCompleted +=
        workflowResult.stepsCompleted

      workflows.completed +=
        workflowResult.completed
    }

    return {
      timers,
      events,
      workflows,
    }
  }
}
