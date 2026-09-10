import {
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  Prisma,
} from '../generated/prisma/client.js'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import {
  productConfigurationSchema,
  configurationIsCurrent,
  evaluateProductRules,
} from './product-configuration.schema.js'
import {
  activePriceRuleWhere,
} from '../pricing/active-price-rule.js'

const json = (
  value: unknown,
): Prisma.InputJsonValue =>
  JSON.parse(
    JSON.stringify(
      value,
    ),
  )

type StepHandler =
  | 'COMMERCIAL_RULE_GATE'
  | 'QUOTE_READINESS'

type StepResult =
  Record<
    string,
    unknown
  >

/**
 * Ejecuta únicamente handlers internos
 * y determinísticos.
 *
 * EXECUTE_TOOL deliberadamente NO está
 * registrado aquí.
 *
 * Un resultado persistido en
 * AgentWorkflowStep funciona como recibo
 * idempotente del step.
 *
 * No se realizan operaciones de red dentro
 * de las transacciones de este runner.
 */
@Injectable()
export class WorkflowStepRunnerService {
  constructor(
    private readonly db:
      PrismaService,

    private readonly tenant:
      LocalTenantService,
  ) {}

  private getHandler(
    inputJson: unknown,
  ):
    | StepHandler
    | null {
    if (
      !inputJson ||
      typeof inputJson !==
        'object' ||
      Array.isArray(
        inputJson,
      )
    ) {
      return null
    }

    const handler =
      (
        inputJson as
          Record<
            string,
            unknown
          >
      ).handler

    if (
      handler ===
        'COMMERCIAL_RULE_GATE' ||
      handler ===
        'QUOTE_READINESS'
    ) {
      return handler
    }

    return null
  }

  /**
   * Bloquea un step por una condición
   * comercial real.
   *
   * Importante:
   *
   * - no consume intentos técnicos;
   * - no marca el step COMPLETED;
   * - no avanza currentStep;
   * - conserva el plan para revisión;
   * - registra la razón exacta.
   */
  private async requireHumanReview(
    tx:
      Prisma.TransactionClient,

    input: {
      tenantId: string
      workflowId: string
      stepId: string
      reason: string
      result: StepResult
    },
  ) {
    await tx.agentWorkflow.update({
      where: {
        id:
          input.workflowId,
      },

      data: {
        state:
          'NEEDS_HUMAN_REVIEW',

        waitingReason:
          input.reason,

        version: {
          increment:
            1,
        },
      },
    })

    await tx.agentWorkflowStep.update({
      where: {
        id:
          input.stepId,
      },

      data: {
        resultJson:
          json(
            input.result,
          ),
      },
    })

    await tx.auditLog.create({
      data: {
        tenantId:
          input.tenantId,

        entityType:
          'AgentWorkflowStep',

        entityId:
          input.stepId,

        action:
          'WORKFLOW_STEP_REQUIRES_REVIEW',

        details:
          json({
            workflowId:
              input.workflowId,

            reason:
              input.reason,

            result:
              input.result,
          }),
      },
    })

    return {
      status:
        'NEEDS_HUMAN_REVIEW' as const,

      result:
        input.result,
    }
  }

