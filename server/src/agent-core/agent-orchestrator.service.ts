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
  eventMatchesResumeCondition,
  isTerminalWorkflowState,
  isWaitingWorkflowState,
  waitForSchema,
  workflowStateSchema,
  type AgentEventType,
} from './agent-orchestrator.js'
import {
  deferStoredEvent,
  emitStoredEvent,
} from './agent-event-store.js'

const json = (
  value: unknown,
): Prisma.InputJsonValue =>
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
    const input =
      createWorkflowSchema.parse(raw)

    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(
              ${this.tenantId + ':workflow:' + input.requestKey},
              0
            )
          )
        `

        if (input.conversationId) {
          const conversation =
            await tx.conversation.findFirst({
              where: {
                id:
                  input.conversationId,

                tenantId:
                  this.tenantId,
              },
            })

          if (!conversation) {
            throw new NotFoundException(
              'Conversación no encontrada.',
            )
          }
        }

        if (input.jobId) {
          const job =
            await tx.job.findFirst({
              where: {
                id:
                  input.jobId,

                tenantId:
                  this.tenantId,
              },
            })

          if (!job) {
            throw new NotFoundException(
              'Trabajo no encontrado.',
            )
          }

          if (
            input.conversationId &&
            job.conversationId &&
            job.conversationId !==
              input.conversationId
          ) {
            throw new ConflictException(
              'El trabajo no corresponde a la conversación indicada.',
            )
          }
        }

        if (input.taskId) {
          const task =
            await tx.task.findFirst({
              where: {
                id:
                  input.taskId,

                tenantId:
                  this.tenantId,
              },
            })

          if (!task) {
            throw new NotFoundException(
              'Tarea no encontrada.',
            )
          }

          if (
            input.jobId &&
            task.jobId &&
            task.jobId !==
              input.jobId
          ) {
            throw new ConflictException(
              'La tarea no corresponde al trabajo indicado.',
            )
          }

          if (
            input.conversationId &&
            task.conversationId &&
            task.conversationId !==
              input.conversationId
          ) {
            throw new ConflictException(
              'La tarea no corresponde a la conversación indicada.',
            )
          }
        }

        const prior =
          await tx.agentWorkflow.findUnique({
            where: {
              tenantId_requestKey: {
                tenantId:
                  this.tenantId,

                requestKey:
                  input.requestKey,
              },
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

        if (prior) {
          const same =
            prior.objective ===
              input.objective &&
            prior.conversationId ===
              (
                input.conversationId ??
                null
              ) &&
            prior.jobId ===
              (
                input.jobId ??
                null
              ) &&
            prior.taskId ===
              (
                input.taskId ??
                null
              )

          if (!same) {
            throw new ConflictException(
              'La clave del workflow ya corresponde a otra solicitud.',
            )
          }

          return prior
        }

        const workflow =
          await tx.agentWorkflow.create({
            data: {
              tenantId:
                this.tenantId,

              conversationId:
                input.conversationId,

              jobId:
                input.jobId,

              taskId:
                input.taskId,

              objective:
                input.objective,

              requestKey:
                input.requestKey,

              correlationKey:
                input.correlationKey,

              state:
                'READY',

              currentStep:
                0,

              planJson:
                json({
                  steps:
                    input.steps,
                }),

              contextJson:
                json(
                  input.context ??
                    {},
                ),
            },
          })

        await tx.agentWorkflowStep.createMany({
          data:
            input.steps.map(
              (
                step,
                index,
              ) => ({
                tenantId:
                  this.tenantId,

                workflowId:
                  workflow.id,

                stepKey:
                  step.stepKey,

                position:
                  index,

                type:
                  step.type,

                status:
                  'PENDING',

                inputJson:
                  json(
                    step.input ??
                      {},
                  ),
              }),
            ),
        })

        await this.audit(
          tx,
          'WORKFLOW_CREATED',
          workflow.id,
          {
            objective:
              workflow.objective,

            requestKey:
              workflow.requestKey,

            correlationKey:
              workflow.correlationKey,
          },
        )

        return tx.agentWorkflow.findUniqueOrThrow({
          where: {
            id:
              workflow.id,
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
      },
    )
  }

  async getWorkflow(
    id: string,
  ) {
    const workflow =
      await this.db.agentWorkflow.findFirst({
        where: {
          id,
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

          events: {
            orderBy: {
              createdAt:
                'asc',
            },
          },
        },
      })

    if (!workflow) {
      throw new NotFoundException(
        'Workflow no encontrado.',
      )
    }

    return workflow
  }

  async startWorkflow(
    id: string,
  ) {
    return this.transition(
      id,
      'RUNNING',
    )
  }

  async wait(
    id: string,
    raw: unknown,
  ) {
    const input =
      waitForSchema.parse(raw)

    return this.db.$transaction(
      async (tx) => {
        const workflow =
          await this.lockWorkflow(
            tx,
            id,
          )

        if (
          isTerminalWorkflowState(
            workflow.state,
          )
        ) {
          throw new ConflictException(
            'No se puede poner en espera un workflow terminado.',
          )
        }

        const next =
          input.state

        if (
          workflow.state !==
            'RUNNING' &&
          workflow.state !==
            'READY' &&
          workflow.state !==
            'NEEDS_HUMAN_REVIEW'
        ) {
          throw new ConflictException(
            `El workflow no puede pasar de ${workflow.state} a ${next}.`,
          )
        }

        const updated =
          await tx.agentWorkflow.update({
            where: {
              id:
                workflow.id,
            },

            data: {
              state:
                next,

              waitingForActorType:
                input.actorType ??
                null,

              waitingReason:
                input.reason,

              resumeConditionJson:
                json(
                  input.resumeCondition,
                ),

              wakeAt:
                input.wakeAt ??
                null,

              version: {
                increment:
                  1,
              },
            },
          })

        const currentStep =
          await tx.agentWorkflowStep.findFirst({
            where: {
              tenantId:
                this.tenantId,

              workflowId:
                workflow.id,

              position:
                workflow.currentStep,
            },
          })

        if (currentStep) {
          await tx.agentWorkflowStep.update({
            where: {
              id:
                currentStep.id,
            },

            data: {
              status:
                'WAITING',
            },
          })
        }

        await this.audit(
          tx,
          'WORKFLOW_WAITING',
          workflow.id,
          {
            state:
              next,

            waitingReason:
              input.reason,

            waitingForActorType:
              input.actorType ??
              null,

            resumeCondition:
              input.resumeCondition,
          },
        )

        return updated
      },
    )
  }

  async emitEvent(
    raw: unknown,
  ) {
    return this.db.$transaction(
      (tx) =>
        emitStoredEvent(
          tx,
          this.tenantId,
          raw,
        ),
    )
  }

  async resumeFromEvent(
    eventId: string,
    now = new Date(),
  ): Promise<{
    resumed: boolean
    workflowId?: string
    eventId?: string
    reason?: string
    event?: unknown
  }> {
    return this.db.$transaction(
      async (tx) => {
        /*
         * Lock order:
         *
         * AgentEvent
         *    ↓
         * AgentWorkflow
         *
         * Dos réplicas pueden leer el mismo
         * evento desde el worker, pero solo
         * una puede procesarlo dentro de esta
         * transacción.
         */
        await tx.$queryRaw`
          SELECT id
          FROM "AgentEvent"
          WHERE id = ${eventId}::uuid
            AND "tenantId" = ${this.tenantId}::uuid
          FOR UPDATE
        `

        const event =
          await tx.agentEvent.findFirst({
            where: {
              id:
                eventId,

              tenantId:
                this.tenantId,
            },
          })

        if (!event) {
          throw new NotFoundException(
            'Evento no encontrado.',
          )
        }

        if (
          event.consumedAt
        ) {
          return {
            resumed:
              false,

            reason:
              'EVENT_ALREADY_CONSUMED',

            event,
          }
        }

        if (
          event.processingFailedAt ||
          (
            event.nextAttemptAt &&
            event.nextAttemptAt >
              now
          )
        ) {
          return {
            resumed:
              false,

            reason:
              'EVENT_DEFERRED',

            event,
          }
        }

        const defer =
          async (
            reason: string,
            terminal = false,
          ) => ({
            resumed:
              false as const,

            reason,

            event:
              await deferStoredEvent(
                tx,
                this.tenantId,
                event.id,
                reason,
                now,
                terminal,
              ),
          })

        const candidates =
          event.workflowId
            ? await tx.agentWorkflow.findMany({
                where: {
                  id:
                    event.workflowId,

                  tenantId:
                    this.tenantId,
                },
              })
            : await tx.agentWorkflow.findMany({
                where: {
                  tenantId:
                    this.tenantId,

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
                            conversationId:
                              event.conversationId,
                          },
                          {
                            conversationId:
                              null,
                          },
                        ],
                      }
                    : {}),
                },

                orderBy: {
                  createdAt:
                    'asc',
                },

                take:
                  100,
              })

        const matches =
          candidates.filter(
            (
              workflow,
            ) => {
              if (
                !isWaitingWorkflowState(
                  workflow.state,
                )
              ) {
                return false
              }

              if (
                !workflow.resumeConditionJson
              ) {
                return false
              }

              if (
                workflow.waitingForActorType &&
                event.actorType !==
                  workflow.waitingForActorType
              ) {
                return false
              }

              if (
                workflow.jobId &&
                event.jobId !==
                  workflow.jobId
              ) {
                return false
              }

              return eventMatchesResumeCondition(
                workflow.resumeConditionJson,
                {
                  type:
                    event.type as AgentEventType,

                  conversationId:
                    event.conversationId,

                  jobId:
                    event.jobId,

                  actorType:
                    event.actorType,

                  payload:
                    event.payloadJson,
                },
              )
            },
          )

        if (
          matches.length ===
          0
        ) {
          return defer(
            'NO_MATCHING_WORKFLOW',
          )
        }

        if (
          matches.length >
          1
        ) {
          return defer(
            'MULTIPLE_MATCHING_WORKFLOWS',
            true,
          )
        }

        const workflow =
          await this.lockWorkflow(
            tx,
            matches[0]!.id,
          )

        if (
          !isWaitingWorkflowState(
            workflow.state,
          )
        ) {
          return defer(
            'WORKFLOW_NO_LONGER_WAITING',
          )
        }

        if (
          !workflow.resumeConditionJson
        ) {
          return defer(
            'WORKFLOW_WITHOUT_RESUME_CONDITION',
          )
        }

        const stillMatches =
          eventMatchesResumeCondition(
            workflow.resumeConditionJson,
            {
              type:
                event.type as AgentEventType,

              conversationId:
                event.conversationId,

              jobId:
                event.jobId,

              actorType:
                event.actorType,

              payload:
                event.payloadJson,
            },
          )

        if (
          !stillMatches
        ) {
          return defer(
            'EVENT_NO_LONGER_MATCHES',
          )
        }

        const payload =
          event.payloadJson as
            Record<string, unknown>

        if (
          event.type ===
            'TIME_REACHED' &&
          (
            !workflow.wakeAt ||
            workflow.wakeAt >
              now ||
            payload.scheduledWakeAt !==
              workflow.wakeAt.toISOString()
          )
        ) {
          return defer(
            'TIMER_NOT_DUE',
          )
        }

        const context =
          workflow.contextJson as
            Record<string, unknown>

        if (
          event.actorType ===
          'EMPLOYEE'
        ) {
          const permission =
            (
              workflow.resumeConditionJson as {
                requiredPermission?: string
              }
            ).requiredPermission ??
            'UPDATE_JOB'

          const employee =
            typeof payload.actorId ===
            'string'
              ? await tx.actorIdentity.findFirst({
                  where: {
                    tenantId:
                      this.tenantId,

                    id:
                      payload.actorId,

                    type:
                      'EMPLOYEE',

                    active:
                      true,
                  },
                })
              : null

          if (
            !employee?.permissions.includes(
              permission,
            )
          ) {
            return defer(
              'EMPLOYEE_PERMISSION_REQUIRED',
              true,
            )
          }
        }

        if (
          workflow.jobId
        ) {
          await tx.$queryRaw`
            SELECT id
            FROM "Job"
            WHERE id = ${workflow.jobId}::uuid
              AND "tenantId" = ${this.tenantId}::uuid
            FOR SHARE
          `

          const job =
            await tx.job.findFirstOrThrow({
              where: {
                id:
                  workflow.jobId,

                tenantId:
                  this.tenantId,
              },
            })

          if (
            typeof context.jobRevision ===
              'number' &&
            context.jobRevision !==
              job.requirementsRevision &&
            event.type !==
              'JOB_REQUIREMENTS_UPDATED'
          ) {
            return defer(
              'STALE_WORKFLOW_CONTEXT',
              true,
            )
          }

          if (
            event.type ===
            'APPROVAL_RESOLVED'
          ) {
            const approval =
              typeof payload.approvalId ===
              'string'
                ? await tx.approval.findFirst({
                    where: {
                      id:
                        payload.approvalId,

                      tenantId:
                        this.tenantId,

                      jobId:
                        job.id,
                    },
                  })
                : null

            if (
              !approval ||
              approval.status !==
                'APPROVED' ||
              payload.requirementsRevision !==
                job.requirementsRevision ||
              payload.jobVersion !==
                job.version
            ) {
              return defer(
                'STALE_APPROVAL',
                true,
              )
            }

            if (
              approval.type ===
              'QUOTE'
            ) {
              const ref =
                approval.payload as {
                  quoteId?: string
                  snapshotDigest?: string
                }

              const quote =
                ref.quoteId
                  ? await tx.quote.findFirst({
                      where: {
                        id:
                          ref.quoteId,

                        tenantId:
                          this.tenantId,

                        status:
                          'APPROVED',
                      },
                    })
                  : null

              const {
                quoteSnapshotDigest,
              } =
                await import(
                  './quote-workflow.service.js'
                )

              if (
                !quote ||
                job.quoteId !==
                  quote.id ||
                ref.snapshotDigest !==
                  quoteSnapshotDigest(
                    quote.workflowSnapshot,
                  )
              ) {
                return defer(
                  'STALE_APPROVAL_CONTEXT',
                  true,
                )
              }
            }
          }
        }

        const step =
          await tx.agentWorkflowStep.findFirst({
            where: {
              tenantId:
                this.tenantId,

              workflowId:
                workflow.id,

              position:
                workflow.currentStep,
            },
          })

        const resumableStepTypes = [
          'UNDERSTAND',
          'WAIT',
          'ASK_OWNER',
          'ASK_CUSTOMER',
          'CHECK_POLICY',
          'CHECK_CONTEXT',
          'VERIFY_RESULT',
        ]

        if (
          !step ||
          !resumableStepTypes.includes(
            step.type,
          )
        ) {
          await tx.agentWorkflow.update({
            where: {
              id:
                workflow.id,
            },

            data: {
              state:
                'NEEDS_HUMAN_REVIEW',

              waitingReason:
                'MISSING_RESUME_HANDLER',

              version: {
                increment:
                  1,
              },
            },
          })

          return defer(
            'MISSING_RESUME_HANDLER',
            true,
          )
        }

        if (
          workflow.conversationId
        ) {
          const chat =
            await tx.conversation.findFirst({
              where: {
                id:
                  workflow.conversationId,

                tenantId:
                  this.tenantId,
              },
            })

          if (
            chat &&
            chat.automationMode !==
              'AUTO'
          ) {
            return defer(
              'CONVERSATION_MODE_BLOCKED',
            )
          }
        }

        const changed =
          await tx.agentWorkflow.updateMany({
            where: {
              id:
                workflow.id,

              tenantId:
                this.tenantId,

              version:
                workflow.version,

              state:
                workflow.state,
            },

            data: {
              state:
                'RUNNING',

              currentStep: {
                increment:
                  1,
              },

              waitingForActorType:
                null,

              waitingReason:
                null,

              resumeConditionJson:
                Prisma.JsonNull,

              wakeAt:
                null,

              version: {
                increment:
                  1,
              },
            },
          })

        if (
          changed.count !==
          1
        ) {
          throw new ConflictException(
            'El workflow cambió antes de poder reanudarlo.',
          )
        }

        await tx.agentWorkflowStep.updateMany({
          where: {
            position:
              workflow.currentStep,

            tenantId:
              this.tenantId,

            workflowId:
              workflow.id,

            status:
              'WAITING',
          },

          data: {
            status:
              'COMPLETED',

            completedAt:
              new Date(),
          },
        })

        /*
         * El evento y el workflow se
         * actualizan en la misma transacción.
         *
         * workflowId se guarda también
         * para conservar la correlación
         * histórica cuando el evento fue
         * creado antes del WAIT.
         */
        await tx.agentEvent.update({
          where: {
            id:
              event.id,
          },

          data: {
            consumedAt:
              new Date(),

            workflowId:
              workflow.id,

            processingAttempts: {
              increment:
                1,
            },

            lastAttemptAt:
              now,

            nextAttemptAt:
              null,

            lastProcessingReason:
              'WORKFLOW_RESUMED',
          },
        })

        await this.audit(
          tx,
          'WORKFLOW_RESUMED',
          workflow.id,
          {
            eventId:
              event.id,

            eventType:
              event.type,

            sourceKey:
              event.sourceKey,
          },
        )

        return {
          resumed:
            true,

          workflowId:
            workflow.id,

          eventId:
            event.id,
        }
      },
    )
  }

  async transition(
    id: string,
    rawState: unknown,
  ) {
    const next =
      workflowStateSchema.parse(
        rawState,
      )

    return this.db.$transaction(
      async (tx) => {
        const workflow =
          await this.lockWorkflow(
            tx,
            id,
          )

        if (
          workflow.state ===
          next
        ) {
          return workflow
        }

        if (
          isTerminalWorkflowState(
            workflow.state,
          )
        ) {
          throw new ConflictException(
            `El workflow ya terminó en estado ${workflow.state}.`,
          )
        }

        if (
          workflow.state ===
            'READY' &&
          next !==
            'RUNNING' &&
          next !==
            'CANCELLED' &&
          next !==
            'FAILED' &&
          next !==
            'NEEDS_HUMAN_REVIEW'
        ) {
          throw new ConflictException(
            `Transición inválida: ${workflow.state} → ${next}.`,
          )
        }

        const terminal =
          next ===
            'COMPLETED' ||
          next ===
            'CANCELLED' ||
          next ===
            'FAILED'

        const updated =
          await tx.agentWorkflow.update({
            where: {
              id:
                workflow.id,
            },

            data: {
              state:
                next,

              completedAt:
                terminal
                  ? new Date()
                  : null,

              waitingForActorType:
                null,

              waitingReason:
                null,

              resumeConditionJson:
                Prisma.JsonNull,

              wakeAt:
                null,

              version: {
                increment:
                  1,
              },
            },
          })

        await this.audit(
          tx,
          `WORKFLOW_${next}`,
          workflow.id,
          {
            fromState:
              workflow.state,

            toState:
              next,
          },
        )

        return updated
      },
    )
  }

  async dueWorkflows(
    now = new Date(),
  ) {
    return this.db.agentWorkflow.findMany({
      where: {
        tenantId:
          this.tenantId,

        state:
          'WAITING_TIME',

        wakeAt: {
          lte:
            now,
        },
      },

      orderBy: {
        wakeAt:
          'asc',
      },

      take:
        100,
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

    const workflow =
      await tx.agentWorkflow.findFirst({
        where: {
          id,
          tenantId:
            this.tenantId,
        },
      })

    if (!workflow) {
      throw new NotFoundException(
        'Workflow no encontrado.',
      )
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
        tenantId:
          this.tenantId,

        action,

        entityType:
          'AgentWorkflow',

        entityId:
          workflowId,

        details:
          json(details),
      },
    })
  }
}