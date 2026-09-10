import type {Prisma,Conversation} from '../generated/prisma/client.js'
import type {TurnSynthesis,UnderstandingV2} from './understanding-v2.js'
import {emitStoredEvent} from './agent-event-store.js'
import {record, waitContext} from './waiting-engine.js'

/** Called only after security/mode gates, with persisted, same-sender synthesis. */
export async function correlateCustomerEvents(tx:Prisma.TransactionClient,tenantId:string,chat:Conversation,turn:TurnSynthesis,u:UnderstandingV2){
  const jobs=await tx.job.findMany({where:{tenantId,conversationId:chat.id,status:{notIn:['CANCELADO','ENTREGADO']}},take:2})
  if(jobs.length!==1)return // Neither guessing job selection nor binding arbitrary uploads.
  const job=jobs[0]!
  const waiting = await tx.agentWorkflow.findMany({where: {tenantId, jobId: job.id, conversationId: chat.id, state: 'WAITING_CUSTOMER'}})
  const values = Object.fromEntries(u.entities.filter(e => e.value !== null).map(e => [e.key, e.value]))
  const replacement = u.messageRelations.some(r => r.relation === 'REPLACE') && u.requestComponents.length === 1
    ? u.requestComponents[0]?.matchedProductId : null
  const candidates = waiting.map(workflow => {
    const condition = record(workflow.resumeConditionJson)
    const file = turn.messages.find(m => condition.fileType && m.type === condition.fileType)
    const keys = (condition.requiredFields as string[] | undefined)?.filter(key => key in values) ?? []
    return {workflow, condition, file, keys}
  }).filter(c => c.file || c.keys.length || replacement && c.condition.fileType)
  // Overlapping demands need explicit selection; disjoint waits can coexist.
  for (const candidate of candidates) {
    if (candidates.some(other => other !== candidate && (candidate.keys.some(key => other.keys.includes(key)) || candidate.file && other.file || replacement && candidate.condition.fileType && other.condition.fileType))) continue
    const {workflow, file} = candidate
    const source = file ?? turn.messages.at(-1)!
    await emitStoredEvent(tx, tenantId, {workflowId: workflow.id, jobId: job.id, conversationId: chat.id, actorType: 'CUSTOMER',
      type: file ? 'CUSTOMER_FILE_RECEIVED' : 'CUSTOMER_MESSAGE_RECEIVED', sourceKey: `customer-correlated:${source.id}:${workflow.id}`,
      payload: {sourceMessageId: source.id, fields: Object.keys(values), values, fileType: file?.type ?? null,
        requirementsRevision: job.requirementsRevision, referenceOnly: true, waitInput: true,
        waitEpoch: waitContext(workflow)?.epoch ?? null, ...(replacement ? {supersede: true, replacementProductId: replacement} : {})}})
  }
}
