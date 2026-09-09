import { commercialPricingSchema,calculateCommercialPrice,type CommercialPricing } from './commercial-pricing.js'
import type { Capability } from './understanding-v2.js'
// Reviewed against all four pages. REFERENCE FIXTURES ONLY, no runtime seed/import side effects.
export const pdfSource={file:'Base_Conocimiento_Cotizador_Joker.pdf',sha256:'f26114478569ec23b9aa9af28d0f177392eea11113bfca0068e75c35947bf609',pages:4,publication:'NOT_PUBLISHED',taxTreatment:'NOT_SPECIFIED'} as const
export const pdfTariffs={
  letters:{pvcWhite:2,pvcFinished:2.3,acrylicPvcLit:3,aluminiumFacePvc:4,aluminium:4.5,acrylic:4,doubleLight:4.5,neon:4.5},
  frame:160,signs:{bannerLit:180,acrylicLit:400,bannerFrame:75,pvcVinyl:120,pvcCutVinyl:160},
  banner:{oz7Above100:6,oz7AtMost100:null,oz9From1:9,oz10:10,oz12:12,oz13:14,oz13Blackout:17},
  vinyl:{plainLinear:25,laminatedLinear:35,rollWidth:null,utilizationRule:null},
} as const
// Semantic vocabulary belongs to this tenant reference, not to SalesPolicyEngine.
export const pdfCapabilities:Capability[]=[
  {key:'print',name:'Impresión',aliases:['gigantografia','impresion','banner']},
  {key:'frame',name:'Estructura',aliases:['estructura','bastidor']},
  {key:'mdf',name:'MDF',aliases:['mdf']},
  {key:'cut',name:'Corte de silueta',aliases:['silueta']},
  {key:'mount',name:'Adhesión y montaje',aliases:['pegada','pegado']},
  {key:'figure',name:'Figura de persona',aliases:['gigantografia de persona','gigantografia de una persona'],components:['print','mdf','cut','mount']},
  {key:'pvc',name:'PVC',aliases:['pvc']},{key:'vinyl',name:'Vinil',aliases:['vinil']},
  {key:'light',name:'Iluminación',aliases:['led','iluminacion','neon']},
]
export function pdfPricingFixture(mode:'AREA'|'LINEAR',unitPrice:number,minimumMeasure=0,minimumOrderMeasureExclusive?:number) {
  const fields=mode==='AREA'?['width','height']:['length']
  const unit=mode==='AREA'?'m':'cm'
  const rule=commercialPricingSchema.parse({ruleRef:'GENERIC_V1',tariffId:'11111111-1111-4111-8111-111111111199',saleMode:mode,quantity:{field:'quantity',constant:null,integer:true,min:1,max:10000},measurements:fields.map(field=>({field,unitField:`${field}Unit`,canonicalUnit:unit,acceptedUnits:['m','cm','mm'],conversionRules:unit==='m'?{m:1,cm:.01,mm:.001}:{m:100,cm:1,mm:.1},min:.001,max:10000})),variant:null,addOns:[],minimumSubtotal:0,maximumSubtotal:10000000,minimumMeasure,...(minimumOrderMeasureExclusive===undefined?{}:{minimumOrderMeasureExclusive})})
  // taxPercent=0 isolates fabrication in examples. PDF does not authorize fiscal tax treatment.
  return {rule,tariff:{unitPrice,setupPrice:0,variants:{},addOns:{},taxPercent:0}}
}
export function calculateHeightComponents(heights:number[],fixture:{rule:CommercialPricing;tariff:unknown}) {
  const lines=heights.map(length=>calculateCommercialPrice(fixture.rule,fixture.tariff,{length,lengthUnit:'cm',quantity:1}))
  if(!heights.length||lines.some(l=>l.status!=='READY')) return {status:'RULE_NOT_CONFIGURED' as const}
  return {status:'REFERENCE_CALCULATION' as const,lines,total:lines.reduce((s,l)=>s+(l.status==='READY'?l.calculation.total:0),0),installation:'INSTALLATION_REVIEW_REQUIRED' as const}
}
export const pdfGaps=['BANNER_7OZ_AT_MOST_100_NO_RATE','VINYL_ROLL_WIDTH_AND_UTILIZATION_MISSING','INSTALLATION_REVIEW_REQUIRED','TECHNICAL_ARTWORK_NOT_COMMERCIAL_PREVIEW','TAX_TREATMENT_NOT_SPECIFIED','HETEROGENEOUS_COMPONENT_QUOTE_REQUIRES_REVIEW'] as const
