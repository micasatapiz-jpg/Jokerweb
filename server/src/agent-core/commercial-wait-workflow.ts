import type {
  Prisma,
} from '../generated/prisma/client.js'
import {
  AgentOrchestratorService,
} from './agent-orchestrator.service.js'
import {
  transactionScope,
} from './transaction-scope.js'

export async function ensureCommercialWait(
  tx:
    Prisma.TransactionClient,

  tenantId:
    string,

  input: {
    conversationId: string
    jobId?: string
    taskId: string
    ownerReviewId: string
    correlationKey: string

    /*
     * Solo los workflows originados por
     * una cotización pendiente deben
     * intentar nuevamente crear el draft.
     *
     * Un workflow de aprendizaje comercial
     * normal NO debe cotizar automáticamente.
     */
    retryQuoteDraft?: boolean
  },
) {
  const service =
    new AgentOrchestratorService(
      transactionScope(
        tx,
      ),
      {
        tenantId,
      } as never,
    )

  const job =
    input.jobId
      ? await tx.job.findFirstOrThrow({
          where: {
            tenantId,

            id:
              input.jobId,
          },
        })
      : null

  const workflow =
    await service.createWorkflow({
      conversationId:
        input.conversationId,

      jobId:
        input.jobId,

      taskId:
        input.taskId,

      objective:
        'Resolver conocimiento comercial faltante',

      requestKey:
        input.correlationKey,

      correlationKey:
        input.correlationKey,

      context: {
        ownerReviewId:
          input.ownerReviewId,

        jobRevision:
          job?.requirementsRevision ??
          null,

        authority:
          'REFERENCE_ONLY',

        retryQuoteDraft:
          input.retryQuoteDraft ===
          true,
      },

      steps: [
        {
          stepKey:
            'owner-knowledge',

          type:
            'ASK_OWNER',
        },

        {
          stepKey:
            'review-current-rules',

          type:
            'CHECK_POLICY',

          /*
           * Este step únicamente verifica
           * hechos comerciales persistidos.
           *
           * No crea precios ni convierte
           * CommercialKnowledge en reglas.
           */
          input: {
            handler:
              'COMMERCIAL_RULE_GATE',
          },
        },

        /*
         * Este tercer step solo existe cuando
         * el workflow nació de createDraft().
         *
         * Queda persistido para poder recuperarse
         * después de un crash/reinicio.
         */
        ...(input.retryQuoteDraft ===
        true
          ? [
              {
                stepKey:
                  'retry-quote-draft',

                type:
                  'CHECK_CONTEXT' as const,

                input: {
                  handler:
                    'RETRY_QUOTE_DRAFT',
                },
              },
            ]
          : []),
      ],
    })

  if (
    workflow.state ===
    'READY'
  ) {
    await service.wait(
      workflow.id,
      {
        state:
          'WAITING_OWNER',

        actorType:
          'OWNER',

        reason:
          'COMMERCIAL_KNOWLEDGE_REQUIRED',

        followUp: {},

        resumeCondition: {
          eventTypes: [
            'COMMERCIAL_KNOWLEDGE_VERIFIED',
            'OWNER_REVIEW_RESOLVED',
          ],

          jobId:
            input.jobId,

          actorType:
            'OWNER',

          ownerReviewId:
            input.ownerReviewId,
        },
      },
    )
  }

  return workflow.id
}

export async function ensureQuoteWait(
  tx:
    Prisma.TransactionClient,

  tenantId:
    string,

  input: {
    conversationId: string
    jobId: string
    taskId: string
    revision: number
    status: string
    missingFields: string[]
  },
) {
  const correlationKey =
    `quote-wait:${input.jobId}:${input.revision}:${input.status}`

  /*
   * --------------------------------------------------
   * CASO 1
   * --------------------------------------------------
   *
   * Falta una regla comercial.
   *
   * Esperamos al OWNER.
   */
  if (
    input.status ===
    'RULE_NOT_CONFIGURED'
  ) {
    const source =
      await tx.conversationMessage.findFirst({
        where: {
          conversationId:
            input.conversationId,

          direction:
            'INBOUND',
        },

        orderBy: [
          {
            createdAt:
              'desc',
          },
          {
            id:
              'desc',
          },
        ],
      })

    if (
      !source
    ) {
      return
    }

    const review =
      await tx.ownerReview.upsert({
        where: {
          tenantId_dedupeKey: {
            tenantId,

            dedupeKey:
              correlationKey,
          },
        },

        create: {
          tenantId,

          conversationId:
            input.conversationId,

          sourceMessageId:
            source.id,

          reason:
            'COMMERCIAL_KNOWLEDGE_REQUIRED',

          risk:
            30,

          recommendedAction:
            'KEEP_ACTIVE',

          dedupeKey:
            correlationKey,

          details: {
            jobId:
              input.jobId,

            components: [
              {
                key:
                  'productRule',
              },
            ],
          },
        },

        update: {},
      })

    await ensureCommercialWait(
      tx,
      tenantId,
      {
        conversationId:
          input.conversationId,

        jobId:
          input.jobId,

        taskId:
          input.taskId,

        ownerReviewId:
          review.id,

        correlationKey,

        /*
         * IMPORTANTE:
         *
         * Este workflow proviene de un intento
         * real de cotización.
         *
         * Cuando el gate quede READY debe existir
         * un step durable para volver a intentar
         * createDraft().
         */
        retryQuoteDraft:
          true,
      },
    )

    return
  }

  /*
   * --------------------------------------------------
   * CASO 2
   * --------------------------------------------------
   *
   * Falta información del cliente.
   *
   * Esperamos al CUSTOMER.
   */
  if (
    input.missingFields.length
  ) {
    const service =
      new AgentOrchestratorService(
        transactionScope(
          tx,
        ),
        {
          tenantId,
        } as never,
      )

    const workflow =
      await service.createWorkflow({
        conversationId:
          input.conversationId,

        jobId:
          input.jobId,

        taskId:
          input.taskId,

        requestKey:
          correlationKey,

        correlationKey,

        objective:
          'Completar requisitos del cliente',

        context: {
          jobRevision:
            input.revision,

          /*
           * Indica que este workflow
           * nació de createDraft().
           */
          retryQuoteDraft:
            true,
        },

        steps: [
          {
            stepKey:
              'customer-input',

            type:
              'ASK_CUSTOMER',
          },

          {
            stepKey:
              'check-current-policy',

            type:
              'CHECK_POLICY',

            input: {
              handler:
                'QUOTE_READINESS',
            },
          },

          /*
           * El reintento de cotización queda
           * persistido como un step independiente.
           *
           * Si el servidor se apaga después del
           * CHECK_POLICY, el worker lo recuperará.
           */
          {
            stepKey:
              'retry-quote-draft',

            type:
              'CHECK_CONTEXT',

            input: {
              handler:
                'RETRY_QUOTE_DRAFT',
            },
          },
        ],
      })

    if (
      workflow.state ===
      'READY'
    ) {
      await service.wait(
        workflow.id,
        {
          state:
            'WAITING_CUSTOMER',

          actorType:
            'CUSTOMER',

          reason:
            'MISSING_REQUIREMENT',

          followUp: {},

          resumeCondition: {
            jobId:
              input.jobId,

            conversationId:
              input.conversationId,

            eventTypes: [
              'CUSTOMER_MESSAGE_RECEIVED',
              'JOB_REQUIREMENTS_UPDATED',
            ],

            requiredFields: input.missingFields,
          },
        },
      )
    }
  }
}
