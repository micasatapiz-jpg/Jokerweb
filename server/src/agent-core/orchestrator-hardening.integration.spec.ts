import {
  randomUUID,
} from 'node:crypto'
import {
  beforeAll,
  afterAll,
  describe,
  it,
  expect,
} from 'vitest'
import {
  ConfigService,
} from '@nestjs/config'
import {
  PrismaService,
} from '../database/prisma.service.js'
import {
  LocalTenantService,
} from '../common/local-tenant.service.js'
import {
  AgentOrchestratorService,
} from './agent-orchestrator.service.js'
import {
  AgentEventWorkerService,
} from './agent-event-worker.service.js'
import {
  OperatorControlsService,
} from './operator-controls.service.js'
import {
  WorkflowOperationsService,
  interruptWorkflows,
} from './workflow-operations.service.js'
import {
  correlateCustomerEvents,
} from './customer-resume-events.js'
import {
  synthesizeTurn,
  emptyUnderstanding,
} from './understanding-v2.js'
import {
  WhatsAppConversationsService,
} from '../whatsapp/whatsapp-conversations.service.js'
import {
  WorkflowStepRunnerService,
} from './workflow-step-runner.service.js'

const url =
  process.env.TEST_DATABASE_URL

if (
  url
) {
  const u =
    new URL(
      url,
    )

  if (
    ![
      'localhost',
      '127.0.0.1',
    ].includes(
      u.hostname,
    ) ||
    u.pathname !==
      '/joker_core_test'
  ) {
    throw new Error(
      'Isolated DB only',
    )
  }
}

