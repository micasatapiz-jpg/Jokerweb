import {
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'

/**
 * Ejecuta únicamente handlers internos y determinísticos.
 *
 * EXECUTE_TOOL deliberadamente NO está registrado aquí.
 *
 * Un resultado persistido en AgentWorkflowStep funciona
 * como recibo idempotente del step.
 *
 * No se realizan operaciones de red dentro de las
 * transacciones de este runner.
 */
@Injectable()
export class WorkflowStepRunnerService {
  constructor(
    private readonly db:
      PrismaService,

    private readonly tenant:
      LocalTenantService,
  ) {}

  async run(
    workflowId: string,
    stepKey: string,
  ) {
    const tenantId =
      this.tenant.tenantId

    try {
      return await this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id
            FROM "AgentWorkflow"
            WHERE id = ${workflowId}::uuid
              AND "tenantId" = ${tenantId}::uuid
            FOR UPDATE
          `

          const workflow =
            await tx.agentWorkflow.findFirst({
              where: {
                id:
                  workflowId,

                tenantId,
              },
            })

          if (!workflow) {
            throw new NotFoundException(
              'Workflow no encontrado.',
            )
          }

          const step =
            await tx.agentWorkflowStep.findUnique({
              where: {
                tenantId_workflowId_stepKey: {
                  tenantId,
                  workflowId,
                  stepKey,
                },
              },
            })

          if (!step) {
            throw new NotFoundException(
              'Step no encontrado.',
            )
          }

          /*
           * El step ya terminó anteriormente.
           * No repetimos su efecto.
           */
          if (
            step.status ===
            'COMPLETED'
          ) {
            return {
              status:
                'REPLAY',

              result:
                step.resultJson,
            }
          }

          /*
           * Solo se puede ejecutar el
           * step que corresponde a la
           * posición actual del workflow.
           */
          if (
            workflow.state !==
              'RUNNING' ||
            step.position !==
              workflow.currentStep
          ) {
            return {
              status:
                'NOT_READY',
            }
          }

          /*
           * ConversationMode manda sobre
           * la ejecución autónoma.
           */
          if (
            workflow.conversationId
          ) {
            const conversation =
              await tx.conversation.findFirstOrThrow({
                where: {
                  id:
                    workflow.conversationId,

                  tenantId,
                },
              })

            if (
              conversation.automationMode !==
              'AUTO'
            ) {
              return {
                status:
                  'MODE_BLOCKED',
              }
            }
          }

          const supportedTypes = [
            'CHECK_POLICY',
            'CHECK_CONTEXT',
            'VERIFY_RESULT',
            'CREATE_TASK',
          ]

          /*
           * No ejecutamos herramientas
           * críticas ni handlers desconocidos.
           *
           * Después de demasiados intentos
           * también se requiere revisión humana.
           */
          if (
            !supportedTypes.includes(
              step.type,
            ) ||
            step.attempt >=
              3
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
                  'STEP_HANDLER_REVIEW_REQUIRED',

                version: {
                  increment:
                    1,
                },
              },
            })

            return {
              status:
                'NEEDS_HUMAN_REVIEW',
            }
          }

          /*
           * Los handlers actuales son
           * determinísticos y no conceden
           * autoridad comercial.
           */
          const result:
            Record<
              string,
              string | boolean
            > = {
              authority:
                'NO_COMMERCIAL_AUTHORIZATION',

              checked:
                true,
            }

          if (
            step.type ===
            'CREATE_TASK'
          ) {
            /*
             * El dedupeKey usa el id del step.
             *
             * Si la transacción se reintenta,
             * no se crean múltiples tareas.
             */
            const task =
              await tx.task.upsert({
                where: {
                  tenantId_dedupeKey: {
                    tenantId,

                    dedupeKey:
                      `workflow-step:${step.id}`,
                  },
                },

                create: {
                  tenantId,

                  jobId:
                    workflow.jobId,

                  conversationId:
                    workflow.conversationId,

                  type:
                    'CHECK_REQUIREMENT',

                  title:
                    'Revisión de contexto del workflow',

                  dedupeKey:
                    `workflow-step:${step.id}`,

                  details: {
                    workflowId,
                    stepKey,
                  },
                },

                update: {},
              })

            result.taskId =
              task.id
          }

          /*
           * Audit + receipt + avance del workflow
           * viven en una sola transacción.
           */
          await tx.auditLog.create({
            data: {
              tenantId,

              entityType:
                'AgentWorkflowStep',

              entityId:
                step.id,

              action:
                'WORKFLOW_STEP_COMPLETED',

              details: {
                workflowId,
                result,
              },
            },
          })

          await tx.agentWorkflowStep.update({
            where: {
              id:
                step.id,
            },

            data: {
              status:
                'COMPLETED',

              attempt: {
                increment:
                  1,
              },

              completedAt:
                new Date(),

              resultJson:
                result,
            },
          })

          await tx.agentWorkflow.update({
            where: {
              id:
                workflow.id,
            },

            data: {
              currentStep: {
                increment:
                  1,
              },

              version: {
                increment:
                  1,
              },
            },
          })

          return {
            status:
              'COMPLETED',

            result,
          }
        },
      )
    } catch (error) {
      /*
       * NotFound es un error lógico,
       * no un fallo transitorio.
       */
      if (
        error instanceof
        NotFoundException
      ) {
        throw error
      }

      /*
       * El efecto de la transacción anterior
       * quedó revertido completamente.
       *
       * Persistimos solamente el recibo
       * del fallo/reintento.
       */
      await this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id
            FROM "AgentWorkflow"
            WHERE id = ${workflowId}::uuid
              AND "tenantId" = ${tenantId}::uuid
            FOR UPDATE
          `

          const step =
            await tx.agentWorkflowStep.findUnique({
              where: {
                tenantId_workflowId_stepKey: {
                  tenantId,
                  workflowId,
                  stepKey,
                },
              },
            })

          if (
            !step ||
            step.status ===
              'COMPLETED'
          ) {
            return
          }

          await tx.agentWorkflowStep.update({
            where: {
              id:
                step.id,
            },

            data: {
              status:
                'FAILED',

              attempt: {
                increment:
                  1,
              },

              resultJson: {
                reason:
                  'TRANSACTION_FAILED',
              },
            },
          })

          /*
           * step.attempt es el valor ANTES
           * del incremento anterior.
           *
           * >= 2 significa que este fallo
           * completa el tercer intento.
           */
          if (
            step.attempt >=
            2
          ) {
            await tx.agentWorkflow.update({
              where: {
                id:
                  workflowId,
              },

              data: {
                state:
                  'NEEDS_HUMAN_REVIEW',

                waitingReason:
                  'STEP_RETRY_EXHAUSTED',

                version: {
                  increment:
                    1,
                },
              },
            })
          }

          await tx.auditLog.create({
            data: {
              tenantId,

              entityType:
                'AgentWorkflowStep',

              entityId:
                step.id,

              action:
                'WORKFLOW_STEP_FAILED',

              details: {
                workflowId,

                attempt:
                  step.attempt +
                  1,
              },
            },
          })
        },
      )

      return {
        status:
          'RETRY_REQUIRED',
      }
    }
  }
}