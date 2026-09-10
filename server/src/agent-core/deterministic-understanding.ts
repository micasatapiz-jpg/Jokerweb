import { emptyUnderstanding,resolveCapabilities,understandingV2Schema,type Capability,type TurnSynthesis,type UnderstandingInterpreter,type UnderstandingV2 } from './understanding-v2.js'
const normal = (s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
// Temporary language adapter only. Policies never inspect these expressions.
const detectors: { pattern:RegExp;patch:Partial<UnderstandingV2> }[] = [
  { pattern:/cotiz|presupuesto/,patch:{ primaryGoal:'QUOTE',priceRequest:true } },
  { pattern:/cuanto|precio|cuesta/,patch:{ primaryGoal:'PRICE_INFORMATION',priceRequest:true } },
  { pattern:/primero.*(precio|cuanto|cuesta)/,patch:{ friction:['WANTS_PRICE_FIRST'],primaryGoal:'PRICE_INFORMATION' } },
  { pattern:/muchas preguntas|tanto preguntar/,patch:{ friction:['TOO_MANY_QUESTIONS'] } },
  { pattern:/no se.*medid/,patch:{ friction:['DOES_NOT_KNOW_MEASUREMENTS'] } },
  { pattern:/no (puedo|quiero).*foto|sin foto/,patch:{ friction:['DOES_NOT_WANT_TO_SEND_FILE'] } },
  { pattern:/caro|precio alto/,patch:{ objections:['PRICE_TOO_HIGH'],primaryGoal:'OBJECTION' } },
  { pattern:/competencia.*barat|otro.*mas barato/,patch:{ objections:['COMPETITOR_CHEAPER'] } },
  { pattern:/no tengo presupuesto/,patch:{ objections:['NO_BUDGET'] } },
  { pattern:/manana|urgente|para hoy/,patch:{ urgency:'HIGH',deadlineRequest:true,commercialSignals:['URGENT_NEED'] } },
  { pattern:/ya pague|hice.*yape/,patch:{ primaryGoal:'PAYMENT' } },
  { pattern:/quiero un humano|no quiero.*ia/,patch:{ primaryGoal:'HUMAN_REQUEST',needsHuman:true,friction:['DOES_NOT_WANT_AI'] } },
  { pattern:/lo compro|confirmo.*pedido/,patch:{ primaryGoal:'PURCHASE_DECISION',purchaseIntent:'CONFIRMED',commercialSignals:['HIGH_BUYING_INTENT'] } },
  { pattern:/instal/,patch:{ secondaryGoals:['INSTALLATION'] } },
]
export class DeterministicUnderstanding implements UnderstandingInterpreter {
  async interpretTurn(turn:TurnSynthesis,capabilities:Capability[]):Promise<UnderstandingV2> {
    const result=emptyUnderstanding(),text=normal(turn.text)
    for(const rule of detectors) if(rule.pattern.test(text)) {
      const patch=rule.patch
      for(const [k,v] of Object.entries(patch)) {
        if(Array.isArray(v)) (result as any)[k]=[...new Set([...(result as any)[k],...v])]
        else (result as any)[k]=v
      }
    }
    const entities=new Map<string,string|number|boolean|null>()
    for(const [index,m] of turn.messages.entries()) {
      const t=normal(m.text??'')
      const relation=/^(no[, ]|corrijo|mejor)/.test(t)?'CORRECT':/^(o ?sea|es decir)/.test(t)?'CLARIFY':/^(en vez|cambialo|olvida (?:la foto|eso|lo anterior))/.test(t)?'REPLACE':/^(cancela|ya no quiero)/.test(t)?'CANCEL':/^(si|confirmo|correcto)[,. ]*$/.test(t)?'CONFIRM':'ADD'
      result.messageRelations.push({ messageId:m.id,relatedToMessageId:index?turn.messages[index-1]!.id:null,relation })
      if(relation==='CANCEL') { result.primaryGoal='CANCELLATION'; entities.clear() }
      const q=/(?:quiero|mejor|cantidad[:=]?|son)\s+(\d+)\b/.exec(t)
      if(q && !/^[.,x]|^\s*x/.test(t.slice(q.index + q[0].length))) entities.set('quantity',Number(q[1]))
      const dims=/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/.exec(t)
      if(dims) {
        const label=/^\s*(mm|milimetros?|cm|centimetros?|m|metros?)\b/.exec(t.slice(dims.index+dims[0].length))?.[1]
        const unit=label?label==='mm'||label.startsWith('mili')?'mm':label==='cm'||label.startsWith('centi')?'cm':'m':null
        entities.set('width',Number(dims[1]!.replace(',','.')));entities.set('height',Number(dims[2]!.replace(',','.')));entities.set('widthUnit',unit);entities.set('heightUnit',unit)
      }
    }
    const last=normal(turn.messages.at(-1)?.text??'')
    if(!turn.hasImage&&!turn.hasDocument&&/te mando.*foto|te envio.*foto|ahorita.*envio/.test(last)) result.turnCompleteness='WAITING_FOR_FILE'
    else if(/espera|dejame explicarte/.test(last)) result.turnCompleteness='WAITING_FOR_MORE_TEXT'
    else if(/(?:y tambien|o ?sea)\s*\.{0,3}$/.test(last)) result.turnCompleteness='LIKELY_INCOMPLETE'
    const keys=capabilities.filter(c=>c.aliases.some(a=>text.includes(normal(a)))).map(c=>c.key)
    const resolved=resolveCapabilities(keys,capabilities)
    result.productResolution=resolved.kind;result.requestComponents=resolved.components
    result.specialProductCandidate=['COMPOSITE','SPECIAL','POSSIBLE_OUTSOURCING'].includes(resolved.kind)
    result.entities=[...entities].map(([key,value])=>({ key,value }))
    result.needsClarification=resolved.kind==='UNKNOWN';result.confidence=resolved.kind==='UNKNOWN'?0.4:0.8
    return understandingV2Schema.parse(result)
  }
}
