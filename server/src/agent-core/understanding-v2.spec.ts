import { describe,it,expect } from 'vitest'
import { synthesizeTurn,emptyUnderstanding,understandingV2Schema,interpretSafely,type Capability } from './understanding-v2.js'
import { DeterministicUnderstanding } from './deterministic-understanding.js'
import { salesPolicy } from './sales-policy-engine.js'
import { pdfCapabilities,pdfTariffs,pdfPricingFixture,calculateHeightComponents,pdfGaps } from './joker-pdf-reference.fixtures.js'
import { calculateCommercialPrice } from './commercial-pricing.js'
import { interpretKnowledgeScope } from './commercial-knowledge.service.js'
const message=(text:string|null,index=0,type='TEXT')=>({id:`message-${index}`,conversationId:'chat',senderExternalId:'client',source:'SIMULATION',type,text,createdAt:new Date(index*1000)})
const synth=(texts:(string|null)[])=>synthesizeTurn(texts.map((t,i)=>message(t,i,t===null?'IMAGE':'TEXT')))
const interpreter=new DeterministicUnderstanding()
const understand=(...texts:(string|null)[])=>interpreter.interpretTurn(synth(texts),pdfCapabilities)
const policy=(u:unknown,extra:Record<string,unknown>={})=>salesPolicy({actorContext:{authorized:true},conversationRole:'CUSTOMER',automationMode:'AUTO',understandingV2:u,...extra})