  /**
   * Comprueba que el Job tenga actualmente
   * una política comercial ejecutable.
   *
   * Esto NO calcula el precio.
   * Esto NO publica reglas.
   * Esto NO convierte conocimiento del OWNER
   * en configuración ejecutable.
   *
   * Solo comprueba facts ya persistidos.
   */
  private async checkCommercialPolicy(
    tx:
      Prisma.TransactionClient,

    input: {
      tenantId: string
      workflow: {
        id: string
        jobId: string | null
        contextJson: unknown
      }
      step: {
        id: string
      }
      handler: StepHandler
    },
  ) {
    const {
      tenantId,
      workflow,
      step,
      handler,
    } =
      input

    if (
      !workflow.jobId
    ) {
      return this.requireHumanReview(
        tx,
        {
          tenantId,

          workflowId:
            workflow.id,

          stepId:
            step.id,

          reason:
            'COMMERCIAL_JOB_REQUIRED',

          result: {
            checked:
              false,

            handler,

            authority:
              'NO_COMMERCIAL_AUTHORIZATION',

            reason:
              'COMMERCIAL_JOB_REQUIRED',
          },
        },
      )
    }

    /*
     * Bloqueamos el Job durante la evaluación
     * para no leer requisitos y versión de
     * distintos momentos.
     */
    await tx.$queryRaw`
      SELECT id
      FROM "Job"
      WHERE id = ${workflow.jobId}::uuid
        AND "tenantId" = ${tenantId}::uuid
      FOR SHARE
    `

    const job =
      await tx.job.findFirst({
        where: {
          id:
            workflow.jobId,

          tenantId,
        },
      })

    if (
      !job
    ) {
      return this.requireHumanReview(
        tx,
        {
          tenantId,

          workflowId:
            workflow.id,

          stepId:
            step.id,

          reason:
            'COMMERCIAL_JOB_NOT_FOUND',

          result: {
            checked:
              false,

            handler,

            authority:
              'NO_COMMERCIAL_AUTHORIZATION',

            reason:
              'COMMERCIAL_JOB_NOT_FOUND',
          },
        },
      )
    }

    const context =
      workflow.contextJson &&
      typeof workflow.contextJson ===
        'object' &&
      !Array.isArray(
        workflow.contextJson,
      )
        ? workflow.contextJson as
            Record<
              string,
              unknown
            >
        : {}

    /*
     * COMMERCIAL_RULE_GATE nace de un snapshot
     * concreto del Job.
     *
     * Si cambiaron los requisitos mientras se
     * esperaba al OWNER, no podemos aplicar
     * silenciosamente la respuesta a otro estado.
     *
     * QUOTE_READINESS, en cambio, normalmente
     * existe precisamente porque el CUSTOMER
     * actualizó requisitos, por eso evalúa la
     * revisión actual.
     */
    if (
      handler ===
        'COMMERCIAL_RULE_GATE' &&
      typeof context.jobRevision ===
        'number' &&
      context.jobRevision !==
        job.requirementsRevision
    ) {
      return this.requireHumanReview(
        tx,
        {
          tenantId,

          workflowId:
            workflow.id,

          stepId:
            step.id,

          reason:
            'STALE_COMMERCIAL_CONTEXT',

          result: {
            checked:
              false,

            handler,

            authority:
              'NO_COMMERCIAL_AUTHORIZATION',

            reason:
              'STALE_COMMERCIAL_CONTEXT',

            expectedRevision:
              context.jobRevision,

            currentRevision:
              job.requirementsRevision,
          },
        },
      )
    }

    if (
      !job.productId
    ) {
      return this.requireHumanReview(
        tx,
        {
          tenantId,

          workflowId:
            workflow.id,

          stepId:
            step.id,

          reason:
            'PRODUCT_NOT_SELECTED',

          result: {
            checked:
              false,

            handler,

            authority:
              'NO_COMMERCIAL_AUTHORIZATION',

            reason:
              'PRODUCT_NOT_SELECTED',
          },
        },
      )
    }

    const product =
      await tx.product.findFirst({
        where: {
          id:
            job.productId,

          tenantId,

          isActive:
            true,
        },
      })

    if (
      !product
    ) {
      return this.requireHumanReview(
        tx,
        {
          tenantId,

          workflowId:
            workflow.id,

          stepId:
            step.id,

          reason:
            'PRODUCT_NOT_ACTIVE',

          result: {
            checked:
              false,

            handler,

            authority:
              'NO_COMMERCIAL_AUTHORIZATION',

            reason:
              'PRODUCT_NOT_ACTIVE',

            productId:
              job.productId,
          },
        },
      )
    }

    /*
     * Leemos la última ProductConfiguration.
     *
     * Esto replica la garantía de
     * ProductConfigurationService.get():
     * debe existir, parsear correctamente
     * y seguir vigente.
     */
    const configuration =
      await tx.productConfiguration.findFirst({
        where: {
          tenantId,

          productId:
            product.id,
        },

        orderBy: {
          version:
            'desc',
        },
      })

    if (
      !configuration
    ) {
      return this.requireHumanReview(
        tx,
        {
          tenantId,

          workflowId:
            workflow.id,

          stepId:
            step.id,

          reason:
            'COMMERCIAL_RULE_NOT_CONFIGURED',

          result: {
            checked:
              false,

            handler,

            authority:
              'NO_COMMERCIAL_AUTHORIZATION',

            reason:
              'COMMERCIAL_RULE_NOT_CONFIGURED',

            productId:
              product.id,
          },
        },
      )
    }

    const parsed =
      productConfigurationSchema.safeParse(
        configuration.rules,
      )

    if (
      !parsed.success ||
      !configurationIsCurrent(
        parsed.data,
      )
    ) {
      return this.requireHumanReview(
        tx,
        {
          tenantId,

          workflowId:
            workflow.id,

          stepId:
            step.id,

          reason:
            'COMMERCIAL_RULE_NOT_CURRENT',

          result: {
            checked:
              false,

            handler,

            authority:
              'NO_COMMERCIAL_AUTHORIZATION',

            reason:
              'COMMERCIAL_RULE_NOT_CURRENT',

            productId:
              product.id,

            configurationId:
              configuration.id,

            configurationVersion:
              configuration.version,
          },
        },
      )
    }

    const rules =
      parsed.data

    const requirements =
      job.requirements &&
      typeof job.requirements ===
        'object' &&
      !Array.isArray(
        job.requirements,
      )
        ? job.requirements as
            Record<
              string,
              unknown
            >
        : {}

    /*
     * Evalúa únicamente requisitos y política.
     *
     * HUMAN_REVIEW no significa que la regla
     * sea inválida.
     *
     * Puede significar que la empresa exige
     * revisión humana antes de aprobar precio.
     */
    const evaluation =
      evaluateProductRules(
        rules,
        requirements,
      )

    if (
      evaluation.status ===
      'RULE_NOT_CONFIGURED'
    ) {
      return this.requireHumanReview(
        tx,
        {
          tenantId,

          workflowId:
            workflow.id,

          stepId:
            step.id,

          reason:
            'COMMERCIAL_RULE_NOT_CONFIGURED',

          result: {
            checked:
              false,

            handler,

            authority:
              'NO_COMMERCIAL_AUTHORIZATION',

            reason:
              'COMMERCIAL_RULE_NOT_CONFIGURED',

            productId:
              product.id,

            configurationId:
              configuration.id,

            configurationVersion:
              configuration.version,
          },
        },
      )
    }

    if (
      evaluation.status ===
      'MISSING_DATA'
    ) {
      return this.requireHumanReview(
        tx,
        {
          tenantId,

          workflowId:
            workflow.id,

          stepId:
            step.id,

          reason:
            'COMMERCIAL_REQUIREMENTS_MISSING',

          result: {
            checked:
              false,

            handler,

            authority:
              'NO_COMMERCIAL_AUTHORIZATION',

            reason:
              'COMMERCIAL_REQUIREMENTS_MISSING',

            productId:
              product.id,

            requirementsRevision:
              job.requirementsRevision,

            missingFields:
              evaluation.missingFields,
          },
        },
      )
    }

    /*
     * Aunque evaluateProductRules pueda indicar
     * HUMAN_REVIEW, necesitamos comprobar que
     * exista un motor de cálculo real.
     */
    if (
      !rules.quotationRules
        .pricingEngine
    ) {
      return this.requireHumanReview(
        tx,
        {
          tenantId,

          workflowId:
            workflow.id,

          stepId:
            step.id,

          reason:
            'PRICING_ENGINE_NOT_CONFIGURED',

          result: {
            checked:
              false,

            handler,

            authority:
              'NO_COMMERCIAL_AUTHORIZATION',

            reason:
              'PRICING_ENGINE_NOT_CONFIGURED',

            productId:
              product.id,
          },
        },
      )
    }

    /*
     * STANDARD_AREA_V1 necesita bindings.
     *
     * GENERIC_V1 necesita commercialPricing.
     */
    if (
      rules.quotationRules
        .pricingEngine ===
        'STANDARD_AREA_V1' &&
      !rules.quotationRules
        .pricingInputs
    ) {
      return this.requireHumanReview(
        tx,
        {
          tenantId,

          workflowId:
            workflow.id,

          stepId:
            step.id,

          reason:
            'PRICING_INPUTS_NOT_CONFIGURED',

          result: {
            checked:
              false,

            handler,

            authority:
              'NO_COMMERCIAL_AUTHORIZATION',

            reason:
              'PRICING_INPUTS_NOT_CONFIGURED',

            productId:
              product.id,
          },
        },
      )
    }

    if (
      rules.quotationRules
        .pricingEngine ===
        'GENERIC_V1' &&
      !rules.commercialPricing
    ) {
      return this.requireHumanReview(
        tx,
        {
          tenantId,

          workflowId:
            workflow.id,

          stepId:
            step.id,

          reason:
            'COMMERCIAL_PRICING_NOT_CONFIGURED',

          result: {
            checked:
              false,

            handler,

            authority:
              'NO_COMMERCIAL_AUTHORIZATION',

            reason:
              'COMMERCIAL_PRICING_NOT_CONFIGURED',

            productId:
              product.id,
          },
        },
      )
    }

    if (
      !rules.quotationRules
        .validityDays
    ) {
      return this.requireHumanReview(
        tx,
        {
          tenantId,

          workflowId:
            workflow.id,

          stepId:
            step.id,

          reason:
            'QUOTE_VALIDITY_NOT_CONFIGURED',

          result: {
            checked:
              false,

            handler,

            authority:
              'NO_COMMERCIAL_AUTHORIZATION',

            reason:
              'QUOTE_VALIDITY_NOT_CONFIGURED',

            productId:
              product.id,
          },
        },
      )
    }

    /*
     * Finalmente exigimos una PriceRule REAL,
     * activa, vigente y no demo.
     *
     * Si commercialPricing define tariffId,
     * esa tarifa exacta debe existir.
     */
    const now =
      new Date()

    const priceRule =
      await tx.priceRule.findFirst({
        where: {
          ...activePriceRuleWhere(
            tenantId,
            now,
          ),

          productId:
            product.id,

          ...(rules.commercialPricing
            ? {
                id:
                  rules.commercialPricing
                    .tariffId,
              }
            : {}),
        },

        orderBy: [
          {
            validFrom:
              'desc',
          },
          {
            id:
              'asc',
          },
        ],
      })

    if (
      !priceRule
    ) {
      return this.requireHumanReview(
        tx,
        {
          tenantId,

          workflowId:
            workflow.id,

          stepId:
            step.id,

          reason:
            'ACTIVE_PRICE_RULE_REQUIRED',

          result: {
            checked:
              false,

            handler,

            authority:
              'NO_COMMERCIAL_AUTHORIZATION',

            reason:
              'ACTIVE_PRICE_RULE_REQUIRED',

            productId:
              product.id,

            configurationId:
              configuration.id,

            configurationVersion:
              configuration.version,
          },
        },
      )
    }

    /*
     * Gate superado.
     *
     * Todavía NO hay autorización para:
     *
     * - enviar precio;
     * - aprobar cotización;
     * - confirmar pago;
     * - iniciar producción.
     */
    return {
      status:
        'READY' as const,

      result: {
        checked:
          true,

        handler,

        authority:
          'NO_COMMERCIAL_AUTHORIZATION',

        commercialRuleReady:
          true,

        productId:
          product.id,

        requirementsRevision:
          job.requirementsRevision,

        configurationId:
          configuration.id,

        configurationVersion:
          configuration.version,

        priceRuleId:
          priceRule.id,

        policyStatus:
          evaluation.status,
      },
    }
  }

