import type { Prisma } from '../generated/prisma/client.js'
import { AgentOrchestratorService } from './agent-orchestrator.service.js'
import { transactionScope } from './transaction-scope.js'

export async function ensureCommercialWait(tx:Prisma.TransactionClient,tenantId:string,input:{conversationId:string;jobId?:string;taskId:string;ownerReviewId:string;correlationKey:string}) {
  const service=new AgentOrchestratorService(transactionScope(tx),{tenantId} as never)
  const job=input.jobId?await tx.job.findFirstOrThrow({where:{tenantId,id:input.jobId}}):null
  const workflow=await service.createWorkflow({conversationId:input.conversationId,jobId:input.jobId,taskId:input.taskId,
    objective:'Resolver conocimiento comercial faltante',requestKey:input.correlationKey,correlationKey:input.correlationKey,
    context:{ownerReviewId:input.ownerReviewId,jobRevision:job?.requirementsRevision??null,authority:'REFERENCE_ONLY'},
    steps:[{stepKey:'owner-knowledge',type:'ASK_OWNER'},{stepKey:'review-current-rules',type:'CHECK_POLICY'}]})
  if(workflow.state==='READY')await service.wait(workflow.id,{state:'WAITING_OWNER',actorType:'OWNER',reason:'COMMERCIAL_KNOWLEDGE_REQUIRED',
    resumeCondition:{eventTypes:['COMMERCIAL_KNOWLEDGE_VERIFIED','OWNER_REVIEW_RESOLVED'],jobId:input.jobId,actorType:'OWNER',ownerReviewId:input.ownerReviewId}})
  return workflow.id
}

export async function ensureQuoteWait(tx:Prisma.TransactionClient,tenantId:string,input:{conversationId:string;jobId:string;taskId:string;revision:number;status:string;missingFields:string[]}){
  const correlationKey=`quote-wait:${input.jobId}:${input.revision}:${input.status}`
  if(input.status==='RULE_NOT_CONFIGURED'){
    const source=await tx.conversationMessage.findFirst({where:{conversationId:input.conversationId,direction:'INBOUND'},orderBy:[{createdAt:'desc'},{id:'desc'}]})
    if(!source)return
    const review=await tx.ownerReview.upsert({where:{tenantId_dedupeKey:{tenantId,dedupeKey:correlationKey}},create:{tenantId,conversationId:input.conversationId,sourceMessageId:source.id,reason:'COMMERCIAL_KNOWLEDGE_REQUIRED',risk:30,recommendedAction:'KEEP_ACTIVE',dedupeKey:correlationKey,details:{jobId:input.jobId,components:[{key:'productRule'}]}},update:{}})
    await ensureCommercialWait(tx,tenantId,{...input,ownerReviewId:review.id,correlationKey})
  }else if(input.missingFields.length){
    const service=new AgentOrchestratorService(transactionScope(tx),{tenantId} as never)
    const workflow=await service.createWorkflow({conversationId:input.conversationId,jobId:input.jobId,taskId:input.taskId,requestKey:correlationKey,correlationKey,objective:'Completar requisitos del cliente',context:{jobRevision:input.revision},steps:[{stepKey:'customer-input',type:'ASK_CUSTOMER'},{stepKey:'check-current-policy',type:'CHECK_POLICY'}]})
    if(workflow.state==='READY')await service.wait(workflow.id,{state:'WAITING_CUSTOMER',actorType:'CUSTOMER',reason:'MISSING_REQUIREMENT',resumeCondition:{jobId:input.jobId,conversationId:input.conversationId,eventTypes:['CUSTOMER_MESSAGE_RECEIVED','JOB_REQUIREMENTS_UPDATED'],requiredFields:input.missingFields.slice(0,1)}})
  }
}