describe('500 escenarios de cantidades/correcciones y componentes sin branches por caso',()=>{
  const products=[['banner + estructura',2],['PVC + vinil + LED',3],['gigantografia de persona pegada en MDF',4],['MDF + impresion',2],['totem desconocido',0]] as const
  const cases=products.flatMap(([product,count])=>Array.from({length:10},(_,initial)=>Array.from({length:10},(_,final)=>({product,count,initial:initial+1,final:final+21}))).flat())
  it.each(cases)('$product: $initial → $final',async c=>{
    const u=await understand('quiero cotizar algo',`quiero ${c.initial}`,c.product,`no, mejor ${c.final}`)
    expect(u.entities.find(e=>e.key==='quantity')?.value).toBe(c.final)
    expect(u.messageRelations.at(-1)?.relation).toBe('CORRECT')
    expect(u.requestComponents).toHaveLength(c.count)
    expect(u.productResolution).toBe(c.count>1?'COMPOSITE':'UNKNOWN')
    expect(u.primaryGoal).toBe('QUOTE')
    expect(u).not.toHaveProperty('tools')
  })
})
describe('Understanding v2 y políticas comerciales',()=>{
  it('sintetiza MDF y foto en un solo turno ordenado',async()=>{
    const t=synth(['quiero cotizar algo','un muñeco en MDF delgado','osea una gigantografia de una persona','pegada en MDF',null])
    const u=await interpreter.interpretTurn(t,pdfCapabilities)
    expect(t.messages).toHaveLength(5);expect(t.hasImage).toBe(true)
    expect(u.requestComponents.map(c=>c.key)).toEqual(expect.arrayContaining(['print','mdf','cut','mount']))
    expect(u.messageRelations[2]?.relation).toBe('CLARIFY')
  })
  it.each(['conversationId','senderExternalId','source'])('rechaza mezcla de %s',key=>expect(()=>synthesizeTurn([message('uno'),{...message('dos',1),[key]:'otro'}])).toThrow())
  it('rechaza IDs duplicados',()=>expect(()=>synthesizeTurn([message('uno'),message('dos')])).toThrow())
  it.each([['te mando foto','WAITING_FOR_FILE'],['espera','WAITING_FOR_MORE_TEXT'],['y también...','LIKELY_INCOMPLETE'],['osea...','LIKELY_INCOMPLETE']])('%s queda %s',async(text,state)=>expect((await understand(text)).turnCompleteness).toBe(state))
  it('foto completa la espera y no inventa calidad de arte final',async()=>{
    const u=await understand('te mando una foto',null)
    expect(u.turnCompleteness).toBe('COMPLETE');expect(policy(u).safeClaims).toContain('VISUAL_REFERENCE_NOT_FINAL_ARTWORK')
  })
  it('precio primero es fricción, no objeción',async()=>{
    const u=await understand('primero quiero saber cuánto cuesta')
    expect(u.primaryGoal).toBe('PRICE_INFORMATION');expect(u.friction).toContain('WANTS_PRICE_FIRST');expect(u.objections).toEqual([])
    expect(policy(u).questionLimit).toBe(1)
  })
  it('precio alto y urgencia coexisten',async()=>{
    const u=await understand('está caro pero lo necesito mañana')
    expect(u.objections).toContain('PRICE_TOO_HIGH');expect(u.urgency).toBe('HIGH');expect(u.deadlineRequest).toBe(true)
  })
  it('muchas preguntas reduce el límite',async()=>expect(policy(await understand('son demasiadas, muchas preguntas')).questionLimit).toBe(1))
  it('unknown no significa no ofrecido',async()=>expect(policy(await understand('totem desconocido')).safeClaims).not.toContain('EXPLICITLY_NOT_OFFERED'))
  it('NOT_OFFERED requiere catálogo explícito, nunca solo interpretación',async()=>{
    const catalog:Capability[]=[{key:'excluded',name:'Excluido',aliases:['excluido'],notOffered:true}]
    const u=await interpreter.interpretTurn(synth(['excluido']),catalog)
    expect(policy(u).safeClaims).not.toContain('EXPLICITLY_NOT_OFFERED')
    expect(policy(u,{explicitNotOffered:true}).safeClaims).toContain('EXPLICITLY_NOT_OFFERED')
  })
  it('conocimientos históricos no se convierten en tarifas',async()=>{
    const p=policy(await understand('MDF + impresion'),{historicalReferences:[{approvedTotal:'400'}],commercialKnowledge:[{status:'VERIFIED_REFERENCE'}]})
    expect(p.decision).toBe('NEEDS_OWNER_KNOWLEDGE');expect(p.blockedActions).toContain('SEND_HISTORICAL_PRICE')
  })
  it.each(['PAUSED','HUMAN_TAKEOVER'])('%s bloquea herramientas y salida',mode=>expect(policy(emptyUnderstanding(),{automationMode:mode}).blockedActions).toEqual(expect.arrayContaining(['SEND_CUSTOMER','COMMERCIAL_TOOLS'])))
  it('seguridad no depende de confianza',()=>expect(policy({...emptyUnderstanding(),confidence:1},{securityState:{blocked:true}}).decision).toBe('NEEDS_HUMAN'))
  it.each(['tools','owner','permissions','price'])('schema rechaza campo privilegiado %s',key=>expect(understandingV2Schema.safeParse({...emptyUnderstanding(),[key]:[]}).success).toBe(false))
  it('fallback por error/refusal no ofrece tools',async()=>{
    const u=await interpretSafely({interpretTurn:async()=>{throw new Error('refusal')}},synth(['hola']),[])
    expect(u.primaryGoal).toBe('UNKNOWN');expect(u.confidence).toBe(0);expect(policy(u).allowedActions).toEqual([])
  })
  it('modelo no puede inventar capacidad autorizada',async()=>{
    const fake={...emptyUnderstanding(),productResolution:'EXACT' as const,requestComponents:[{key:'fake',name:'Fake',knownCapability:true,matchedProductId:null,matchedConfigurationId:null,pricingKnowledgeStatus:'APPROVED_RULE' as const,requiresOwnerReview:false,notes:[]}]}
    const u=await interpretSafely({interpretTurn:async()=>fake},synth(['hola']),[])
    expect(u.productResolution).toBe('UNKNOWN');expect(u.requestComponents).toEqual([])
  })
  it.each([['esta vez cobra 400','THIS_JOB'],['normalmente cobramos así','REUSABLE_REFERENCE'],['desde ahora siempre','PERMANENT_RULE_CANDIDATE']])('alcance propuesto %s requiere confirmación', (text,scope)=>expect(interpretKnowledgeScope(text)).toMatchObject({proposedScope:scope,needsScopeConfirmation:true}))
})
describe('PDF revisado: tarifas de referencia y gaps seguros',()=>{
  it.each([.48,1,100])('7 oz %s m² no tiene tarifa',area=>{
    const f=pdfPricingFixture('AREA',6,0,100)
    expect(calculateCommercialPrice(f.rule,f.tariff,{width:area,height:1,widthUnit:'m',heightUnit:'m',quantity:1}).status).toBe('RULE_NOT_CONFIGURED')
    expect(pdfTariffs.banner.oz7AtMost100).toBeNull()
  })
  it('7 oz sobre 100 usa solo referencia explícita 6/m²',()=>{
    const f=pdfPricingFixture('AREA',6,0,100),result=calculateCommercialPrice(f.rule,f.tariff,{width:101,height:1,widthUnit:'m',heightUnit:'m',quantity:1})
    expect(result.status==='READY'&&result.calculation.subtotal).toBe(606)
  })
  it.each(Object.values(pdfTariffs.signs))('mínimo 1m² por pieza a tarifa %s',rate=>{
    const f=pdfPricingFixture('AREA',rate,1),result=calculateCommercialPrice(f.rule,f.tariff,{width:80,height:600,widthUnit:'cm',heightUnit:'mm',quantity:2})
    expect(result.status==='READY'&&result.calculation.subtotal).toBe(rate*2)
  })
  it('corpóreas de alturas diferentes se calculan por componente',()=>{
    expect(calculateHeightComponents([20,40,30],pdfPricingFixture('LINEAR',3))).toMatchObject({status:'REFERENCE_CALCULATION',total:270})
  })
  it('instalación no invalida la fabricación',()=>{
    const u={...emptyUnderstanding(),secondaryGoals:['INSTALLATION' as const]}
    expect(policy(u).installationStatus).toBe('INSTALLATION_REVIEW_REQUIRED')
    expect(calculateHeightComponents([40,40,40,40,40],pdfPricingFixture('LINEAR',3))).toMatchObject({total:600,installation:'INSTALLATION_REVIEW_REQUIRED'})
  })
  it('vinil sin ancho útil ni regla: sin optimización ficticia',()=>{
    expect(pdfTariffs.vinyl.rollWidth).toBeNull();expect(pdfTariffs.vinyl.utilizationRule).toBeNull()
    const f=pdfPricingFixture('LINEAR',25)
    expect(calculateCommercialPrice(f.rule,f.tariff,{width:2,height:3,quantity:1}).status).toBe('MISSING_DATA')
    expect(pdfGaps).toContain('VINYL_ROLL_WIDTH_AND_UTILIZATION_MISSING')
  })
})
