import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  Prisma,
} from '../generated/prisma/client.js'
import {
  PrismaService,
} from '../database/prisma.service.js'
import {
  LocalTenantService,
} from '../common/local-tenant.service.js'
import { newWaitContext, record, waitContext } from './waiting-engine.js'
import {
  productConfigurationSchema,
  configurationIsCurrent,
  evaluateProductRules,
} from './product-configuration.schema.js'
import {
  activePriceRuleWhere,
} from '../pricing/active-price-rule.js'
import {
  QuoteWorkflowService,
} from './quote-workflow.service.js'

const json = (
  value: unknown,
): Prisma.InputJsonValue =>
  JSON.parse(
    JSON.stringify(
      value,
    ),
  )

type CommercialPolicyHandler =
  | 'COMMERCIAL_RULE_GATE'
  | 'QUOTE_READINESS'

type StepHandler =
  | CommercialPolicyHandler
  | 'RETRY_QUOTE_DRAFT'

type StepResult =
  Record<
    string,
    unknown
  >

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
        'QUOTE_READINESS' ||
      handler ===
        'RETRY_QUOTE_DRAFT'
    ) {
      return handler
    }

    return null
  }

  private isCommercialPolicyHandler(
    handler:
      StepHandler |
      null,
  ):
    handler is
      CommercialPolicyHandler {
    return (
      handler ===
        'COMMERCIAL_RULE_GATE' ||
      handler ===
        'QUOTE_READINESS'
    )
  }

  /**
   * Mueve el workflow a revisión humana
   * por una condición comercial real.
   *
   * No consume intentos técnicos.
   * No completa el step.
   * No avanza currentStep.
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
   * Registra un error técnico del step.
   *
   * Estos intentos sí cuentan.
   *
   * Al tercer fallo el workflow pasa a
   * NEEDS_HUMAN_REVIEW.
   */
  private async recordTechnicalFailure(
    workflowId: string,
    stepKey: string,
  ) {
    const tenantId =
      this.tenant.tenantId

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
          return
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
         * step.attempt es el valor anterior
         * al incremento.
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
  }

  /**
   * Comprueba que el Job tenga actualmente
   * una política comercial ejecutable.
   *
   * NO calcula el precio.
   * NO publica reglas.
   * NO convierte conocimiento del OWNER
   * en configuración ejecutable.
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

      handler:
        CommercialPolicyHandler
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
     * COMMERCIAL_RULE_GATE nace de un
     * snapshot concreto.
     *
     * QUOTE_READINESS puede existir
     * precisamente porque el cliente
     * actualizó requisitos.
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
      if (handler === 'QUOTE_READINESS') {
        const current = await tx.agentWorkflow.findFirstOrThrow({where: {id: workflow.id, tenantId}})
        const prior = waitContext(current)
        const waiting = newWaitContext(`${current.id}:${current.version + 1}`, new Date(), prior?.policy, true)
        // Incompleteness is not a technical failure. Preserve attempts and reminder budget.
        waiting.followUpCount = prior?.followUpCount ?? 0
        if (waiting.followUpCount >= waiting.policy.maxFollowUps) waiting.nextCheckAt = null
        await tx.agentWorkflow.update({where: {id: current.id}, data: {
          state: 'WAITING_CUSTOMER', waitingForActorType: 'CUSTOMER', waitingReason: 'MISSING_REQUIREMENT',
          contextJson: json({...record(current.contextJson), jobRevision: job.requirementsRevision, waiting}),
          resumeConditionJson: {eventTypes: ['CUSTOMER_MESSAGE_RECEIVED', 'JOB_REQUIREMENTS_UPDATED'], actorType: 'CUSTOMER',
            jobId: job.id, ...(current.conversationId ? {conversationId: current.conversationId} : {}), requiredFields: evaluation.missingFields},
          version: {increment: 1},
        }})
        const result = {checked: false, handler, missingFields: evaluation.missingFields, authority: 'NO_COMMERCIAL_AUTHORIZATION'}
        await tx.agentWorkflowStep.update({where: {id: step.id}, data: {status: 'WAITING', resultJson: json(result)}})
        await tx.auditLog.create({data: {tenantId, entityType: 'AgentWorkflow', entityId: current.id, action: 'WAIT_CUSTOMER_REQUIREMENTS', details: json(result)}})
        return {status: 'WAITING_CUSTOMER' as const, result}
      }
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

  /**
   * Ejecuta el step durable RETRY_QUOTE_DRAFT.
   *
   * La llamada a QuoteWorkflowService.createDraft()
   * ocurre deliberadamente FUERA de la transacción
   * del runner.
   *
   * Esto evita una transacción anidada.
   *
   * La idempotencia se consigue mediante
   * requestKey determinístico basado en step.id.
   */
  private async runRetryQuoteDraft(
    workflowId:
      string,

    stepKey:
      string,
  ) {
    const tenantId =
      this.tenant.tenantId

    /*
     * -------------------------------------------------
     * FASE 1
     * -------------------------------------------------
     *
     * Validar y capturar el contexto actual.
     */
    const prepared =
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

          if (
            step.status ===
            'COMPLETED'
          ) {
            return {
              kind:
                'RETURN' as const,

              value: {
                status:
                  'REPLAY' as const,

                result:
                  step.resultJson,
              },
            }
          }

          if (
            workflow.state !==
              'RUNNING' ||
            step.position !==
              workflow.currentStep
          ) {
            return {
              kind:
                'RETURN' as const,

              value: {
                status:
                  'NOT_READY' as const,
              },
            }
          }

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
                kind:
                  'RETURN' as const,

                value: {
                  status:
                    'MODE_BLOCKED' as const,
                },
              }
            }
          }

          const handler =
            this.getHandler(
              step.inputJson,
            )

          if (
            step.type !==
              'CHECK_CONTEXT' ||
            handler !==
              'RETRY_QUOTE_DRAFT'
          ) {
            const review =
              await this.requireHumanReview(
                tx,
                {
                  tenantId,

                  workflowId:
                    workflow.id,

                  stepId:
                    step.id,

                  reason:
                    'STEP_HANDLER_REVIEW_REQUIRED',

                  result: {
                    checked:
                      false,

                    reason:
                      'INVALID_RETRY_QUOTE_HANDLER',

                    authority:
                      'NO_COMMERCIAL_AUTHORIZATION',
                  },
                },
              )

            return {
              kind:
                'RETURN' as const,

              value:
                review,
            }
          }

          if (
            step.attempt >=
            3
          ) {
            const review =
              await this.requireHumanReview(
                tx,
                {
                  tenantId,

                  workflowId:
                    workflow.id,

                  stepId:
                    step.id,

                  reason:
                    'STEP_RETRY_EXHAUSTED',

                  result: {
                    checked:
                      false,

                    handler,

                    reason:
                      'STEP_RETRY_EXHAUSTED',

                    authority:
                      'NO_COMMERCIAL_AUTHORIZATION',
                  },
                },
              )

            return {
              kind:
                'RETURN' as const,

              value:
                review,
            }
          }

          if (
            !workflow.jobId
          ) {
            const review =
              await this.requireHumanReview(
                tx,
                {
                  tenantId,

                  workflowId:
                    workflow.id,

                  stepId:
                    step.id,

                  reason:
                    'QUOTE_RETRY_JOB_REQUIRED',

                  result: {
                    checked:
                      false,

                    handler,

                    reason:
                      'QUOTE_RETRY_JOB_REQUIRED',

                    authority:
                      'NO_COMMERCIAL_AUTHORIZATION',
                  },
                },
              )

            return {
              kind:
                'RETURN' as const,

              value:
                review,
            }
          }

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
            const review =
              await this.requireHumanReview(
                tx,
                {
                  tenantId,

                  workflowId:
                    workflow.id,

                  stepId:
                    step.id,

                  reason:
                    'QUOTE_RETRY_JOB_NOT_FOUND',

                  result: {
                    checked:
                      false,

                    handler,

                    reason:
                      'QUOTE_RETRY_JOB_NOT_FOUND',

                    authority:
                      'NO_COMMERCIAL_AUTHORIZATION',
                  },
                },
              )

            return {
              kind:
                'RETURN' as const,

              value:
                review,
            }
          }

          return {
            kind:
              'EXECUTE' as const,

            workflowId:
              workflow.id,

            stepId:
              step.id,

            stepPosition:
              step.position,

            jobId:
              job.id,

            expectedRevision:
              job.requirementsRevision,

            requestKey:
              `workflow-quote-retry:${step.id}`,

            evidence:
              `Reintento durable de cotización del workflow ${workflow.id}.`,
          }
        },
      )

    if (
      prepared.kind ===
      'RETURN'
    ) {
      return prepared.value
    }

    /*
     * -------------------------------------------------
     * FASE 2
     * -------------------------------------------------
     *
     * createDraft abre su propia transacción.
     *
     * Nunca se ejecuta dentro de la transacción
     * anterior.
     */
    let draft:
      Awaited<
        ReturnType<
          QuoteWorkflowService['createDraft']
        >
      >

    try {
      const quoteService =
        new QuoteWorkflowService(
          this.db,
          this.tenant,
        )

      draft =
        await quoteService.createDraft(
          {
            jobId:
              prepared.jobId,

            expectedRevision:
              prepared.expectedRevision,

            requestKey:
              prepared.requestKey,

            evidence:
              prepared.evidence,
          },

          {
            /*
             * Actor técnico interno.
             *
             * No representa al OWNER.
             * No concede aprobación comercial.
             */
            id:
              `agent-workflow:${prepared.workflowId}`,

            role:
              'SYSTEM',
          },
        )
    } catch (
      error
    ) {
      /*
       * Conflictos determinísticos no deben
       * reintentarse automáticamente tres veces.
       *
       * Ejemplos:
       *
       * - cambió la revisión;
       * - apareció otra cotización vigente;
       * - el Job cambió de estado.
       */
      if (
        error instanceof
          ConflictException ||
        error instanceof
          NotFoundException
      ) {
        return this.db.$transaction(
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
              !workflow ||
              !step
            ) {
              return {
                status:
                  'NOT_READY' as const,
              }
            }

            if (
              step.status ===
              'COMPLETED'
            ) {
              return {
                status:
                  'REPLAY' as const,

                result:
                  step.resultJson,
              }
            }

            if (
              workflow.state !==
                'RUNNING' ||
              workflow.currentStep !==
                step.position
            ) {
              return {
                status:
                  'NOT_READY' as const,
              }
            }

            return this.requireHumanReview(
              tx,
              {
                tenantId,

                workflowId:
                  workflow.id,

                stepId:
                  step.id,

                reason:
                  'QUOTE_RETRY_CONTEXT_CHANGED',

                result: {
                  checked:
                    false,

                  handler:
                    'RETRY_QUOTE_DRAFT',

                  authority:
                    'NO_COMMERCIAL_AUTHORIZATION',

                  reason:
                    'QUOTE_RETRY_CONTEXT_CHANGED',

                  error:
                    error.message,
                },
              },
            )
          },
        )
      }

      /*
       * Un error inesperado puede ser técnico
       * y sí puede reintentarse.
       */
      await this.recordTechnicalFailure(
        workflowId,
        stepKey,
      )

      return {
        status:
          'RETRY_REQUIRED' as const,
      }
    }

    /*
     * -------------------------------------------------
     * FASE 3
     * -------------------------------------------------
     *
     * Persistir el recibo del step.
     *
     * Si hubo un crash después de createDraft()
     * pero antes de esta fase, el próximo ciclo
     * utilizará el mismo requestKey.
     *
     * QuoteWorkflowService hará replay.
     */
    return this.db.$transaction(
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

        if (
          step.status ===
          'COMPLETED'
        ) {
          return {
            status:
              'REPLAY' as const,

            result:
              step.resultJson,
          }
        }

        if (
          workflow.state !==
            'RUNNING' ||
          workflow.currentStep !==
            step.position
        ) {
          return {
            status:
              'NOT_READY' as const,
          }
        }

        const result:
          StepResult = {
            checked:
              true,

            handler:
              'RETRY_QUOTE_DRAFT',

            authority:
              'NO_COMMERCIAL_AUTHORIZATION',

            quoteRetryStatus:
              draft.status,

            requestKey:
              prepared.requestKey,

            requirementsRevision:
              prepared.expectedRevision,

            /*
             * Solo existirán en PENDING_APPROVAL.
             */
            ...(
              draft.status ===
                'PENDING_APPROVAL'
                ? {
                    quoteId:
                      draft.quoteId,

                    approvalId:
                      draft.approvalId,
                  }
                : {
                    taskId:
                      draft.taskId,

                    missingFields:
                      draft.missingFields,
                  }
            ),
          }

        await tx.auditLog.create({
          data: {
            tenantId,

            entityType:
              'AgentWorkflowStep',

            entityId:
              step.id,

            action:
              'WORKFLOW_QUOTE_RETRY_COMPLETED',

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
            'COMPLETED' as const,

          result,
        }
      },
    )
  }

  async run(
    workflowId: string,
    stepKey: string,
  ) {
    const tenantId =
      this.tenant.tenantId

    /*
     * RETRY_QUOTE_DRAFT necesita una ejecución
     * en tres fases porque QuoteWorkflowService
     * abre su propia transacción.
     *
     * Solo hacemos esta lectura para enrutar.
     *
     * runRetryQuoteDraft vuelve a validar todo
     * bajo lock antes de ejecutar.
     */
    const descriptor =
      await this.db.agentWorkflowStep.findUnique({
        where: {
          tenantId_workflowId_stepKey: {
            tenantId,
            workflowId,
            stepKey,
          },
        },

        select: {
          inputJson:
            true,
        },
      })

    if (
      descriptor &&
      this.getHandler(
        descriptor.inputJson,
      ) ===
        'RETRY_QUOTE_DRAFT'
    ) {
      return this.runRetryQuoteDraft(
        workflowId,
        stepKey,
      )
    }

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

          if (
            step.status ===
            'COMPLETED'
          ) {
            return {
              status:
                'REPLAY' as const,

              result:
                step.resultJson,
            }
          }

          if (
            workflow.state !==
              'RUNNING' ||
            step.position !==
              workflow.currentStep
          ) {
            return {
              status:
                'NOT_READY' as const,
            }
          }

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
                  'MODE_BLOCKED' as const,
              }
            }
          }

          const supportedTypes = [
            'CHECK_POLICY',
            'CHECK_CONTEXT',
            'VERIFY_RESULT',
            'CREATE_TASK',
          ]

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
                'NEEDS_HUMAN_REVIEW' as const,
            }
          }

          const handler =
            this.getHandler(
              step.inputJson,
            )

          /*
           * Un handler conocido no debe ejecutarse
           * bajo un tipo de step equivocado.
           */
          if (
            handler ===
              'RETRY_QUOTE_DRAFT'
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
                  'STEP_HANDLER_REVIEW_REQUIRED',

                result: {
                  checked:
                    false,

                  handler,

                  reason:
                    'RETRY_QUOTE_HANDLER_REQUIRES_CHECK_CONTEXT',

                  authority:
                    'NO_COMMERCIAL_AUTHORIZATION',
                },
              },
            )
          }

          if (
            this.isCommercialPolicyHandler(
              handler,
            ) &&
            step.type !==
              'CHECK_POLICY'
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
                  'STEP_HANDLER_REVIEW_REQUIRED',

                result: {
                  checked:
                    false,

                  handler,

                  reason:
                    'COMMERCIAL_POLICY_HANDLER_REQUIRES_CHECK_POLICY',

                  authority:
                    'NO_COMMERCIAL_AUTHORIZATION',
                },
              },
            )
          }

          let result:
            StepResult = {
              authority:
                'NO_COMMERCIAL_AUTHORIZATION',

              checked:
                true,
            }

          if (
            step.type ===
              'CHECK_POLICY' &&
            this.isCommercialPolicyHandler(
              handler,
            )
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
              policy.status === 'NEEDS_HUMAN_REVIEW' || policy.status === 'WAITING_CUSTOMER'
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
              'COMPLETED' as const,

            result,
          }
        },
      )
    } catch (
      error
    ) {
      if (
        error instanceof
        NotFoundException
      ) {
        throw error
      }

      await this.recordTechnicalFailure(
        workflowId,
        stepKey,
      )

      return {
        status:
          'RETRY_REQUIRED' as const,
      }
    }
  }
}
