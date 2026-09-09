import { understandingV2Schema } from './understanding-v2.js'
export type PolicyInput = { actorContext:{ authorized:boolean };conversationRole:string;automationMode:string;understandingV2:unknown;job?:unknown;productConfiguration?:{ approved:boolean };commercialKnowledge?:unknown[];historicalReferences?:unknown[];tasks?:unknown[];approvals?:unknown[];securityState?:{ blocked:boolean };explicitNotOffered?:boolean }
export function salesPolicy(input:PolicyInput) {
  const parsed=understandingV2Schema.safeParse(input.understandingV2)
  const u=parsed.success?parsed.data:null
  const base={ allowedActions:[] as string[],blockedActions:['PUBLISH_RULE','CONFIRM_PAYMENT','SEND_HISTORICAL_PRICE'],nextGoal:u?.primaryGoal??'UNKNOWN',questions:[] as string[],needsApproval:false,needsClarification:false,needsOwnerKnowledge:false,needsHuman:false,safeClaims:['VISUAL_REFERENCE_NOT_FINAL_ARTWORK','FABRICATION_SEPARATE_FROM_INSTALLATION'],forbiddenClaims:['INVENTED_PRICE','HISTORICAL_PRICE_IS_CURRENT','CONFIRMED_INSTALLATION_WITHOUT_REVIEW'],installationStatus:u?.secondaryGoals.includes('INSTALLATION')?'INSTALLATION_REVIEW_REQUIRED':'NOT_REQUESTED',questionLimit:1 }
  const decision=(value:string,patch:Partial<typeof base>={})=>{
    const result={...base,...patch,decision:value,referenceContext:{knowledgeCount:input.commercialKnowledge?.length??0,historicalCount:input.historicalReferences?.length??0,authority:'REFERENCE_ONLY'}}
    if(input.automationMode==='ASSIST')result.blockedActions=[...new Set([...result.blockedActions,'SEND_CUSTOMER','COMMERCIAL_TOOLS'])]
    return result
  }
  if(input.securityState?.blocked || !input.actorContext.authorized) return decision('NEEDS_HUMAN',{ needsHuman:true })
  if(input.automationMode==='PAUSED'||input.automationMode==='HUMAN_TAKEOVER') return decision('CAN_ANSWER',{ blockedActions:[...base.blockedActions,'SEND_CUSTOMER','COMMERCIAL_TOOLS'] })
  if(!u) return decision('UNKNOWN',{ needsClarification:true,questions:['¿Qué necesitas preparar?'] })
  if(u.turnCompleteness!=='COMPLETE') return decision('NEEDS_CLARIFICATION',{ blockedActions:[...base.blockedActions,'SEND_CUSTOMER'],needsClarification:true })
  if(u.needsHuman) return decision('NEEDS_HUMAN',{ needsHuman:true })
  if(u.productResolution==='NOT_OFFERED'&&input.explicitNotOffered) return decision('CAN_ANSWER',{ safeClaims:[...base.safeClaims,'EXPLICITLY_NOT_OFFERED'] })
  if(u.requestComponents.some(c=>c.requiresOwnerReview)) return decision('NEEDS_OWNER_KNOWLEDGE',{ needsOwnerKnowledge:true,needsApproval:true })
  if(['COMPOSITE','SPECIAL','POSSIBLE_OUTSOURCING'].includes(u.productResolution)) return decision('NEEDS_APPROVAL',{needsApproval:true})
  if(u.productResolution==='UNKNOWN'||u.productResolution==='NOT_OFFERED'||u.needsClarification) return decision('NEEDS_CLARIFICATION',{ needsClarification:true,questions:['¿Puedes describir el resultado que buscas?'] })
  if(!input.productConfiguration?.approved) return decision('NEEDS_APPROVAL',{ needsApproval:true })
  if(input.automationMode==='ASSIST') return decision('CAN_ANSWER',{ allowedActions:['PREPARE_INTERNAL_SUGGESTION'],blockedActions:[...base.blockedActions,'SEND_CUSTOMER','COMMERCIAL_TOOLS'] })
  return decision('CAN_ACT',{ allowedActions:['EXISTING_APPROVED_QUOTE_WORKFLOW'],questions:u.friction.length?['¿Cuál es el dato principal que falta para definir el trabajo?']:[] })
}
export type SalesPolicyDecision = ReturnType<typeof salesPolicy>
