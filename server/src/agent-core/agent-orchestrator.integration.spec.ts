import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { AgentOrchestratorService } from './agent-orchestrator.service.js'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'

describe('AgentOrchestratorService integration', () => {
  let db: PrismaService
  let service: AgentOrchestratorService

  beforeAll(async () => {
    const config = new ConfigService({
      DATABASE_URL: process.env.DATABASE_URL,
      DEFAULT_TENANT_ID: TENANT_ID,
    })

    db = new PrismaService(config)
    const tenant = new LocalTenantService(config)

    service = new AgentOrchestratorService(
      db,
      tenant,
    )

    await db.tenant.upsert({
      where: {
        id: TENANT_ID,
      },
      create: {
        id: TENANT_ID,
        name: 'Joker Test',
        slug: `joker-orchestrator-test-${Date.now()}`,
      },
      update: {},
    })
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  it('crea workflow, espera OWNER y reanuda con evento correcto', async () => {
    const workflow = await service.createWorkflow({
      objective: 'Resolver criterio comercial faltante',
      requestKey: `workflow-owner-${Date.now()}`,
      steps: [
        {
          stepKey: 'understand',
          type: 'UNDERSTAND',
        },
        {
          stepKey: 'wait-owner',
          type: 'ASK_OWNER',
        },
        {
          stepKey: 'resume',
          type: 'RESUME',
        },
      ],
    })

    expect(workflow.state).toBe('READY')
    expect(workflow.steps).toHaveLength(3)

    const started = await service.startWorkflow(
      workflow.id,
    )

    expect(started.state).toBe('RUNNING')

    const waiting = await service.wait(
      workflow.id,
      {
        state: 'WAITING_OWNER',
        actorType: 'OWNER',
        reason: 'Falta criterio comercial del propietario',
        resumeCondition: {
          eventTypes: [
            'COMMERCIAL_KNOWLEDGE_VERIFIED',
          ],
          actorType: 'OWNER',
        },
      },
    )

    expect(waiting.state).toBe(
      'WAITING_OWNER',
    )

    const event = await service.emitEvent({
      workflowId: workflow.id,
      type: 'COMMERCIAL_KNOWLEDGE_VERIFIED',
      actorType: 'OWNER',
      sourceKey: `knowledge-event-${Date.now()}`,
      payload: {},
    })

    expect(event.consumedAt).toBeNull()

    const resumed =
      await service.resumeFromEvent(
        event.id,
      )

    expect(resumed.resumed).toBe(true)
    expect(resumed.workflowId).toBe(
      workflow.id,
    )

    const current =
      await service.getWorkflow(
        workflow.id,
      )

    expect(current.state).toBe('RUNNING')

    const storedEvent =
      await db.agentEvent.findUniqueOrThrow({
        where: {
          id: event.id,
        },
      })

    expect(storedEvent.consumedAt).not.toBeNull()
  })

  it('no reanuda workflow con evento de tipo incorrecto', async () => {
    const workflow = await service.createWorkflow({
      objective: 'Esperar información del dueño',
      requestKey: `workflow-wrong-event-${Date.now()}`,
      steps: [
        {
          stepKey: 'wait-owner',
          type: 'ASK_OWNER',
        },
      ],
    })

    await service.startWorkflow(
      workflow.id,
    )

    await service.wait(
      workflow.id,
      {
        state: 'WAITING_OWNER',
        actorType: 'OWNER',
        reason: 'Esperando al dueño',
        resumeCondition: {
          eventTypes: [
            'COMMERCIAL_KNOWLEDGE_VERIFIED',
          ],
          actorType: 'OWNER',
        },
      },
    )

    const event = await service.emitEvent({
      workflowId: workflow.id,
      type: 'CUSTOMER_MESSAGE_RECEIVED',
      actorType: 'CUSTOMER',
      sourceKey: `wrong-event-${Date.now()}`,
      payload: {},
    })

    const result =
      await service.resumeFromEvent(
        event.id,
      )

    expect(result.resumed).toBe(false)

    const current =
      await service.getWorkflow(
        workflow.id,
      )

    expect(current.state).toBe(
      'WAITING_OWNER',
    )
  })

  it('evento duplicado con mismo sourceKey no duplica efecto', async () => {
    const sourceKey =
      `duplicate-event-${Date.now()}`

    const first = await service.emitEvent({
      type: 'MANUAL_RESUME',
      actorType: 'OWNER',
      sourceKey,
      payload: {
        reason: 'test',
      },
    })

    const second = await service.emitEvent({
      type: 'MANUAL_RESUME',
      actorType: 'OWNER',
      sourceKey,
      payload: {
        reason: 'test',
      },
    })

    expect(second.id).toBe(first.id)

    const count = await db.agentEvent.count({
      where: {
        tenantId: TENANT_ID,
        sourceKey,
      },
    })

    expect(count).toBe(1)
  })
})