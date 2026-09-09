import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import {
  createWorkflowSchema,
  emitAgentEventSchema,
  eventMatchesResumeCondition,
  isTerminalWorkflowState,
  isWaitingWorkflowState,
  waitForSchema,
  workflowStateSchema,
  type AgentEventType,
  type WorkflowState,
} from './agent-orchestrator.js'

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value))

@Injectable()
export class AgentOrchestratorService {
  constructor(
    private readonly db: PrismaService,
    private readonly tenant: LocalTenantService,
  ) {}

  private get tenantId() {
    return this.tenant.tenantId
  }

  async createWorkflow(raw: unknown) {
    const input = createWorkflowSchema.parse(raw)

    return this.db.$transaction(async (tx) => {
      if (input.conversationId) {
        const conversation = await tx.conversation.findFirst({
          where: {
            id: input.conversationId,
            tenantId: this.tenantId,
          },
        })

        if (!conversation) {
          throw new NotFoundException('Conversación no encontrada.')
        }
      }

      if (input.jobId) {
        const job = await tx.job.findFirst({
          where: {
            id: input.jobId,
            tenantId: this.tenantId,
          },
        })

        if (!job) {
          throw new NotFoundException('Trabajo no encontrado.')
        }

        if (
          input.conversationId &&
          job.conversationId &&
          job.conversationId !== input.conversationId
        ) {
          throw new ConflictException(
            'El trabajo no corresponde a la conversación indicada.',
          )
        }
      }

      if (input.taskId) {
        const task = await tx.task.findFirst({
          where: {
            id: input.taskId,
            tenantId: this.tenantId,
          },
        })

        if (!task) {
          throw new NotFoundException('Tarea no encontrada.')
        }

        if (
          input.jobId &&
          task.jobId &&
          task.jobId !== input.jobId
        ) {
          throw new ConflictException(
            'La tarea no corresponde al trabajo indicado.',
          )
        }

        if (
          input.conversationId &&
          task.conversationId &&
          task.conversationId !== input.conversationId
        ) {
          throw new ConflictException(
            'La tarea no corresponde a la conversación indicada.',
          )
        }
      }

      const prior = await tx.agentWorkflow.findUnique({
        where: {
          tenantId_requestKey: {
            tenantId: this.tenantId,
            requestKey: input.requestKey,
          },
        },
        include: {
          steps: {
            orderBy: {
              position: 'asc',
            },
          },
        },
      })

      if (prior) {
        const same =
          prior.objective === input.objective &&
          prior.conversationId === (input.conversationId ?? null) &&
          prior.jobId === (input.jobId ?? null) &&
          prior.taskId === (input.taskId ?? null)

        if (!same) {
          throw new ConflictException(
            'La clave del workflow ya corresponde a otra solicitud.',
          )
        }

        return prior
      }

      const workflow = await tx.agentWorkflow.create({
        data: {
          tenantId: this.tenantId,
          conversationId: input.conversationId,
          jobId: input.jobId,
          taskId: input.taskId,
          objective: input.objective,
          requestKey: input.requestKey,
          correlationKey: input.correlationKey,
          state: 'READY',
          currentStep: 0,
          planJson: json({
            steps: input.steps,
          }),
          contextJson: json(input.context ?? {}),
        },
      })

      await tx.agentWorkflowStep.createMany({
        data: input.steps.map((step, index) => ({
          tenantId: this.tenantId,
          workflowId: workflow.id,
          stepKey: step.stepKey,
          position: index,
          type: step.type,
          status: 'PENDING',
          inputJson: json(step.input ?? {}),
        })),
      })

      await this.audit(
        tx,
        'WORKFLOW_CREATED',
        workflow.id,
        {
          objective: workflow.objective,
          requestKey: workflow.requestKey,
          correlationKey: workflow.correlationKey,
        },
      )

      return tx.agentWorkflow.findUniqueOrThrow({
        where: {
          id: workflow.id,
        },
        include: {
          steps: {
            orderBy: {
              position: 'asc',
            },
          },
        },
      })
    })
  }

