import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { AgentOrchestratorService } from './agent-orchestrator.service.js'
import { AgentEventWorkerService } from './agent-event-worker.service.js'
import { WaitFollowUpService } from './wait-follow-up.service.js'
import { WorkflowStepRunnerService } from './workflow-step-runner.service.js'
import { correlateCustomerEvents } from './customer-resume-events.js'
import { DeterministicUnderstanding } from './deterministic-understanding.js'
import { synthesizeTurn } from './understanding-v2.js'
import { waitContext } from './waiting-engine.js'
import { productConfigurationSchema } from './product-configuration.schema.js'

const url = process.env.TEST_DATABASE_URL
if (url && (!['localhost','127.0.0.1'].includes(new URL(url).hostname) || new URL(url).pathname !== '/joker_core_test')) throw new Error('Isolated PostgreSQL only')
describe.skipIf(!url)('Generic waiting engine PostgreSQL', () => {
  let db: PrismaService
  beforeAll(() => { db = new PrismaService(new ConfigService({DATABASE_URL: url})) })
  afterAll(async () => { await db?.$disconnect() })

  async function setup(fields = ['width','height'], fileType?: string) {
    const id = randomUUID()
    await db.tenant.create({data: {id, slug: id, name: 'Isolated waiting'}})
    const tenant = {tenantId: id} as LocalTenantService
    const chat = await db.conversation.create({data: {tenantId: id, channel: 'WHATSAPP', externalId: '51999911122'}})
    const contact = await db.contactProfile.create({data: {tenantId: id, phone: '51999911122', name: 'Isolated customer'}})
    const job = await db.job.create({data: {tenantId: id, conversationId: chat.id, contactProfileId: contact.id, title: 'Waiting fixture', requirementsRevision: 1}})
    const service = new AgentOrchestratorService(db, tenant)
    const worker = new AgentEventWorkerService(db, tenant, service)
    const follow = new WaitFollowUpService(db, tenant)
    const workflow = await service.createWorkflow({conversationId: chat.id, jobId: job.id, requestKey: randomUUID(), objective: 'Wait input', context: {jobRevision: 1},
      steps: [{stepKey: 'wait', type: 'WAIT'}, {stepKey: 'next', type: 'CHECK_CONTEXT'}]})
    await service.wait(workflow.id, {state: 'WAITING_CUSTOMER', actorType: 'CUSTOMER', reason: 'Missing data',
      followUp: {firstDelayMs: 60_000, secondDelayMs: 60_000, maxFollowUps: 2, backoff: 2},
      resumeCondition: {jobId: job.id, conversationId: chat.id, eventTypes: ['CUSTOMER_MESSAGE_RECEIVED','CUSTOMER_FILE_RECEIVED','JOB_REQUIREMENTS_UPDATED'],
        requiredFields: fields, ...(fileType ? {fileType} : {})}})
    const current = () => service.getWorkflow(workflow.id)
    const event = async (values: Record<string, unknown>, extra: Record<string, unknown> = {}, actorType = 'CUSTOMER', sourceKey = randomUUID()) => {
      const w = await current()
      return service.emitEvent({workflowId: workflow.id, conversationId: chat.id, jobId: job.id, actorType,
        type: 'CUSTOMER_MESSAGE_RECEIVED', sourceKey, payload: {waitInput: true, waitEpoch: waitContext(w)?.epoch, values, ...extra}})
    }
    const message = async (text: string) => {
      const m = await db.conversationMessage.create({data: {conversationId: chat.id, type: 'TEXT', direction: 'INBOUND', text,
        senderExternalId: chat.externalId, source: 'SIMULATION', status: 'PROCESSED'}})
      const turn = synthesizeTurn([m])
      const u = await new DeterministicUnderstanding().interpretTurn(turn, [])
      await db.$transaction(tx => correlateCustomerEvents(tx, id, chat, turn, u))
      return m
    }
    const due = async () => new Date(waitContext(await current())!.nextCheckAt!)
    return {id, tenant, chat, contact, job, workflow, service, worker, follow, current, event, message, due}
  }

  it('A/M: unrelated designs query leaves wait and conversation available', async () => {
    const h = await setup()
    await h.message('¿Qué diseños tienes en beige?')
    expect((await h.worker.processPendingEvents()).resumed).toBe(0)
    expect((await h.current()).state).toBe('WAITING_CUSTOMER')
    const other = await h.service.createWorkflow({conversationId: h.chat.id, requestKey: randomUUID(), objective: 'Design query', steps: [{stepKey:'answer',type:'CHECK_CONTEXT'}]})
    await h.service.startWorkflow(other.id)
    await h.worker.processRunnableWorkflows()
    expect((await h.service.getWorkflow(other.id)).state).toBe('COMPLETED')
    expect((await db.conversation.findUniqueOrThrow({where: {id:h.chat.id}})).automationMode).toBe('AUTO')
  })

  it('B/G/N: natural measurements -> correlated event -> concurrent workers -> next step exactly once', async () => {
    const h = await setup()
    const m = await h.message('Son 2.5 x 3 metros')
    const event = await db.agentEvent.findFirstOrThrow({where:{tenantId:h.id,workflowId:h.workflow.id}})
    const results = await Promise.all([h.service.resumeFromEvent(event.id),h.service.resumeFromEvent(event.id)])
    expect(results.filter(r=>r.resumed)).toHaveLength(1)
    expect(waitContext(await h.current())?.values).toEqual({width:2.5,height:3})
    expect((await h.current()).currentStep).toBe(1)
    await h.worker.processRunnableWorkflows()
    expect((await h.current()).state).toBe('COMPLETED')
    expect(await db.auditLog.count({where:{tenantId:h.id,action:'WORKFLOW_RESUMED'}})).toBe(1)
    expect(event.sourceKey).toContain(m.id)
  })

  it('C: partial values persist across service restart and only quantity completes', async () => {
    const h = await setup(['width','height','quantity'])
    await h.message('2.5 x 3 metros')
    await h.worker.processPendingEvents()
    expect((await h.current()).state).toBe('WAITING_CUSTOMER')
    expect(waitContext(await h.current())?.values).toEqual({width:2.5,height:3})
    const e = await h.event({quantity:2})
    expect((await new AgentOrchestratorService(db,h.tenant).resumeFromEvent(e.id)).resumed).toBe(true)
    expect(waitContext(await h.current())?.values).toEqual({width:2.5,height:3,quantity:2})
  })

  it('D: explicit catalog replacement supersedes photo and cancels future timers', async () => {
    const h = await setup([], 'IMAGE')
    const product = await db.product.create({data:{tenantId:h.id,name:'Modelo X',slug:randomUUID(),category:'TEST'}})
    const e = await h.event({}, {supersede:true,replacementProductId:product.id})
    expect((await h.service.resumeFromEvent(e.id)).reason).toBe('SUPERSEDED')
    expect((await h.current()).state).toBe('CANCELLED')
    const late = await h.event({}, {fileType:'IMAGE'})
    expect((await h.service.resumeFromEvent(late.id)).resumed).toBe(false)
    expect((await h.follow.processDue(new Date(Date.now()+86400_000))).created).toBe(0)
  })

  it('E: CUSTOMER cannot satisfy OWNER even with matching data', async () => {
    const h = await setup()
    await db.agentWorkflow.update({where:{id:h.workflow.id},data:{state:'WAITING_OWNER',waitingForActorType:'OWNER'}})
    const e = await h.event({width:2,height:3})
    expect((await h.service.resumeFromEvent(e.id)).resumed).toBe(false)
    expect((await h.current()).state).toBe('WAITING_OWNER')
  })

  it('F: two disjoint waits in one chat only correlate relevant workflow', async () => {
    const h = await setup()
    const other = await h.service.createWorkflow({conversationId:h.chat.id,jobId:h.job.id,requestKey:randomUUID(),objective:'Reference',steps:[{stepKey:'image',type:'WAIT'}]})
    await h.service.wait(other.id,{state:'WAITING_CUSTOMER',actorType:'CUSTOMER',reason:'Reference',resumeCondition:{eventTypes:['CUSTOMER_FILE_RECEIVED'],fileType:'IMAGE'}})
    await h.message('2.5 x 3 metros')
    expect((await h.worker.processPendingEvents()).resumed).toBe(1)
    expect((await h.service.getWorkflow(other.id)).state).toBe('WAITING_CUSTOMER')
  })

  it('H/J: replicas and duplicate timer create one task per ordinal and stop at max', async () => {
    const h = await setup()
    const first = await h.due()
    const r = await Promise.all([h.follow.processDue(first),h.follow.processDue(first)])
    expect(r.reduce((sum,x)=>sum+x.created,0)).toBe(1)
    expect((await h.follow.processDue(first)).created).toBe(0)
    await h.follow.processDue(await h.due())
    await h.follow.processDue(new Date(first.getTime()+30*86400_000))
    expect(await db.task.count({where:{tenantId:h.id}})).toBe(2)
    expect(waitContext(await h.current())?.followUpCount).toBe(2)
    expect(waitContext(await h.current())?.nextCheckAt).toBeNull()
    expect(await db.agentOutbox.count({where:{tenantId:h.id}})).toBe(0)
  })

  it('I: response queued or consumed before timer prevents reminder', async () => {
    const h = await setup()
    const due = await h.due()
    const e = await h.event({width:2,height:3})
    expect((await h.follow.processDue(due)).created).toBe(0)
    await h.service.resumeFromEvent(e.id)
    expect((await h.follow.processDue(due)).created).toBe(0)
  })

  it('K: crash after task effect before wait receipt rolls back, retry produces one task', async () => {
    const h = await setup()
    let crash = true
    const wrapped = new Proxy(db,{get(target,key){
      if(key==='$transaction')return (work: (tx:any)=>Promise<unknown>) => target.$transaction(tx => work(new Proxy(tx,{get(t,k){
        if(k==='agentWorkflow')return new Proxy(t.agentWorkflow,{get(model,op){
          if(op==='update')return async (...args:any[]) => {if(crash){crash=false;throw new Error('after effect before receipt')} return (model.update as any)(...args)}
          const v=Reflect.get(model,op);return typeof v==='function'?v.bind(model):v
        }})
        const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v
      }})))
      const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v
    }})
    const due = await h.due()
    await expect(new WaitFollowUpService(wrapped,h.tenant).processDue(due)).rejects.toThrow('after effect before receipt')
    expect(await db.task.count({where:{tenantId:h.id}})).toBe(0)
    await h.follow.processDue(due)
    await h.follow.processDue(due)
    expect(await db.task.count({where:{tenantId:h.id}})).toBe(1)
  })

  it('changed revision invalidates reminder instead of chasing obsolete data', async () => {
    const h=await setup()
    const due=await h.due()
    await db.job.update({where:{id:h.job.id},data:{requirementsRevision:2}})
    expect((await h.follow.processDue(due)).created).toBe(0)
    expect(waitContext(await h.current())?.reason).toBe('FOLLOW_UP_CONTEXT_CHANGED')
  })

  it('partial corrections update durable evidence; repeated evidence remains waiting', async () => {
    const h=await setup(['width','height','quantity'])
    const first=await h.event({width:2,height:3})
    expect((await h.service.resumeFromEvent(first.id)).reason).toBe('PARTIALLY_SATISFIED')
    const correction=await h.event({width:2.5})
    expect((await h.service.resumeFromEvent(correction.id)).reason).toBe('UPDATED')
    const repeat=await h.event({width:2.5})
    expect((await h.service.resumeFromEvent(repeat.id)).reason).toBe('STILL_WAITING')
    expect(waitContext(await h.current())?.values).toEqual({width:2.5,height:3})
    expect((await h.current()).currentStep).toBe(0)
  })

  it('old wait epoch cannot satisfy a newer wait', async () => {
    const h=await setup()
    const e=await h.event({width:2,height:3},{waitEpoch:'old-generation'})
    expect((await h.service.resumeFromEvent(e.id)).resumed).toBe(false)
    expect((await h.current()).state).toBe('WAITING_CUSTOMER')
  })

  it('invalid stored wait condition goes to human review without executing next step', async () => {
    const h=await setup()
    await db.agentWorkflow.update({where:{id:h.workflow.id},data:{resumeConditionJson:{eventTypes:['INVALID']}}})
    const e=await h.event({width:2,height:3})
    expect((await h.service.resumeFromEvent(e.id)).reason).toBe('REQUIRES_HUMAN_REVIEW')
    expect((await h.current()).state).toBe('NEEDS_HUMAN_REVIEW')
    expect((await h.current()).currentStep).toBe(0)
  })

  it('persisted completed requirements prevent a reminder even before resume event', async () => {
    const h=await setup()
    await db.job.update({where:{id:h.job.id},data:{requirements:{width:2,height:3}}})
    expect((await h.follow.processDue(await h.due())).created).toBe(0)
  })

  it('reminder tasks already created are closed when the wait is satisfied', async () => {
    const h=await setup()
    await h.follow.processDue(await h.due())
    const e=await h.event({width:2,height:3})
    await h.service.resumeFromEvent(e.id)
    expect(await db.task.count({where:{tenantId:h.id,status:'OPEN'}})).toBe(0)
    expect(await db.task.count({where:{tenantId:h.id,status:'DONE'}})).toBe(1)
  })

  it('generic SUPPLIER wait without job accumulates partial facts with same engine', async () => {
    const h=await setup()
    const w=await h.service.createWorkflow({requestKey:randomUUID(),objective:'Supplier response',steps:[{stepKey:'wait',type:'WAIT'}]})
    await h.service.wait(w.id,{state:'WAITING_EXTERNAL',actorType:'SUPPLIER',reason:'Supplier reference',resumeCondition:{eventTypes:['SUPPLIER_MESSAGE_RECEIVED'],requiredFields:['availability','material']}})
    const emit=(values:Record<string,unknown>)=>h.service.emitEvent({workflowId:w.id,sourceKey:randomUUID(),actorType:'SUPPLIER',type:'SUPPLIER_MESSAGE_RECEIVED',payload:{waitInput:true,values}})
    expect((await h.service.resumeFromEvent((await emit({availability:true})).id)).reason).toBe('PARTIALLY_SATISFIED')
    expect((await h.service.resumeFromEvent((await emit({material:'PVC'})).id)).resumed).toBe(true)
    expect(await db.priceRule.count({where:{tenantId:h.id}})).toBe(0)
  })

  it('no cross-tenant event can address another tenant workflow', async () => {
    const h=await setup(),other=await setup()
    await expect(other.service.emitEvent({workflowId:h.workflow.id,jobId:h.job.id,conversationId:h.chat.id,sourceKey:randomUUID(),
      type:'CUSTOMER_MESSAGE_RECEIVED',actorType:'CUSTOMER',payload:{fields:['width','height']}})).rejects.toThrow()
    expect((await h.current()).state).toBe('WAITING_CUSTOMER')
  })

  it('duplicate correlated message produces one event and one resume', async () => {
    const h=await setup()
    const m=await h.message('2 x 3 metros')
    const turn=synthesizeTurn([m]),u=await new DeterministicUnderstanding().interpretTurn(turn,[])
    await db.$transaction(tx=>correlateCustomerEvents(tx,h.id,h.chat,turn,u))
    expect(await db.agentEvent.count({where:{tenantId:h.id,workflowId:h.workflow.id}})).toBe(1)
    await h.worker.processPendingEvents()
    expect((await h.worker.processPendingEvents()).resumed).toBe(0)
  })

  it('L: QUOTE_READINESS returns to same step and completes durable quote retry after customer data', async () => {
    const h=await setup(['width'])
    const product=await db.product.create({data:{tenantId:h.id,name:'Fixture sign',slug:randomUUID(),category:'TEST'}})
    const rules=productConfigurationSchema.parse({quotationRules:{requiredFields:['width','height'],fields:{width:{type:'number',question:'Width?',min:0.1},height:{type:'number',question:'Height?',min:0.1}},
      pricingEngine:'STANDARD_AREA_V1',validityDays:7,requiresDesign:false,
      pricingInputs:{widthM:{source:'field',field:'width'},heightM:{source:'field',field:'height'},quantity:{source:'constant',value:1},includeDesign:{source:'constant',value:false},installationRequired:{source:'constant',value:false},includeTransport:{source:'constant',value:false}}}})
    await db.productConfiguration.create({data:{tenantId:h.id,productId:product.id,version:1,rules:rules as any,updatedBy:'isolated test'}})
    await db.priceRule.create({data:{tenantId:h.id,productId:product.id,name:'Real test rate',isDemo:false,basePrice:10,pricePerSquareMeter:20}})
    await db.job.update({where:{id:h.job.id},data:{productId:product.id,requirements:{height:3}}})
    await db.agentWorkflow.update({where:{id:h.workflow.id},data:{state:'RUNNING',currentStep:1,contextJson:{jobRevision:1,retryQuoteDraft:true}}})
    await db.agentWorkflowStep.updateMany({where:{workflowId:h.workflow.id,stepKey:'next'},data:{type:'CHECK_POLICY',inputJson:{handler:'QUOTE_READINESS'}}})
    await db.agentWorkflowStep.create({data:{tenantId:h.id,workflowId:h.workflow.id,stepKey:'retry',position:2,type:'CHECK_CONTEXT',inputJson:{handler:'RETRY_QUOTE_DRAFT'}}})
    const runner=new WorkflowStepRunnerService(db,h.tenant)
    expect((await runner.run(h.workflow.id,'next')).status).toBe('WAITING_CUSTOMER')
    expect((await h.current()).currentStep).toBe(1)
    expect((await h.current()).steps.find(s=>s.stepKey==='next')?.attempt).toBe(0)
    const e=await h.event({width:2})
    expect((await h.service.resumeFromEvent(e.id)).resumed).toBe(true)
    expect((await h.current()).currentStep).toBe(1)
    await h.worker.processRunnableWorkflows()
    const current=await h.current()
    expect(current.steps.find(s=>s.stepKey==='next')?.status).toBe('COMPLETED')
    expect(current.steps.find(s=>s.stepKey==='retry')?.resultJson).toMatchObject({quoteRetryStatus:'PENDING_APPROVAL'})
    expect(await db.quote.count({where:{tenantId:h.id,status:'PENDING_APPROVAL'}})).toBe(1)
    expect(await db.quote.count({where:{tenantId:h.id,status:'APPROVED'}})).toBe(0)
  })
})