describe.skipIf(
  !url,
)(
  'Orchestrator hardening PostgreSQL',
  () => {
    let db:
      PrismaService

    beforeAll(
      () => {
        db =
          new PrismaService(
            new ConfigService({
              DATABASE_URL:
                url,
            }),
          )
      },
    )

    afterAll(
      async () => {
        await db?.$disconnect()
      },
    )

    async function setup() {
      const id =
        randomUUID()

      await db.tenant.create({
        data: {
          id,
          name:
            'Isolated',
          slug:
            id,
        },
      })

      const tenant = {
        tenantId:
          id,
      } as LocalTenantService

      const service =
        new AgentOrchestratorService(
          db,
          tenant,
        )

      const worker =
        new AgentEventWorkerService(
          db,
          tenant,
          service,
        )

      const workflow =
        await service.createWorkflow({
          requestKey:
            randomUUID(),

          objective:
            'Test wait',

          steps: [
            {
              stepKey:
                'wait',

              type:
                'WAIT',
            },
          ],
        })

      const wait =
        () =>
          service.wait(
            workflow.id,
            {
              state:
                'WAITING_OWNER',

              actorType:
                'OWNER',

              reason:
                'Test',

              resumeCondition: {
                actorType:
                  'OWNER',

                eventTypes: [
                  'COMMERCIAL_KNOWLEDGE_VERIFIED',
                ],
              },
            },
          )

      const emit =
        () =>
          service.emitEvent({
            workflowId:
              workflow.id,

            sourceKey:
              'same',

            type:
              'COMMERCIAL_KNOWLEDGE_VERIFIED',

            actorType:
              'OWNER',
          })

      return {
        id,
        tenant,
        service,
        worker,
        workflow,
        wait,
        emit,
      }
    }

    async function withJob() {
      const h =
        await setup()

      const operators =
        new OperatorControlsService(
          db,
          h.tenant,
        )

      const owner =
        await operators.bootstrapOwner({
          name:
            'Owner',

          phone:
            '999111222',

          verifiedBy:
            'isolated fixture',
        })

      const chat =
        await db.conversation.create({
          data: {
            tenantId:
              h.id,

            channel:
              'WHATSAPP',

            externalId:
              '51999000111',

            customerPhone:
              '51999000111',
          },
        })

      const contact =
        await db.contactProfile.create({
          data: {
            tenantId:
              h.id,

            phone:
              chat.customerPhone,
          },
        })

      const job =
        await db.job.create({
          data: {
            tenantId:
              h.id,

            contactProfileId:
              contact.id,

            conversationId:
              chat.id,

            title:
              'Fixture',

            requirementsRevision:
              1,
          },
        })

      await db.agentWorkflow.update({
        where: {
          id:
            h.workflow.id,
        },

        data: {
          jobId:
            job.id,

          conversationId:
            chat.id,

          contextJson: {
            jobRevision:
              1,

            saved:
              'DO_NOT_REINTERPRET',
          },
        },
      })

      const ownerChat =
        await db.conversation.create({
          data: {
            tenantId:
              h.id,

            channel:
              'WHATSAPP',

            externalId:
              owner.externalSubject,

            role:
              'OWNER_PRIVATE',
          },
        })

      const source =
        () =>
          db.conversationMessage.create({
            data: {
              conversationId:
                ownerChat.id,

              direction:
                'INBOUND',

              type:
                'TEXT',

              text:
                'reanudar',

              source:
                'VERIFIED_WEBHOOK',

              senderExternalId:
                owner.externalSubject,
            },
          })

      const emit =
        (
          type =
            'COMMERCIAL_KNOWLEDGE_VERIFIED',

          payload:
            unknown =
            {},
        ) =>
          h.service.emitEvent({
            type,

            workflowId:
              h.workflow.id,

            jobId:
              job.id,

            conversationId:
              chat.id,

            actorType:
              'OWNER',

            sourceKey:
              randomUUID(),

            payload,
          })

      return {
        ...h,
        operators,
        owner,
        chat,
        contact,
        job,
        source,
        emit,

        operations:
          new WorkflowOperationsService(
            db,
            h.tenant,
          ),
      }
    }

    it(
      'atomic emit in two replicas returns one event and rejects actor mismatch',
      async () => {
        const h =
          await setup()

        const b =
          new AgentOrchestratorService(
            db,
            h.tenant,
          )

        const input = {
          workflowId:
            h.workflow.id,

          sourceKey:
            'race',

          type:
            'TIME_REACHED',

          actorType:
            'SYSTEM',
        }

        const [
          a,
          c,
        ] =
          await Promise.all([
            h.service.emitEvent({
              ...input,

              payload: {
                observedAt:
                  1,
              },
            }),

            b.emitEvent({
              ...input,

              payload: {
                observedAt:
                  2,
              },
            }),
          ])

        expect(
          a.id,
        ).toBe(
          c.id,
        )

        expect(
          await db.agentEvent.count({
            where: {
              tenantId:
                h.id,
            },
          }),
        ).toBe(
          1,
        )

        await expect(
          b.emitEvent({
            ...input,

            actorType:
              'CUSTOMER',
          }),
        ).rejects.toThrow()
      },
    )

    it(
      'concurrent timers create one event and resume once',
      async () => {
        const h =
          await setup()

        const now =
          new Date()

        await h.service.wait(
          h.workflow.id,
          {
            state:
              'WAITING_TIME',

            reason:
              'timer',

            wakeAt:
              now,

            actorType:
              'SYSTEM',

            resumeCondition: {
              eventTypes: [
                'TIME_REACHED',
              ],

              actorType:
                'SYSTEM',
            },
          },
        )

        const b =
          new AgentEventWorkerService(
            db,
            h.tenant,
            new AgentOrchestratorService(
              db,
              h.tenant,
            ),
          )

        await Promise.all([
          h.worker.createDueTimerEvents(
            now,
          ),

          b.createDueTimerEvents(
            new Date(
              now.getTime() +
                1,
            ),
          ),
        ])

        await Promise.all([
          h.worker.processPendingEvents(),
          b.processPendingEvents(),
        ])

        expect(
          await db.agentEvent.count({
            where: {
              tenantId:
                h.id,

              type:
                'TIME_REACHED',
            },
          }),
        ).toBe(
          1,
        )

        expect(
          await db.auditLog.count({
            where: {
              tenantId:
                h.id,

              action:
                'WORKFLOW_RESUMED',
            },
          }),
        ).toBe(
          1,
        )
      },
    )

    it(
      'early event backs off then resumes when wait exists',
      async () => {
        const h =
          await setup()

        const e =
          await h.emit()

        await h.worker.processPendingEvents()

        const row =
          await db.agentEvent.findUniqueOrThrow({
            where: {
              id:
                e.id,
            },
          })

        expect(
          row.processingAttempts,
        ).toBe(
          1,
        )

        expect(
          row.nextAttemptAt,
        ).not.toBeNull()

        expect(
          (
            await h.worker.processPendingEvents()
          ).scanned,
        ).toBe(
          0,
        )

        await h.wait()

        expect(
          (
            await h.worker.processPendingEvents(
              100,

              new Date(
                row.nextAttemptAt!.getTime() +
                  1,
              ),
            )
          ).resumed,
        ).toBe(
          1,
        )
      },
    )

    it(
      'ambiguous matches are durably quarantined, not hot-looped',
      async () => {
        const h =
          await setup()

        await h.wait()

        const second =
          await h.service.createWorkflow({
            requestKey:
              'second',

            objective:
              'Test',

            steps: [
              {
                stepKey:
                  'wait',

                type:
                  'WAIT',
              },
            ],
          })

        await h.service.wait(
          second.id,
          {
            state:
              'WAITING_OWNER',

            reason:
              'same',

            resumeCondition: {
              eventTypes: [
                'COMMERCIAL_KNOWLEDGE_VERIFIED',
              ],

              actorType:
                'OWNER',
            },
          },
        )

        const e =
          await h.service.emitEvent({
            sourceKey:
              'ambiguous',

            type:
              'COMMERCIAL_KNOWLEDGE_VERIFIED',

            actorType:
              'OWNER',
          })

        await h.worker.processPendingEvents()

        expect(
          (
            await db.agentEvent.findUniqueOrThrow({
              where: {
                id:
                  e.id,
              },
            })
          ).processingFailedAt,
        ).not.toBeNull()

        expect(
          (
            await h.worker.processPendingEvents()
          ).scanned,
        ).toBe(
          0,
        )
      },
    )

    it(
      'global worker processes independent tenants with same sourceKey',
      async () => {
        const a =
          await setup()

        const b =
          await setup()

        await a.wait()
        await b.wait()
        await a.emit()
        await b.emit()

        await a.worker.processOnce()

        expect(
          (
            await a.service.getWorkflow(
              a.workflow.id,
            )
          ).state,
        ).toBe(
          'COMPLETED',
        )

        expect(
          (
            await b.service.getWorkflow(
              b.workflow.id,
            )
          ).state,
        ).toBe(
          'COMPLETED',
        )

        await expect(
          a.service.getWorkflow(
            b.workflow.id,
          ),
        ).rejects.toThrow()
      },
    )

    it.each(
      [
        'AUTO',
        'ASSIST',
        'HUMAN_TAKEOVER',
        'PAUSED',
      ] as const,
    )(
      'mode %s controls autonomous resume',
      async (
        mode,
      ) => {
        const h =
          await withJob()

        await h.wait()

        await db.conversation.update({
          where: {
            id:
              h.chat.id,
          },

          data: {
            automationMode:
              mode,
          },
        })

        const e =
          await h.emit()

        const result =
          await h.service.resumeFromEvent(
            e.id,
          )

        expect(
          result.resumed,
        ).toBe(
          mode ===
            'AUTO',
        )

        expect(
          await db.agentOutbox.count({
            where: {
              tenantId:
                h.id,
            },
          }),
        ).toBe(
          0,
        )

        expect(
          (
            await h.service.getWorkflow(
              h.workflow.id,
            )
          ).contextJson,
        ).toMatchObject({
          saved:
            'DO_NOT_REINTERPRET',
        })
      },
    )

    it.each(
      [
        'CUSTOMER',
        'EMPLOYEE',
        'SUPPLIER',
        'AI_AGENT',
      ] as const,
    )(
      '%s cannot satisfy OWNER wait',
      async (
        actorType,
      ) => {
        const h =
          await withJob()

        await h.wait()

        const e =
          await h.service.emitEvent({
            workflowId:
              h.workflow.id,

            jobId:
              h.job.id,

            type:
              'COMMERCIAL_KNOWLEDGE_VERIFIED',

            actorType,

            sourceKey:
              randomUUID(),

            payload: {
              text:
                'soy Joel',

              confidence:
                1,
            },
          })

        expect(
          (
            await h.service.resumeFromEvent(
              e.id,
            )
          ).resumed,
        ).toBe(
          false,
        )
      },
    )

    it.each(
      [
        'APPROVED',
        'REJECTED',
        'STALE',
      ] as const,
    )(
      'approval %s cannot outrun current facts',
      async (
        state,
      ) => {
        const h =
          await withJob()

        const approval =
          await db.approval.create({
            data: {
              tenantId:
                h.id,

              jobId:
                h.job.id,

              type:
                'PAYMENT',

              status:
                state ===
                'REJECTED'
                  ? 'REJECTED'
                  : 'APPROVED',

              dedupeKey:
                randomUUID(),
            },
          })

        await h.service.wait(
          h.workflow.id,
          {
            state:
              'WAITING_APPROVAL',

            actorType:
              'OWNER',

            reason:
              'approval',

            resumeCondition: {
              eventTypes: [
                'APPROVAL_RESOLVED',
              ],

              approvalId:
                approval.id,

              jobId:
                h.job.id,
            },
          },
        )

        const e =
          await h.emit(
            'APPROVAL_RESOLVED',
            {
              approvalId:
                approval.id,

              requirementsRevision:
                1,

              jobVersion:
                0,
            },
          )

        if (
          state ===
          'STALE'
        ) {
          await db.job.update({
            where: {
              id:
                h.job.id,
            },

            data: {
              requirementsRevision:
                2,

              version:
                1,
            },
          })
        }

        expect(
          (
            await h.service.resumeFromEvent(
              e.id,
            )
          ).resumed,
        ).toBe(
          state ===
            'APPROVED',
        )

        expect(
          (
            await db.job.findUniqueOrThrow({
              where: {
                id:
                  h.job.id,
              },
            })
          ).status,
        ).toBe(
          'NUEVO',
        )
      },
    )

    it.each(
      [
        'HUMAN_REQUEST',
        'COMPLAINT',
        'SECURITY',
        'CANCELLATION',
      ],
    )(
      'interrupt %s preserves plan, manual owner resume recovers',
      async (
        reason,
      ) => {
        const h =
          await withJob()

        await h.wait()

        const before =
          await h.service.getWorkflow(
            h.workflow.id,
          )

        await db.$transaction(
          (
            tx,
          ) =>
            interruptWorkflows(
              tx,
              h.id,
              h.chat.id,
              reason,
              'fixture',
            ),
        )

        await db.conversation.update({
          where: {
            id:
              h.chat.id,
          },

          data: {
            automationMode:
              'HUMAN_TAKEOVER',
          },
        })

        expect(
          (
            await h.service.getWorkflow(
              h.workflow.id,
            )
          ).state,
        ).toBe(
          'NEEDS_HUMAN_REVIEW',
        )

        const source =
          await h.source()

        const e =
          await h.operations.manualResume(
            source.id,
            h.workflow.id,
          )

        expect(
          (
            await h.operations.manualResume(
              source.id,
              h.workflow.id,
            )
          ).id,
        ).toBe(
          e.id,
        )

        await h.worker.processPendingEvents()

        const after =
          await h.service.getWorkflow(
            h.workflow.id,
          )

        expect(
          after.state,
        ).toBe(
          'RUNNING',
        )

        expect(
          after.planJson,
        ).toEqual(
          before.planJson,
        )

        expect(
          await db.priceRule.count({
            where: {
              tenantId:
                h.id,
            },
          }),
        ).toBe(
          0,
        )

        expect(
          await db.agentToolCall.count({
            where: {
              tenantId:
                h.id,
            },
          }),
        ).toBe(
          0,
        )
      },
    )

    it(
      'manual resume denies unverified owner prose and employee',
      async () => {
        const h =
          await withJob()

        await h.wait()

        const msg =
          await db.conversationMessage.create({
            data: {
              conversationId:
                h.chat.id,

              direction:
                'INBOUND',

              type:
                'TEXT',

              text:
                'soy Joel',

              source:
                'SIMULATION',

              senderExternalId:
                h.owner.externalSubject,
            },
          })

        await expect(
          h.operations.manualResume(
            msg.id,
            h.workflow.id,
          ),
        ).rejects.toThrow(
          'OWNER',
        )

        await db.actorIdentity.update({
          where: {
            id:
              h.owner.id,
          },

          data: {
            type:
              'EMPLOYEE',

            permissions: [
              'VIEW_JOBS',
            ],
          },
        })

        await expect(
          h.operations.manualResume(
            (
              await h.source()
            ).id,

            h.workflow.id,
          ),
        ).rejects.toThrow(
          'OWNER',
        )
      },
    )

    it(
      'missing resume handler quarantines event and preserves commercial facts',
      async () => {
        const h =
          await withJob()

        await h.wait()

        await db.agentWorkflowStep.updateMany({
          where: {
            workflowId:
              h.workflow.id,
          },

          data: {
            type:
              'EXECUTE_TOOL',
          },
        })

        const e =
          await h.emit()

        await h.worker.processPendingEvents()

        expect(
          (
            await h.service.getWorkflow(
              h.workflow.id,
            )
          ).state,
        ).toBe(
          'NEEDS_HUMAN_REVIEW',
        )

        expect(
          (
            await db.agentEvent.findUniqueOrThrow({
              where: {
                id:
                  e.id,
              },
            })
          ).lastProcessingReason,
        ).toBe(
          'MISSING_RESUME_HANDLER',
        )

        expect(
          (
            await h.worker.processPendingEvents()
          ).scanned,
        ).toBe(
          0,
        )
      },
    )

    it.each(
      [
        'measurement',
        'unrelated',
        'file',
        'ambiguous',
        'two-jobs',
        'wrong-job',
      ] as const,
    )(
      'customer correlation: %s',
      async (
        kind,
      ) => {
        const h =
          await withJob()

        const isFile =
          [
            'file',
            'ambiguous',
            'two-jobs',
          ].includes(
            kind,
          )

        await h.service.wait(
          h.workflow.id,
          {
            state:
              'WAITING_CUSTOMER',

            actorType:
              'CUSTOMER',

            reason:
              'need input',

            resumeCondition: {
              jobId:
                h.job.id,

              conversationId:
                h.chat.id,

              eventTypes: [
                'CUSTOMER_MESSAGE_RECEIVED',
                'CUSTOMER_FILE_RECEIVED',
              ],

              ...(isFile
                ? {
                    fileType:
                      'IMAGE',
                  }
                : {
                    requiredFields: [
                      'width',
                      'height',
                    ],
                  }),
            },
          },
        )

        if (
          kind ===
          'two-jobs'
        ) {
          await db.job.create({
            data: {
              tenantId:
                h.id,

              contactProfileId:
                h.contact.id,

              conversationId:
                h.chat.id,

              title:
                'Second',
            },
          })
        }

        const message =
          await db.conversationMessage.create({
            data: {
              conversationId:
                h.chat.id,

              direction:
                'INBOUND',

              type:
                isFile &&
                kind !==
                  'ambiguous'
                  ? 'IMAGE'
                  : 'TEXT',

              text:
                'fixture',

              source:
                'SIMULATION',

              senderExternalId:
                h.chat.externalId,
            },
          })

        const u =
          emptyUnderstanding()

        if (
          kind ===
          'measurement'
        ) {
          u.entities = [
            {
              key:
                'width',

              value:
                20,
            },
            {
              key:
                'height',

              value:
                30,
            },
          ]
        }

        await db.$transaction(
          (
            tx,
          ) =>
            correlateCustomerEvents(
              tx,
              h.id,
              h.chat,
              synthesizeTurn([
                message,
              ]),
              u,
            ),
        )

        if (
          kind ===
          'wrong-job'
        ) {
          const other =
            await db.job.create({
              data: {
                tenantId:
                  h.id,

                contactProfileId:
                  h.contact.id,

                conversationId:
                  h.chat.id,

                title:
                  'Other',
              },
            })

          await h.service.emitEvent({
            workflowId:
              h.workflow.id,

            jobId:
              other.id,

            conversationId:
              h.chat.id,

            type:
              'CUSTOMER_MESSAGE_RECEIVED',

            actorType:
              'CUSTOMER',

            sourceKey:
              randomUUID(),

            payload: {
              fields: [
                'width',
                'height',
              ],
            },
          })
        }

        await h.worker.processPendingEvents()

        expect(
          (
            await h.service.getWorkflow(
              h.workflow.id,
            )
          ).state,
        ).toBe(
          [
            'measurement',
            'file',
          ].includes(
            kind,
          )
            ? 'RUNNING'
            : 'WAITING_CUSTOMER',
        )
      },
    )

    it(
      'customer ingest atomically records event, duplicate source produces no second message',
      async () => {
        const h =
          await setup()

        const channel =
          new WhatsAppConversationsService(
            db,
            h.tenant,
          )

        const input = {
          from:
            '51999000222',

          externalMessageId:
            'fixture-1',

          type:
            'IMAGE' as const,

          source:
            'SIMULATION' as const,
        }

        const [
          a,
          b,
        ] =
          await Promise.all([
            channel.ingest(
              input,
            ),

            channel.ingest(
              input,
            ),
          ])

        expect(
          Number(
            a.duplicate,
          ) +
            Number(
              b.duplicate,
            ),
        ).toBe(
          1,
        )

        expect(
          await db.agentEvent.count({
            where: {
              tenantId:
                h.id,

              type:
                'CUSTOMER_FILE_RECEIVED',
            },
          }),
        ).toBe(
          1,
        )

        expect(
          await db.conversationMessage.count({
            where: {
              conversation: {
                tenantId:
                  h.id,
              },
            },
          }),
        ).toBe(
          1,
        )
      },
    )

    it.each(
      [
        false,
        true,
      ],
    )(
      'employee resume permission granted=%s',
      async (
        granted,
      ) => {
        const h =
          await withJob()

        await db.actorIdentity.update({
          where: {
            id:
              h.owner.id,
          },

          data: {
            type:
              'EMPLOYEE',

            permissions:
              granted
                ? [
                    'UPDATE_REQUIREMENTS',
                  ]
                : [],
          },
        })

        await h.service.wait(
          h.workflow.id,
          {
            state:
              'WAITING_EMPLOYEE',

            actorType:
              'EMPLOYEE',

            reason:
              'requirements',

            resumeCondition: {
              jobId:
                h.job.id,

              eventTypes: [
                'JOB_REQUIREMENTS_UPDATED',
              ],

              requiredPermission:
                'UPDATE_REQUIREMENTS',
            },
          },
        )

        const e =
          await h.service.emitEvent({
            workflowId:
              h.workflow.id,

            jobId:
              h.job.id,

            type:
              'JOB_REQUIREMENTS_UPDATED',

            actorType:
              'EMPLOYEE',

            sourceKey:
              randomUUID(),

            payload: {
              actorId:
                h.owner.id,
            },
          })

        expect(
          (
            await h.service.resumeFromEvent(
              e.id,
            )
          ).resumed,
        ).toBe(
          granted,
        )
      },
    )

    it(
      'step transaction failure rolls back effect; retry and replay create one task',
      async () => {
        const h =
          await withJob()

        await db.agentWorkflowStep.updateMany({
          where: {
            workflowId:
              h.workflow.id,
          },

          data: {
            type:
              'CREATE_TASK',
          },
        })

        await h.service.startWorkflow(
          h.workflow.id,
        )

        let fail =
          true

        const faultDb =
          new Proxy(
            db,
            {
              get(
                target,
                key,
              ) {
                if (
                  key ===
                  '$transaction'
                ) {
                  return (
                    work:
                      Function,
                  ) =>
                    db.$transaction(
                      (
                        tx,
                      ) =>
                        work(
                          new Proxy(
                            tx,
                            {
                              get(
                                t,
                                k,
                              ) {
                                if (
                                  k ===
                                  'auditLog'
                                ) {
                                  return {
                                    ...t.auditLog,

                                    create:
                                      async (
                                        args:
                                          any,
                                      ) => {
                                        if (
                                          fail &&
                                          args.data.action ===
                                            'WORKFLOW_STEP_COMPLETED'
                                        ) {
                                          fail =
                                            false

                                          throw new Error(
                                            'fixture crash after task',
                                          )
                                        }

                                        return t.auditLog.create(
                                          args,
                                        )
                                      },
                                  }
                                }

                                return Reflect.get(
                                  t,
                                  k,
                                )
                              },
                            },
                          ),
                        ),
                    )
                }

                return Reflect.get(
                  target,
                  key,
                )
              },
            },
          )

        const runner =
          new WorkflowStepRunnerService(
            faultDb,
            h.tenant,
          )

        expect(
          (
            await runner.run(
              h.workflow.id,
              'wait',
            )
          ).status,
        ).toBe(
          'RETRY_REQUIRED',
        )

        expect(
          await db.task.count({
            where: {
              tenantId:
                h.id,
            },
          }),
        ).toBe(
          0,
        )

        expect(
          (
            await runner.run(
              h.workflow.id,
              'wait',
            )
          ).status,
        ).toBe(
          'COMPLETED',
        )

        expect(
          (
            await runner.run(
              h.workflow.id,
              'wait',
            )
          ).status,
        ).toBe(
          'REPLAY',
        )

        expect(
          await db.task.count({
            where: {
              tenantId:
                h.id,
            },
          }),
        ).toBe(
          1,
        )

        expect(
          await db.agentOutbox.count({
            where: {
              tenantId:
                h.id,
            },
          }),
        ).toBe(
          0,
        )
      },
    )

    /*
     * ---------------------------------------------------
     * COMMERCIAL RULE GATE
     * ---------------------------------------------------
     */

    it(
      'commercial rule gate fails closed when product is missing',
      async () => {
        const h =
          await withJob()

        await db.agentWorkflowStep.updateMany({
          where: {
            workflowId:
              h.workflow.id,
          },

          data: {
            type:
              'CHECK_POLICY',

            inputJson: {
              handler:
                'COMMERCIAL_RULE_GATE',
            },
          },
        })

        await h.service.startWorkflow(
          h.workflow.id,
        )

        const runner =
          new WorkflowStepRunnerService(
            db,
            h.tenant,
          )

        const result =
          await runner.run(
            h.workflow.id,
            'wait',
          )

        expect(
          result.status,
        ).toBe(
          'NEEDS_HUMAN_REVIEW',
        )

        const current =
          await h.service.getWorkflow(
            h.workflow.id,
          )

        expect(
          current.state,
        ).toBe(
          'NEEDS_HUMAN_REVIEW',
        )

        expect(
          current.waitingReason,
        ).toBe(
          'PRODUCT_NOT_SELECTED',
        )

        expect(
          current.currentStep,
        ).toBe(
          0,
        )

        const step =
          await db.agentWorkflowStep.findFirstOrThrow({
            where: {
              tenantId:
                h.id,

              workflowId:
                h.workflow.id,
            },
          })

        expect(
          step.status,
        ).not.toBe(
          'COMPLETED',
        )

        expect(
          step.attempt,
        ).toBe(
          0,
        )
      },
    )

    it(
      'commercial rule gate rejects stale job revision',
      async () => {
        const h =
          await withJob()

        const product =
          await db.product.create({
            data: {
              tenantId:
                h.id,

              name:
                'Producto gate stale',

              slug:
                `producto-gate-stale-${randomUUID()}`,

              category:
                'TEST',
            },
          })

        await db.job.update({
          where: {
            id:
              h.job.id,
          },

          data: {
            productId:
              product.id,

            requirementsRevision:
              2,
          },
        })

        await db.agentWorkflowStep.updateMany({
          where: {
            workflowId:
              h.workflow.id,
          },

          data: {
            type:
              'CHECK_POLICY',

            inputJson: {
              handler:
                'COMMERCIAL_RULE_GATE',
            },
          },
        })

        await h.service.startWorkflow(
          h.workflow.id,
        )

        const runner =
          new WorkflowStepRunnerService(
            db,
            h.tenant,
          )

        const result =
          await runner.run(
            h.workflow.id,
            'wait',
          )

        expect(
          result.status,
        ).toBe(
          'NEEDS_HUMAN_REVIEW',
        )

        const current =
          await h.service.getWorkflow(
            h.workflow.id,
          )

        expect(
          current.state,
        ).toBe(
          'NEEDS_HUMAN_REVIEW',
        )

        expect(
          current.waitingReason,
        ).toBe(
          'STALE_COMMERCIAL_CONTEXT',
        )

        expect(
          current.currentStep,
        ).toBe(
          0,
        )
      },
    )

    it(
      'commercial rule gate does not accept verified knowledge as executable pricing rule',
      async () => {
        const h =
          await withJob()

        const product =
          await db.product.create({
            data: {
              tenantId:
                h.id,

              name:
                'Producto sin regla ejecutable',

              slug:
                `producto-sin-regla-${randomUUID()}`,

              category:
                'TEST',
            },
          })

        await db.job.update({
          where: {
            id:
              h.job.id,
          },

          data: {
            productId:
              product.id,

            requirements: {
              width:
                2,

              height:
                3,
            },
          },
        })

        await db.commercialKnowledge.create({
          data: {
            tenantId:
              h.id,

            title:
              'Referencia comercial del owner',

            category:
              'CAPABILITY',

            componentKey:
              'productRule',

            scope:
              'REUSABLE_REFERENCE',

            status:
              'VERIFIED_REFERENCE',

            sourceType:
              'OWNER',

            verifiedByActorId:
              h.owner.id,

            verifiedAt:
              new Date(),

            contentJson: {
              note:
                'El OWNER indicó una referencia comercial.',
            },

            applicabilityJson: {
              productId:
                product.id,
            },

            requestKey:
              `commercial-gate-reference:${randomUUID()}`,
          },
        })

        await db.agentWorkflowStep.updateMany({
          where: {
            workflowId:
              h.workflow.id,
          },

          data: {
            type:
              'CHECK_POLICY',

            inputJson: {
              handler:
                'COMMERCIAL_RULE_GATE',
            },
          },
        })

        await h.service.startWorkflow(
          h.workflow.id,
        )

        const runner =
          new WorkflowStepRunnerService(
            db,
            h.tenant,
          )

        const result =
          await runner.run(
            h.workflow.id,
            'wait',
          )

        expect(
          result.status,
        ).toBe(
          'NEEDS_HUMAN_REVIEW',
        )

        const current =
          await h.service.getWorkflow(
            h.workflow.id,
          )

        expect(
          current.state,
        ).toBe(
          'NEEDS_HUMAN_REVIEW',
        )

        expect(
          current.waitingReason,
        ).toBe(
          'COMMERCIAL_RULE_NOT_CONFIGURED',
        )

        expect(
          await db.productConfiguration.count({
            where: {
              tenantId:
                h.id,

              productId:
                product.id,
            },
          }),
        ).toBe(
          0,
        )

        expect(
          await db.priceRule.count({
            where: {
              tenantId:
                h.id,

              productId:
                product.id,
            },
          }),
        ).toBe(
          0,
        )

        const step =
          await db.agentWorkflowStep.findFirstOrThrow({
            where: {
              tenantId:
                h.id,

              workflowId:
                h.workflow.id,
            },
          })

        expect(
          step.status,
        ).not.toBe(
          'COMPLETED',
        )

        expect(
          step.attempt,
        ).toBe(
          0,
        )
      },
    )

    it(
      'commercial rule gate completes when executable commercial policy exists',
      async () => {
        const h =
          await withJob()

        const product =
          await db.product.create({
            data: {
              tenantId:
                h.id,

              name:
                'Producto comercial válido',

              slug:
                `producto-commercial-ready-${randomUUID()}`,

              category:
                'TEST',
            },
          })

        await db.job.update({
          where: {
            id:
              h.job.id,
          },

          data: {
            productId:
              product.id,

            requirements: {
              quantity:
                2,
            },
          },
        })

        const configuration =
          await db.productConfiguration.create({
            data: {
              tenantId:
                h.id,

              productId:
                product.id,

              version:
                1,

              updatedBy:
                h.owner.id,

              rules: {
                isActive:
                  true,

                validFrom:
                  null,

                validUntil:
                  null,

                commercialPricing:
                  null,

                quotationRules: {
                  requiredFields: [
                    'quantity',
                  ],

                  optionalFields:
                    [],

                  fields: {
                    quantity: {
                      question:
                        '¿Cuántas unidades necesitas?',

                      type:
                        'number',

                      min:
                        1,
                    },
                  },

                  technicalRequirements:
                    [],

                  materials:
                    [],

                  finishes:
                    [],

                  requiresDesign:
                    false,

                  pricingEngine:
                    'STANDARD_AREA_V1',

                  pricingInputs: {
                    quantity: {
                      source:
                        'field',

                      field:
                        'quantity',
                    },

                    widthM:
                      null,

                    heightM:
                      null,

                    includeDesign: {
                      source:
                        'constant',

                      value:
                        false,
                    },

                    installationRequired: {
                      source:
                        'constant',

                      value:
                        false,
                    },

                    includeTransport: {
                      source:
                        'constant',

                      value:
                        false,
                    },
                  },

                  validityDays:
                    15,
                },

                autoQuoteEnabled:
                  false,

                requiresHumanReview:
                  true,
              },
            },
          })

        const priceRule =
          await db.priceRule.create({
            data: {
              tenantId:
                h.id,

              productId:
                product.id,

              name:
                'Tarifa real de prueba',

              basePrice:
                100,

              isDemo:
                false,

              isActive:
                true,

              validFrom:
                new Date(
                  Date.now() -
                    60_000,
                ),
            },
          })

        await db.agentWorkflowStep.updateMany({
          where: {
            workflowId:
              h.workflow.id,
          },

          data: {
            type:
              'CHECK_POLICY',

            inputJson: {
              handler:
                'COMMERCIAL_RULE_GATE',
            },
          },
        })

        await h.service.startWorkflow(
          h.workflow.id,
        )

        const runner =
          new WorkflowStepRunnerService(
            db,
            h.tenant,
          )

        const result =
          await runner.run(
            h.workflow.id,
            'wait',
          )

        expect(
          result.status,
        ).toBe(
          'COMPLETED',
        )

        const current =
          await h.service.getWorkflow(
            h.workflow.id,
          )

        expect(
          current.state,
        ).toBe(
          'RUNNING',
        )

        expect(
          current.currentStep,
        ).toBe(
          1,
        )

        const step =
          await db.agentWorkflowStep.findFirstOrThrow({
            where: {
              tenantId:
                h.id,

              workflowId:
                h.workflow.id,
            },
          })

        expect(
          step.status,
        ).toBe(
          'COMPLETED',
        )

        expect(
          step.attempt,
        ).toBe(
          1,
        )

        expect(
          step.resultJson,
        ).toMatchObject({
          checked:
            true,

          handler:
            'COMMERCIAL_RULE_GATE',

          commercialRuleReady:
            true,

          productId:
            product.id,

          requirementsRevision:
            1,

          configurationId:
            configuration.id,

          configurationVersion:
            1,

          priceRuleId:
            priceRule.id,

          authority:
            'NO_COMMERCIAL_AUTHORIZATION',
        })

        /*
         * Superar el gate NO significa que
         * Joker haya enviado o aprobado precio.
         */
        expect(
          await db.quote.count({
            where: {
              tenantId:
                h.id,
            },
          }),
        ).toBe(
          0,
        )

        expect(
          await db.agentOutbox.count({
            where: {
              tenantId:
                h.id,
            },
          }),
        ).toBe(
          0,
        )
      },
    )

    it(
      'retry exhaustion persists review state without deleting the event',
      async () => {
        const h =
          await setup()

        const event =
          await h.emit()

        for (
          let i =
            0;
          i <
          12;
          i++
        ) {
          await h.service.resumeFromEvent(
            event.id,

            new Date(
              Date.now() +
                86400000 *
                  (
                    i +
                    1
                  ),
            ),
          )
        }

        const row =
          await db.agentEvent.findUniqueOrThrow({
            where: {
              id:
                event.id,
            },
          })

        expect(
          row.processingAttempts,
        ).toBe(
          12,
        )

        expect(
          row.processingFailedAt,
        ).not.toBeNull()

        expect(
          row.consumedAt,
        ).toBeNull()

        expect(
          (
            await h.worker.processPendingEvents()
          ).scanned,
        ).toBe(
          0,
        )
      },
    )
  },
)