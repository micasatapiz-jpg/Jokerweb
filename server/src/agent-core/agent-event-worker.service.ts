import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { AgentOrchestratorService } from './agent-orchestrator.service.js'
import { deferStoredEvent } from './agent-event-store.js'

const WORKER_INTERVAL_MS = 2_000

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

  private running = false

  constructor(
    private readonly db: PrismaService,
    private readonly tenant: LocalTenantService,
    private readonly orchestrator: AgentOrchestratorService,
  ) {}

  private get tenantId() {
    return this.tenant.tenantId
  }

  onApplicationBootstrap() {
    /*
     * Ejecutamos un primer ciclo después
     * de que Nest terminó de iniciar.
     *
     * Esto permite recuperar trabajo
     * pendiente después de reinicios.
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
     * El timer no debe impedir que Node
     * termine el proceso normalmente.
     */
    this.timer.unref?.()
  }

  onModuleDestroy() {
    if (this.timer) {
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
   * En el futuro también tendremos
   * protección explícita entre réplicas.
   */
  private async runSafely() {
    if (this.running) {
      return
    }

    this.running = true

    try {
      const result =
        await this.processOnce()

      if (
        result.events.resumed > 0
      ) {
        this.logger.debug(
          `Workflows reanudados: ${result.events.resumed}`,
        )
      }
    } catch (error) {
      /*
       * Un error en un ciclo no debe
       * matar el servidor.
       *
       * Como los eventos permanecen
       * persistidos, el siguiente ciclo
       * podrá volver a intentarlo.
       */
      this.logger.error(
        'Error procesando eventos del agente.',
        error instanceof Error
          ? error.stack
          : String(error),
      )
    } finally {
      this.running = false
    }
  }

  /**
   * Procesa eventos persistidos que
   * todavía no fueron consumidos.
   *
   * No:
   * - borra eventos;
   * - inventa acciones;
   * - confirma pagos;
   * - inicia producción;
   * - modifica reglas comerciales.
   *
   * Solo intenta satisfacer condiciones
   * de reanudación ya persistidas.
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
          processingFailedAt: null,
          OR: [{nextAttemptAt:null},{nextAttemptAt:{lte:now}}],
        },

        orderBy: {
          createdAt:
            'asc',
        },

        take:
          safeLimit,
      })

    const results: Array<{
      eventId: string
      resumed: boolean
      workflowId?: string
      reason?: string
      error?: string
    }> = []

    for (
      const event of events
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
        await this.db.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "AgentEvent" WHERE id=${event.id}::uuid AND "tenantId"=${this.tenantId}::uuid FOR UPDATE`
          const current=await tx.agentEvent.findFirstOrThrow({where:{id:event.id,tenantId:this.tenantId}})
          if(!current.nextAttemptAt || current.nextAttemptAt<=now)await deferStoredEvent(tx,this.tenantId,event.id,'PROCESSING_ERROR',now)
        })
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
          (item) =>
            item.resumed,
        ).length,

      results,
    }
  }

  /**
   * Convierte workflows WAITING_TIME
   * vencidos en eventos TIME_REACHED.
   *
   * El sourceKey determinístico evita
   * crear múltiples eventos equivalentes.
   */
  async createDueTimerEvents(
    now = new Date(),
  ) {
    const workflows =
      await this.orchestrator.dueWorkflows(
        now,
      )

    const events = []

    for (
      const workflow of workflows
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
   * Un ciclo completo:
   *
   * 1. crea eventos para timers vencidos;
   * 2. procesa eventos pendientes.
   *
   * Todo está respaldado por PostgreSQL,
   * por lo que un reinicio no pierde
   * el trabajo pendiente.
   */
  async processOnce(
    now = new Date(),
  ) {
    const timers={due:0,createdOrExisting:0},events={scanned:0,resumed:0}
    // Enumerate tenants with durable work. No default-tenant impersonation.
    const tenants=await this.db.tenant.findMany({where:{agentProcessingEnabled:true},select:{id:true},orderBy:{id:'asc'}})
    for(const tenant of tenants){
      const scope={tenantId:tenant.id} as LocalTenantService
      const processor=new AgentEventWorkerService(this.db,scope,new AgentOrchestratorService(this.db,scope))
      const timerResult=await processor.createDueTimerEvents(now)
      const eventResult=await processor.processPendingEvents(100,now)
      timers.due+=timerResult.due;timers.createdOrExisting+=timerResult.createdOrExisting
      events.scanned+=eventResult.scanned;events.resumed+=eventResult.resumed
    }
    return {timers,events}
  }
}
