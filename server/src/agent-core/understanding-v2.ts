import { z } from 'zod'
import { requirementKey } from './commercial-pricing.js'

export const goalSchema = z.enum(['DISCOVERY','PRICE_INFORMATION','QUOTE','PRODUCT_INFORMATION','SPECIAL_PRODUCT','REQUIREMENTS','DESIGN','OBJECTION','NEGOTIATION','PURCHASE_DECISION','AVAILABILITY','DEADLINE','PAYMENT','PRODUCTION','DELIVERY','INSTALLATION','TRACKING','CHANGE_REQUEST','CANCELLATION','COMPLAINT','HUMAN_REQUEST','SUPPLIER','INTERNAL_OPERATION','DOCUMENT_REQUEST','OTHER','UNKNOWN'])
export const completenessSchema = z.enum(['COMPLETE','LIKELY_INCOMPLETE','WAITING_FOR_FILE','WAITING_FOR_MORE_TEXT'])
export const relationSchema = z.enum(['ADD','CLARIFY','CORRECT','REPLACE','CONFIRM','CANCEL'])
export const resolutionSchema = z.enum(['EXACT','VARIANT','COMPOSITE','SPECIAL','POSSIBLE_OUTSOURCING','UNKNOWN','NOT_OFFERED'])
export const objectionSchema = z.enum(['PRICE_TOO_HIGH','COMPETITOR_CHEAPER','NO_BUDGET','NEEDS_TO_THINK','DOES_NOT_TRUST','DOES_NOT_SEE_VALUE','NEEDS_APPROVAL_FROM_OTHER_PERSON','NOT_READY_TO_BUY','UNCERTAIN_ABOUT_PRODUCT','DELIVERY_TOO_SLOW'])
export const frictionSchema = z.enum(['WANTS_PRICE_FIRST','TOO_MANY_QUESTIONS','DOES_NOT_KNOW_MEASUREMENTS','DOES_NOT_WANT_TO_SEND_FILE','DOES_NOT_WANT_TO_SHARE_DATA','JUST_BROWSING','DOES_NOT_UNDERSTAND_PROCESS','DOES_NOT_WANT_AI','HAS_ALREADY_EXPLAINED_THIS','CONFUSED_BY_PREVIOUS_REPLY'])
export const signalSchema = z.enum(['HIGH_BUYING_INTENT','LOW_BUYING_INTENT','COMPARING_OPTIONS','ASKING_FOR_DISCOUNT','REQUESTING_SAMPLE','REQUESTING_REFERENCE','ASKING_FOR_RECOMMENDATION','RETURNING_CUSTOMER','URGENT_NEED','BULK_ORDER','BUSINESS_CUSTOMER','RECURRING_NEED'])
export const componentSchema = z.object({ name:z.string().min(1).max(150),key:requirementKey,knownCapability:z.boolean(),matchedProductId:z.uuid().nullable(),matchedConfigurationId:z.uuid().nullable(),pricingKnowledgeStatus:z.enum(['UNKNOWN','REFERENCE_ONLY','APPROVED_RULE']),requiresOwnerReview:z.boolean(),notes:z.array(z.string().max(500)).max(10) }).strict()
export const understandingV2Schema = z.object({
  primaryGoal:goalSchema,secondaryGoals:z.array(goalSchema).max(10),
  entities:z.array(z.object({ key:requirementKey,value:z.union([z.string().max(2000),z.number().finite(),z.boolean(),z.null()]) }).strict()).max(60),
  commercialSignals:z.array(signalSchema).max(12),objections:z.array(objectionSchema).max(10),friction:z.array(frictionSchema).max(10),
  urgency:z.enum(['UNKNOWN','LOW','MEDIUM','HIGH']),purchaseIntent:z.enum(['UNKNOWN','LOW','MEDIUM','HIGH','CONFIRMED']),
  priceRequest:z.boolean(),deadlineRequest:z.boolean(),availabilityRequest:z.boolean(),specialProductCandidate:z.boolean(),needsClarification:z.boolean(),needsHuman:z.boolean(),
  securitySignals:z.array(z.enum(['UNTRUSTED_INSTRUCTION','IMPERSONATION','SENSITIVE_ACTION_REQUEST'])).max(3),confidence:z.number().min(0).max(1),
  turnCompleteness:completenessSchema,productResolution:resolutionSchema,requestComponents:z.array(componentSchema).max(30),
  messageRelations:z.array(z.object({ messageId:z.string().min(1),relatedToMessageId:z.string().nullable(),relation:relationSchema }).strict()).max(60),
}).strict().refine(v => new Set(v.entities.map(e => e.key)).size === v.entities.length,{ message:'Entidades repetidas' })
export type UnderstandingV2 = z.infer<typeof understandingV2Schema>
export const emptyUnderstanding = ():UnderstandingV2 => ({ primaryGoal:'UNKNOWN',secondaryGoals:[],entities:[],commercialSignals:[],objections:[],friction:[],urgency:'UNKNOWN',purchaseIntent:'UNKNOWN',priceRequest:false,deadlineRequest:false,availabilityRequest:false,specialProductCandidate:false,needsClarification:true,needsHuman:false,securitySignals:[],confidence:0,turnCompleteness:'COMPLETE',productResolution:'UNKNOWN',requestComponents:[],messageRelations:[] })
export interface UnderstandingInterpreter { interpretTurn(input:TurnSynthesis,capabilities:Capability[]):Promise<UnderstandingV2> }
export type Capability = { key:string;name:string;aliases:string[];productId?:string;configurationId?:string;approvedRule?:boolean;notOffered?:boolean;outsourced?:boolean;components?:string[] }
export const capabilitySchema=z.object({key:requirementKey,name:z.string().min(1).max(150),aliases:z.array(z.string().min(1).max(150)).min(1).max(20),productId:z.uuid().optional(),configurationId:z.uuid().optional(),notOffered:z.boolean().optional(),outsourced:z.boolean().optional(),components:z.array(requirementKey).max(20).optional()}).strict()
export const synthesisMessageSchema = z.object({ id:z.string().min(1),conversationId:z.string().min(1),senderExternalId:z.string().nullable(),source:z.string(),type:z.string(),text:z.string().nullable(),createdAt:z.coerce.date() })
export type SynthesisMessage = z.infer<typeof synthesisMessageSchema>
export type TurnSynthesis = { messages:SynthesisMessage[];text:string;hasImage:boolean;hasDocument:boolean }
export function synthesizeTurn(raw:unknown):TurnSynthesis {
  const messages = z.array(synthesisMessageSchema).min(1).max(60).parse(raw).sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime() || a.id.localeCompare(b.id))
  const first = messages[0]!
  if(new Set(messages.map(m=>m.id)).size !== messages.length || messages.some(m=>m.conversationId!==first.conversationId || m.senderExternalId!==first.senderExternalId || m.source!==first.source)) throw new Error('Fuentes incompatibles en el turno')
  return { messages,text:messages.map(m=>m.text??'').join('\n'),hasImage:messages.some(m=>m.type==='IMAGE'),hasDocument:messages.some(m=>m.type==='DOCUMENT') }
}

