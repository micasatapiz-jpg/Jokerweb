import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { AgentOrchestratorService } from './agent-orchestrator.service.js'

@Injectable()
export class AgentEventWorkerService {
  constructor(
    private readonly db: PrismaService,
    private readonly tenant: LocalTenantService,
    private readonly orchestrator: AgentOrchestratorService,
  ) {}

  private get tenantId() {
    return this.tenant.tenantId
  }

  /**
   * Procesa eventos persistidos que todavía no fueron consumidos.
   *
   * Importante:
   * - No borra eventos.
   * - No inventa acciones.
   * - No confirma pagos.
   * - No inicia producción.
   * - Solo intenta satisfacer condiciones de resume ya persistidas.
   */
  async processPendingEvents(limit = 100) {
    const safeLimit = Math.max(
      1,
      Math.min(limit, 100),
    )

    const events =
      await this.db.agentEvent.findMany({
        where: {
          tenantId: this.tenantId,
          consumedAt: null,
        },

        orderBy: {
          createdAt: 'asc',
        },

        take: safeLimit,
      })

    const results: Array<{
      eventId: string
      resumed: boolean
      workflowId?: string
      reason?: string
      error?: string
    }> = []

    for (const event of events) {
      try {
        const result =
          await this.orchestrator.resumeFromEvent(
            event.id,
          )

        if (result.resumed) {
          results.push({
            eventId: event.id,
            resumed: true,
            workflowId:
              result.workflowId,
          })

          continue
        }

        results.push({
          eventId: event.id,
          resumed: false,
          reason:
            result.reason,
        })
      } catch (error) {
        results.push({
          eventId: event.id,
          resumed: false,
          error:
            error instanceof Error
              ? error.message
              : 'UNKNOWN_ERROR',
        })
      }
    }

    return {
      scanned: events.length,
      resumed:
        results.filter(
          (item) =>
            item.resumed,
        ).length,
      results,
    }
  }

  /**
   * Convierte workflows WAITING_TIME vencidos
   * en eventos TIME_REACHED persistidos.
   *
   * El sourceKey determinístico hace la operación idempotente.
   */
  async createDueTimerEvents(
    now = new Date(),
  ) {
    const workflows =
      await this.orchestrator.dueWorkflows(
        now,
      )

    const events = []

    for (const workflow of workflows) {
      if (!workflow.wakeAt) {
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

      events.push(event)
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
   * Un ciclo completo del worker:
   *
   * 1. materializa timers vencidos;
   * 2. intenta reanudar eventos pendientes.
   *
   * Este método luego podrá ejecutarse
   * periódicamente y también después
   * de un reinicio del servidor.
   */
  async processOnce(
    now = new Date(),
  ) {
    const timers =
      await this.createDueTimerEvents(
        now,
      )

    const events =
      await this.processPendingEvents()

    return {
      timers,
      events,
    }
  }
}