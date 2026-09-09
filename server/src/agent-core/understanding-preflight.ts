import { Prisma,type Conversation,type AgentTurn } from '../generated/prisma/client.js'
import { synthesizeTurn,understandingV2Schema,capabilitySchema,interpretSafely,type Capability } from './understanding-v2.js'
import { DeterministicUnderstanding } from './deterministic-understanding.js'
import { salesPolicy } from './sales-policy-engine.js'
import { ProductConfigurationService } from './product-configuration.service.js'
import { transactionScope } from './transaction-scope.js'
import { CommercialKnowledgeService } from './commercial-knowledge.service.js'
import { ensureCommercialWait } from './commercial-wait-workflow.js'
import { correlateCustomerEvents } from './customer-resume-events.js'
import { interruptWorkflows } from './workflow-operations.service.js'
const json=(v:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(v))
export async function understandingPreflight(tx:Prisma.TransactionClient,tenantId:string,chat:Conversation,turn:AgentTurn,sourceIds:string[],recordOnly=false) {
  const messages=await tx.conversationMessage.findMany({where:{conversationId:chat.id,id:{in:sourceIds}},orderBy:[{createdAt:'asc'},{id:'asc'}]})
  const pending=chat.pendingSynthesis as {sourceIds:string[];senderExternalId:string|null;source:string}|null
  const first=messages[0]!
  const prior=pending&&pending.senderExternalId===first.senderExternalId&&pending.source===first.source
    ? await tx.conversationMessage.findMany({where:{conversationId:chat.id,id:{in:pending.sourceIds}},orderBy:[{createdAt:'asc'},{id:'asc'}]}) : []
  const synthesis=synthesizeTurn(turn.synthesis?(turn.synthesis as any).messages:[...prior,...messages].slice(-60))
  const products=await tx.product.findMany({where:{tenantId,isActive:true},take:100})
  const stored=await tx.commercialKnowledge.findMany({where:{tenantId,status:'VERIFIED_REFERENCE',category:'CAPABILITY',scope:'REUSABLE_REFERENCE'},take:100})
  const configurations=new ProductConfigurationService(transactionScope(tx),{tenantId} as never)
  const capabilities:Capability[]=await Promise.all(products.map(async p=>({key:`product_${p.id.replaceAll('-','')}`,name:p.name,aliases:[p.name,p.slug],productId:p.id,approvedRule:!!await configurations.get(p.id)})))
  for(const entry of stored){ const c=capabilitySchema.safeParse((entry.contentJson as any).capability);if(c.success)capabilities.push({...c.data,approvedRule:false}) }
  const understanding=turn.understandingV2 ? understandingV2Schema.parse(turn.understandingV2) : await interpretSafely(new DeterministicUnderstanding(),synthesis,capabilities)
  const knowledge=new CommercialKnowledgeService(transactionScope(tx),{tenantId} as never)
  const historicalReferences=await knowledge.historical({componentKeys:understanding.requestComponents.map(c=>c.key),productId:understanding.requestComponents.length===1?understanding.requestComponents[0]?.matchedProductId??undefined:undefined,requirements:Object.fromEntries(understanding.entities.map(e=>[e.key,e.value]))})
  const commercialKnowledge=(await Promise.all(understanding.requestComponents.map(c=>knowledge.references(c.key)))).flat()
  const policy=salesPolicy({actorContext:{authorized:true},conversationRole:chat.role,automationMode:chat.automationMode,understandingV2:understanding,commercialKnowledge,historicalReferences,productConfiguration:{approved:capabilities.some(c=>c.approvedRule&&c.productId&&understanding.requestComponents.some(k=>k.matchedProductId===c.productId))},explicitNotOffered:capabilities.some(c=>c.notOffered&&understanding.requestComponents.some(k=>k.key===c.key))})
  await tx.agentTurn.update({where:{id:turn.id},data:{synthesis:json(synthesis),understandingV2:json(understanding),policyDecision:json(policy)}})
  if(recordOnly) return null
  if(understanding.primaryGoal==='CANCELLATION') {
    await interruptWorkflows(tx,tenantId,chat.id,'CANCELLATION',first.id)
    await tx.conversation.update({where:{id:chat.id},data:{automationMode:'HUMAN_TAKEOVER',status:'HANDOFF'}})
    return {status:'CANCELLATION_REVIEW',reply:'El encargado revisará qué pedido deseas cancelar.',tools:[],silent:true}
  }
  if(understanding.confidence===0) return {status:'UNKNOWN',reply:'¿Puedes aclarar qué necesitas preparar?',tools:[]}
  if(understanding.turnCompleteness!=='COMPLETE') {
    await tx.conversation.update({where:{id:chat.id},data:{pendingSynthesis:json({sourceIds:synthesis.messages.map(m=>m.id),senderExternalId:first.senderExternalId,source:first.source}),waitingState:understanding.turnCompleteness,waitingUntil:new Date(Date.now()+5*60000)}})
    return {status:understanding.turnCompleteness,reply:'Esperando que completes tu mensaje.',tools:[],silent:true}
  }
  if(pending) await tx.conversation.update({where:{id:chat.id},data:{pendingSynthesis:Prisma.DbNull,waitingState:null,waitingUntil:null}})
  await correlateCustomerEvents(tx,tenantId,chat,synthesis,understanding)
  if(['COMPOSITE','SPECIAL','POSSIBLE_OUTSOURCING'].includes(understanding.productResolution)||policy.decision==='NEEDS_OWNER_KNOWLEDGE'&&understanding.requestComponents.some(c=>!c.matchedProductId)) {
    let jobId:string|undefined
    if(chat.customerPhone) {
      const contact=await tx.contactProfile.upsert({where:{tenantId_phone:{tenantId,phone:chat.customerPhone}},create:{tenantId,phone:chat.customerPhone,name:chat.customerName},update:{}})
      const jobs=await tx.job.findMany({where:{tenantId,contactProfileId:contact.id,status:{notIn:['ENTREGADO','CANCELADO']}},take:2})
      if(jobs.length>1||jobs[0]?.productId) return {status:'NEEDS_CLARIFICATION',reply:'Indica si se trata de un trabajo nuevo o de cuál pedido existente.',tools:[]}
      const job=jobs[0]??await tx.job.create({data:{tenantId,contactProfileId:contact.id,conversationId:chat.id,title:understanding.requestComponents.map(c=>c.name).join(' + ').slice(0,200),originKey:`synthesis:${turn.id}`,requirements:json({componentKeys:understanding.requestComponents.map(c=>c.key),...Object.fromEntries(understanding.entities.map(e=>[e.key,e.value])),customerRequest:synthesis.text}),requirementsRevision:1}})
      jobId=job.id
    }
    const dedupeKey=`commercial-knowledge:${jobId??chat.id}:${understanding.requestComponents.map(c=>c.key).sort().join(',')}`
    const scopedReferences=(await Promise.all(understanding.requestComponents.map(c=>knowledge.references(c.key,jobId)))).flat()
    const details=json({jobId,components:understanding.requestComponents,commercialKnowledge:scopedReferences.map(e=>({id:e.id,scope:e.scope,applicability:e.applicabilityJson,content:e.contentJson,authority:'REFERENCE_ONLY'})),historicalReferences,sourceMessageId:first.id,question:'Falta una regla aprobada para componentes. Indica cómo cotizarlos y confirma el alcance.'})
    const review=await tx.ownerReview.upsert({where:{tenantId_dedupeKey:{tenantId,dedupeKey}},create:{tenantId,conversationId:chat.id,sourceMessageId:first.id,reason:'COMMERCIAL_KNOWLEDGE_REQUIRED',risk:30,recommendedAction:'KEEP_ACTIVE',dedupeKey,details},update:{}})
    const task=await tx.task.upsert({where:{tenantId_dedupeKey:{tenantId,dedupeKey}},create:{tenantId,jobId,conversationId:chat.id,type:'CHECK_PRODUCT_RULE',title:'OWNER: completar conocimiento comercial',dedupeKey,details},update:{}})
    await ensureCommercialWait(tx,tenantId,{conversationId:chat.id,jobId,taskId:task.id,ownerReviewId:review.id,correlationKey:dedupeKey})
    return {status:'NEEDS_OWNER_KNOWLEDGE',reply:'Entiendo los componentes del trabajo. Consultaré cómo cotizar las partes que necesitan evaluación, sin inventar un importe.',tools:[]}
  }
  if(policy.safeClaims.includes('EXPLICITLY_NOT_OFFERED')) return {status:'NOT_OFFERED',reply:'Esta solución figura como no ofrecida en nuestra política actual. Podemos revisar una alternativa.',tools:[]}
  if(understanding.friction.some(f=>['WANTS_PRICE_FIRST','TOO_MANY_QUESTIONS'].includes(f))) return {status:'MINIMAL_CLARIFICATION',reply:understanding.requestComponents.length?'Para darte un precio con respaldo, revisaremos solo el dato que falta. ¿Qué medidas aproximadas necesitas?':'El precio depende de la solución y sus medidas. Primero dime qué producto o resultado buscas; avanzaremos un dato a la vez.',tools:[]}
  return null
}