  async run(
    workflowId: string,
    stepKey: string,
  ) {
    const tenantId =
      this.tenant.tenantId

    try {
      return await this.db.$transaction(
        async (
          tx,
        ) => {
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

          if (
            !workflow
          ) {
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

          if (
            !step
          ) {
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
           * Solo se puede ejecutar el step
           * correspondiente a currentStep.
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
           * ejecución autónoma.
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
           * No ejecutamos herramientas críticas
           * ni handlers desconocidos.
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

          const handler =
            this.getHandler(
              step.inputJson,
            )

          let result:
            StepResult = {
              authority:
                'NO_COMMERCIAL_AUTHORIZATION',

              checked:
                true,
            }

          /*
           * CHECK_POLICY con handler comercial
           * deja de ser un check vacío.
           */
          if (
            step.type ===
              'CHECK_POLICY' &&
            handler
          ) {
            const policy =
              await this.checkCommercialPolicy(
                tx,
                {
                  tenantId,

                  workflow: {
                    id:
                      workflow.id,

                    jobId:
                      workflow.jobId,

                    contextJson:
                      workflow.contextJson,
                  },

                  step: {
                    id:
                      step.id,
                  },

                  handler,
                },
              )

            if (
              policy.status ===
              'NEEDS_HUMAN_REVIEW'
            ) {
              return policy
            }

            result =
              policy.result
          }

          if (
            step.type ===
            'CREATE_TASK'
          ) {
            /*
             * El dedupeKey usa el id del step.
             *
             * Si la transacción se reintenta,
             * no se crean tareas duplicadas.
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

              details:
                json({
                  workflowId,
                  result,
                }),
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
                json(
                  result,
                ),
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
    } catch (
      error
    ) {
      /*
       * NotFound es error lógico,
       * no fallo transitorio.
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
        async (
          tx,
        ) => {
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