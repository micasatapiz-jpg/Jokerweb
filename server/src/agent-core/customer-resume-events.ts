import type {Prisma,Conversation} from '../generated/prisma/client.js'
import type {TurnSynthesis,UnderstandingV2} from './understanding-v2.js'
import {emitStoredEvent} from './agent-event-store.js'

/** Called only after security/mode gates, with persisted, same-sender synthesis. */
export async function correlateCustomerEvents(tx:Prisma.TransactionClient,tenantId:string,chat:Conversation,turn:TurnSynthesis,u:UnderstandingV2){
  const jobs=await tx.job.findMany({where:{tenantId,conversationId:chat.id,status:{notIn:['CANCELADO','ENTREGADO']}},take:2})
  if(jobs.length!==1)return // Neither guessing job selection nor binding arbitrary uploads.
  const job=jobs[0]!
  const waiting=await tx.agentWorkflow.findMany({where:{tenantId,jobId:job.id,conversationId:chat.id,state:'WAITING_CUSTOMER'},take:2})
  if(waiting.length!==1)return
  const workflow=waiting[0]!,condition=workflow.resumeConditionJson as {requiredFields?:string[];fileType?:string}
  const fields=u.entities.filter(e=>e.value!==null).map(e=>e.key)
  const file=turn.messages.find(m=>condition.fileType&&m.type===condition.fileType)
  if(!file && (!condition.requiredFields?.length || !condition.requiredFields.every(k=>fields.includes(k))))return
  const source=file??turn.messages.at(-1)!
  await emitStoredEvent(tx,tenantId,{workflowId:workflow.id,jobId:job.id,conversationId:chat.id,actorType:'CUSTOMER',
    type:file?'CUSTOMER_FILE_RECEIVED':'CUSTOMER_MESSAGE_RECEIVED',sourceKey:`customer-correlated:${source.id}:${workflow.id}`,
    payload:{sourceMessageId:source.id,fields,fileType:file?.type??null,requirementsRevision:job.requirementsRevision,referenceOnly:true}})
}