// Product resolution depends on tenant-owned capability data, never phrase-specific domain branches.
export function resolveCapabilities(keys:string[],catalog:Capability[]) {
  const selected = [...new Set(keys)].map(key=>catalog.find(c=>c.key===key)).filter((c):c is Capability=>!!c)
  const expanded = [...new Set(selected.flatMap(c=>c.components?.length ? c.components : [c.key]))]
  const components = expanded.map(key=>{
    const c=catalog.find(c=>c.key===key)
    return componentSchema.parse({ key,name:c?.name??key,knownCapability:!!c,matchedProductId:c?.productId??null,matchedConfigurationId:c?.configurationId??null,pricingKnowledgeStatus:c?.approvedRule?'APPROVED_RULE':'UNKNOWN',requiresOwnerReview:!c?.approvedRule,notes:[] })
  })
  const kind:UnderstandingV2['productResolution'] = selected.some(c=>c.notOffered) ? 'NOT_OFFERED' : selected.some(c=>c.outsourced) ? 'POSSIBLE_OUTSOURCING' : expanded.length>1 ? 'COMPOSITE' : selected.length===1 ? selected[0]!.productId ? 'EXACT' : 'VARIANT' : 'UNKNOWN'
  return { kind,components,explicitNotOffered:selected.some(c=>c.notOffered) }
}

export async function interpretSafely(adapter:UnderstandingInterpreter,input:TurnSynthesis,catalog:Capability[]) {
  try {
    const value=understandingV2Schema.parse(await adapter.interpretTurn(input,catalog))
    if(value.messageRelations.some(r=>!input.messages.some(m=>m.id===r.messageId)||r.relatedToMessageId!==null&&!input.messages.some(m=>m.id===r.relatedToMessageId))) throw new Error('Relación ajena al turno')
    const resolved=resolveCapabilities(value.requestComponents.map(c=>c.key),catalog)
    return {...value,productResolution:resolved.kind,requestComponents:resolved.components}
  } catch { return emptyUnderstanding() }
}