  async getWorkflow(id: string) {
    const workflow = await this.db.agentWorkflow.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        steps: {
          orderBy: {
            position: 'asc',
          },
        },
        events: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    })

    if (!workflow) {
      throw new NotFoundException('Workflow no encontrado.')
    }

    return workflow
  }

  async startWorkflow(id: string) {
    return this.transition(id, 'RUNNING')
  }

  async wait(id: string, raw: unknown) {
    const input = waitForSchema.parse(raw)

    return this.db.$transaction(async (tx) => {
      const workflow = await this.lockWorkflow(tx, id)

      if (isTerminalWorkflowState(workflow.state)) {
        throw new ConflictException(
          'No se puede poner en espera un workflow terminado.',
        )
      }

      const next = input.state

      if (
        workflow.state !== 'RUNNING' &&
        workflow.state !== 'READY' &&
        workflow.state !== 'NEEDS_HUMAN_REVIEW'
      ) {
        throw new ConflictException(
          `El workflow no puede pasar de ${workflow.state} a ${next}.`,
        )
      }

      const updated = await tx.agentWorkflow.update({
        where: {
          id: workflow.id,
        },
        data: {
          state: next,
          waitingForActorType: input.actorType ?? null,
          waitingReason: input.reason,
          resumeConditionJson: json(input.resumeCondition),
          wakeAt: input.wakeAt ?? null,
          version: {
            increment: 1,
          },
        },
      })

      const currentStep = await tx.agentWorkflowStep.findFirst({
        where: {
          tenantId: this.tenantId,
          workflowId: workflow.id,
          position: workflow.currentStep,
        },
      })

      if (currentStep) {
        await tx.agentWorkflowStep.update({
          where: {
            id: currentStep.id,
          },
          data: {
            status: 'WAITING',
          },
        })
      }

      await this.audit(
        tx,
        'WORKFLOW_WAITING',
        workflow.id,
        {
          state: next,
          waitingReason: input.reason,
          waitingForActorType: input.actorType ?? null,
          resumeCondition: input.resumeCondition,
        },
      )

      return updated
    })
  }

  async emitEvent(raw: unknown) {
    const input = emitAgentEventSchema.parse(raw)

    return this.db.$transaction(async (tx) => {
      if (input.workflowId) {
        const workflow = await tx.agentWorkflow.findFirst({
          where: {
            id: input.workflowId,
            tenantId: this.tenantId,
          },
        })

        if (!workflow) {
          throw new NotFoundException('Workflow no encontrado.')
        }
      }

      if (input.conversationId) {
        const conversation = await tx.conversation.findFirst({
          where: {
            id: input.conversationId,
            tenantId: this.tenantId,
          },
        })

        if (!conversation) {
          throw new NotFoundException('Conversación no encontrada.')
        }
      }

      if (input.jobId) {
        const job = await tx.job.findFirst({
          where: {
            id: input.jobId,
            tenantId: this.tenantId,
          },
        })

        if (!job) {
          throw new NotFoundException('Trabajo no encontrado.')
        }
      }

      const prior = await tx.agentEvent.findUnique({
        where: {
          tenantId_sourceKey: {
            tenantId: this.tenantId,
            sourceKey: input.sourceKey,
          },
        },
      })

      if (prior) {
        if (
          prior.type !== input.type ||
          prior.workflowId !== (input.workflowId ?? null) ||
          prior.conversationId !== (input.conversationId ?? null) ||
          prior.jobId !== (input.jobId ?? null)
        ) {
          throw new ConflictException(
            'La clave del evento ya fue usada con otro contenido.',
          )
        }

        return prior
      }

      return tx.agentEvent.create({
        data: {
          tenantId: this.tenantId,
          workflowId: input.workflowId,
          type: input.type,
          conversationId: input.conversationId,
          jobId: input.jobId,
          actorType: input.actorType,
          sourceKey: input.sourceKey,
          payloadJson: json(input.payload ?? {}),
        },
      })
    })
  }

  async resumeFromEvent(eventId: string) {
    return this.db.$transaction(async (tx) => {
      const event = await tx.agentEvent.findFirst({
        where: {
          id: eventId,
          tenantId: this.tenantId,
        },
      })

      if (!event) {
        throw new NotFoundException('Evento no encontrado.')
      }

      if (event.consumedAt) {
        return {
          resumed: false,
          reason: 'EVENT_ALREADY_CONSUMED' as const,
          event,
        }
      }

      const candidates = event.workflowId
        ? await tx.agentWorkflow.findMany({
            where: {
              id: event.workflowId,
              tenantId: this.tenantId,
            },
          })
        : await tx.agentWorkflow.findMany({
            where: {
              tenantId: this.tenantId,
              state: {
                in: [
                  'WAITING_CUSTOMER',
                  'WAITING_OWNER',
                  'WAITING_EMPLOYEE',
                  'WAITING_EXTERNAL',
                  'WAITING_APPROVAL',
                  'WAITING_TIME',
                ],
              },
              ...(event.conversationId
                ? {
                    OR: [
                      {
                        conversationId: event.conversationId,
                      },
                      {
                        conversationId: null,
                      },
                    ],
                  }
                : {}),
            },
            orderBy: {
              createdAt: 'asc',
            },
            take: 100,
          })

      const matches = candidates.filter((workflow) => {
        if (!isWaitingWorkflowState(workflow.state)) {
          return false
        }

        if (!workflow.resumeConditionJson) {
          return false
        }

        return eventMatchesResumeCondition(
          workflow.resumeConditionJson,
          {
            type: event.type as AgentEventType,
            conversationId: event.conversationId,
            jobId: event.jobId,
            actorType: event.actorType,
            payload: event.payloadJson,
          },
        )
      })

      if (matches.length === 0) {
        return {
          resumed: false,
          reason: 'NO_MATCHING_WORKFLOW' as const,
          event,
        }
      }

      if (matches.length > 1) {
        throw new ConflictException(
          'El evento coincide con más de un workflow. Se requiere revisión.',
        )
      }

      const workflow = await this.lockWorkflow(
        tx,
        matches[0]!.id,
      )

      if (!isWaitingWorkflowState(workflow.state)) {
        return {
          resumed: false,
          reason: 'WORKFLOW_NO_LONGER_WAITING' as const,
          event,
        }
      }

      if (!workflow.resumeConditionJson) {
        return {
          resumed: false,
          reason: 'WORKFLOW_WITHOUT_RESUME_CONDITION' as const,
          event,
        }
      }

      const stillMatches = eventMatchesResumeCondition(
        workflow.resumeConditionJson,
        {
          type: event.type as AgentEventType,
          conversationId: event.conversationId,
          jobId: event.jobId,
          actorType: event.actorType,
          payload: event.payloadJson,
        },
      )

      if (!stillMatches) {
        return {
          resumed: false,
          reason: 'EVENT_NO_LONGER_MATCHES' as const,
          event,
        }
      }

      const changed = await tx.agentWorkflow.updateMany({
        where: {
          id: workflow.id,
          tenantId: this.tenantId,
          version: workflow.version,
          state: workflow.state,
        },
        data: {
          state: 'RUNNING',
          waitingForActorType: null,
          waitingReason: null,
          resumeConditionJson: Prisma.JsonNull,
          wakeAt: null,
          version: {
            increment: 1,
          },
        },
      })

      if (changed.count !== 1) {
        throw new ConflictException(
          'El workflow cambió antes de poder reanudarlo.',
        )
      }

      await tx.agentWorkflowStep.updateMany({
        where: {
          tenantId: this.tenantId,
          workflowId: workflow.id,
          status: 'WAITING',
        },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      })

      await tx.agentEvent.update({
        where: {
          id: event.id,
        },
        data: {
          consumedAt: new Date(),
          workflowId: workflow.id,
        },
      })

      await this.audit(
        tx,
        'WORKFLOW_RESUMED',
        workflow.id,
        {
          eventId: event.id,
          eventType: event.type,
          sourceKey: event.sourceKey,
        },
      )

      return {
        resumed: true,
        workflowId: workflow.id,
        eventId: event.id,
      }
    })
  }

  async transition(
    id: string,
    rawState: unknown,
  ) {
    const next = workflowStateSchema.parse(rawState)

    return this.db.$transaction(async (tx) => {
      const workflow = await this.lockWorkflow(tx, id)

      if (workflow.state === next) {
        return workflow
      }

      if (isTerminalWorkflowState(workflow.state)) {
        throw new ConflictException(
          `El workflow ya terminó en estado ${workflow.state}.`,
        )
      }

      if (
        workflow.state === 'READY' &&
        next !== 'RUNNING' &&
        next !== 'CANCELLED' &&
        next !== 'FAILED' &&
        next !== 'NEEDS_HUMAN_REVIEW'
      ) {
        throw new ConflictException(
          `Transición inválida: ${workflow.state} → ${next}.`,
        )
      }

      const terminal =
        next === 'COMPLETED' ||
        next === 'CANCELLED' ||
        next === 'FAILED'

      const updated = await tx.agentWorkflow.update({
        where: {
          id: workflow.id,
        },
        data: {
          state: next,
          completedAt: terminal ? new Date() : null,
          waitingForActorType: null,
          waitingReason: null,
          resumeConditionJson: Prisma.JsonNull,
          wakeAt: null,
          version: {
            increment: 1,
          },
        },
      })

      await this.audit(
        tx,
        `WORKFLOW_${next}`,
        workflow.id,
        {
          fromState: workflow.state,
          toState: next,
        },
      )

      return updated
    })
  }

  async dueWorkflows(now = new Date()) {
    return this.db.agentWorkflow.findMany({
      where: {
        tenantId: this.tenantId,
        state: 'WAITING_TIME',
        wakeAt: {
          lte: now,
        },
      },
      orderBy: {
        wakeAt: 'asc',
      },
      take: 100,
    })
  }

  private async lockWorkflow(
    tx: Prisma.TransactionClient,
    id: string,
  ) {
    await tx.$queryRaw`
      SELECT id
      FROM "AgentWorkflow"
      WHERE id = ${id}::uuid
        AND "tenantId" = ${this.tenantId}::uuid
      FOR UPDATE
    `

    const workflow = await tx.agentWorkflow.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
    })

    if (!workflow) {
      throw new NotFoundException('Workflow no encontrado.')
    }

    return workflow
  }

  private audit(
    tx: Prisma.TransactionClient,
    action: string,
    workflowId: string,
    details: unknown,
  ) {
    return tx.auditLog.create({
      data: {
        tenantId: this.tenantId,
        action,
        entityType: 'AgentWorkflow',
        entityId: workflowId,
        details: json(details),
      },
    })
  }
}