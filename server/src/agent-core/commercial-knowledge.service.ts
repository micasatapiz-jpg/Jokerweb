import { Injectable,ForbiddenException,ConflictException,NotFoundException } from '@nestjs/common'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { Prisma,type CommercialKnowledgeScope } from '../generated/prisma/client.js'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { OperatorControlsService } from './operator-controls.service.js'
import { capabilitySchema } from './understanding-v2.js'
const json=(v:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(v))
const scopeSchema=z.enum(['THIS_JOB','REUSABLE_REFERENCE','PERMANENT_RULE_CANDIDATE'])
const proposeSchema=z.object({ title:z.string().trim().min(1).max(150),componentKey:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/),sourceJobId:z.uuid().optional(),sourceQuoteId:z.uuid().optional(),capability:capabilitySchema.optional(),sourceDocument:z.object({name:z.string().max(200),sha256:z.string().regex(/^[a-f0-9]{64}$/),content:z.json()}).strict().optional(),applicability:z.object({ materials:z.array(z.string()).max(15),configurationId:z.uuid().nullable() }).strict() }).strict()
export function interpretKnowledgeScope(text:string) {
  const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  const proposedScope:CommercialKnowledgeScope|null=/esta vez|solo este trabajo/.test(t)?'THIS_JOB':/desde ahora|siempre/.test(t)?'PERMANENT_RULE_CANDIDATE':/normalmente|casos parecidos/.test(t)?'REUSABLE_REFERENCE':null
  const amount=/(?:cobra|cobramos|dejalo en)\s+(\d+(?:[.,]\d+)?)/.exec(t)
  return { proposedScope,explicitAmount:amount?amount[1]!.replace(',','.'):null,explanation:text,needsScopeConfirmation:true }
}
@Injectable()
export class CommercialKnowledgeService {
  constructor(private readonly db:PrismaService,private readonly tenant:LocalTenantService) {}
  private get tenantId(){return this.tenant.tenantId}
  private async owner(tx:Prisma.TransactionClient,sourceId:string) {
    const actor=await new OperatorControlsService(this.db,this.tenant).resolveActor(tx,z.uuid().parse(sourceId))
    const source=await tx.conversationMessage.findFirst({where:{id:sourceId,conversation:{tenantId:this.tenantId}}})
    if(actor?.type!=='OWNER'||source?.type!=='TEXT') throw new ForbiddenException('Solo OWNER verificado puede aportar conocimiento comercial.')
    return {actor,source}
  }
  async propose(sourceId:string,raw:unknown) {
    const input=proposeSchema.parse(raw)
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${this.tenantId}::uuid FOR UPDATE`
      const {actor,source}=await this.owner(tx,sourceId)
      if(input.sourceJobId&&!await tx.job.findFirst({where:{id:input.sourceJobId,tenantId:this.tenantId}})) throw new NotFoundException('Trabajo no encontrado.')
      if(input.sourceQuoteId&&!await tx.quote.findFirst({where:{id:input.sourceQuoteId,tenantId:this.tenantId}})) throw new NotFoundException('Cotización no encontrada.')
      if(input.capability?.productId&&!await tx.product.findFirst({where:{tenantId:this.tenantId,id:input.capability.productId}})) throw new NotFoundException('Producto no encontrado.')
      if(input.capability?.configurationId&&!await tx.productConfiguration.findFirst({where:{tenantId:this.tenantId,id:input.capability.configurationId}})) throw new NotFoundException('Configuración no encontrada.')
      if(input.applicability.configurationId&&!await tx.productConfiguration.findFirst({where:{tenantId:this.tenantId,id:input.applicability.configurationId}})) throw new NotFoundException('Configuración de aplicabilidad no encontrada.')
      if(input.sourceJobId&&input.sourceQuoteId&&!await tx.job.findFirst({where:{id:input.sourceJobId,tenantId:this.tenantId,quoteId:input.sourceQuoteId}})) throw new ConflictException('La cotización no pertenece al trabajo indicado.')
      const prior=await tx.commercialKnowledge.findUnique({where:{tenantId_requestKey:{tenantId:this.tenantId,requestKey:sourceId}}})
      if(prior) {
        if(JSON.stringify((prior.contentJson as any).request)!==JSON.stringify(input)) {
          const {isDeepStrictEqual}=await import('node:util')
          if(!isDeepStrictEqual((prior.contentJson as any).request,input)) throw new ConflictException('Fuente ya utilizada con otro contenido.')
        }
        return prior
      }
      const entry=await tx.commercialKnowledge.create({data:{tenantId:this.tenantId,title:input.title,category:input.capability?'CAPABILITY':'COMMERCIAL_REFERENCE',componentKey:input.componentKey,sourceJobId:input.sourceJobId,sourceQuoteId:input.sourceQuoteId,sourceType:input.sourceDocument?'PDF_REFERENCE':'OWNER_MESSAGE',createdByActorId:actor.id,requestKey:sourceId,contentJson:json({...interpretKnowledgeScope(source.text??''),request:input,...(input.capability?{capability:input.capability}:{}),...(input.sourceDocument?{sourceDocument:input.sourceDocument}:{})}),applicabilityJson:input.applicability}})
      await tx.auditLog.create({data:{tenantId:this.tenantId,action:'KNOWLEDGE_DRAFT',entityType:'CommercialKnowledge',entityId:entry.id,details:json({actorId:actor.id,sourceMessageId:sourceId,before:null,after:entry,reason:'Requiere confirmación explícita de alcance'})}})
      await tx.conversationMessage.update({where:{id:sourceId},data:{status:'PROCESSED',processedAt:new Date()}})
      return entry
    })
  }
  async confirm(sourceId:string,id:string,scope:CommercialKnowledgeScope,approve=true) {
    z.uuid().parse(id);scopeSchema.parse(scope)
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${this.tenantId}::uuid FOR UPDATE`
      const {actor}=await this.owner(tx,sourceId)
      const entry=await tx.commercialKnowledge.findFirst({where:{id,tenantId:this.tenantId}})
      if(!entry) throw new NotFoundException('Conocimiento no encontrado.')
      const status=approve?'VERIFIED_REFERENCE':'REJECTED'
      if(entry.status!=='DRAFT') {
        if(entry.status===status&&entry.scope===scope) return entry
        throw new ConflictException('La referencia ya fue revisada de otra manera.')
      }
      if(scope==='THIS_JOB'&&!entry.sourceJobId) throw new ConflictException('THIS_JOB requiere trabajo identificado.')
      const updated=await tx.commercialKnowledge.update({where:{id},data:{scope,status,verifiedByActorId:actor.id,verifiedAt:new Date()}})
      await tx.auditLog.create({data:{tenantId:this.tenantId,action:'KNOWLEDGE_REVIEWED',entityType:'CommercialKnowledge',entityId:id,details:json({actorId:actor.id,sourceMessageId:sourceId,before:entry,after:updated,reason:'Alcance confirmado; no publica tarifa'})}})
      await tx.conversationMessage.update({where:{id:sourceId},data:{status:'PROCESSED',processedAt:new Date()}})
      return updated
    })
  }
  references(componentKey:string,jobId?:string) {
    return this.db.commercialKnowledge.findMany({where:{tenantId:this.tenantId,componentKey,status:'VERIFIED_REFERENCE',OR:[{scope:'REUSABLE_REFERENCE'},...(jobId?[{scope:'THIS_JOB' as const,sourceJobId:jobId}]:[])]},orderBy:{updatedAt:'desc'},take:20})
  }
  async historical(input:{productId?:string;componentKeys:string[];requirements:Record<string,unknown>}) {
    // Retrieve structured candidates inside tenant; no free-text title similarity.
    const jobs=await this.db.job.findMany({where:{tenantId:this.tenantId,quote:{status:'APPROVED'},...(input.productId?{productId:input.productId}:{})},include:{quote:true},orderBy:{createdAt:'desc'},take:200})
    return jobs.flatMap(job=>{
      const req=job.requirements as Record<string,unknown>,keys=Array.isArray(req.componentKeys)?req.componentKeys:[]
      const reasons:string[]=[]
      if(input.productId&&job.productId===input.productId) reasons.push('SAME_PRODUCT')
      if(input.componentKeys.some(k=>keys.includes(k))) reasons.push('SHARED_COMPONENT')
      for(const key of ['material','width','height','configurationId','tags']) if(input.requirements[key]!==undefined&&JSON.stringify(input.requirements[key])===JSON.stringify(req[key])) reasons.push(`MATCH_${key}`)
      if(!reasons.includes('SAME_PRODUCT')&&!reasons.includes('SHARED_COMPONENT')) return []
      return [{jobId:job.id,quoteId:job.quote!.id,approvedTotal:String(job.quote!.total),components:keys,requirements:req,date:job.quote!.approvedAt,similarityReason:reasons,authority:'REFERENCE_ONLY' as const}]
    }).slice(0,10)
  }
  async suggestPattern(componentKey:string) {
    const entries=await this.db.commercialKnowledge.findMany({where:{tenantId:this.tenantId,componentKey,status:'VERIFIED_REFERENCE',scope:'REUSABLE_REFERENCE'},orderBy:{id:'asc'}})
    const groups=new Map<string,typeof entries>()
    for(const entry of entries){ const key=JSON.stringify({content:(entry.contentJson as any).explanation,applicability:entry.applicabilityJson});groups.set(key,[...(groups.get(key)??[]),entry]) }
    const group=[...groups.values()].find(g=>new Set(g.map(e=>e.sourceJobId).filter(Boolean)).size>=3)
    if(!group) return null
    const evidence=group.map(e=>e.id),dedupeKey=createHash('sha256').update(JSON.stringify(evidence)).digest('hex')
    return this.db.commercialRuleSuggestion.upsert({where:{tenantId_dedupeKey:{tenantId:this.tenantId,dedupeKey}},create:{tenantId:this.tenantId,componentKey,evidenceJson:json({knowledgeIds:evidence,count:evidence.length,automaticPublication:false}),dedupeKey},update:{}})
  }

  async reviewSuggestion(sourceId:string,id:string,approve:boolean) {
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${this.tenantId}::uuid FOR UPDATE`
      const {actor}=await this.owner(tx,sourceId)
      const row=await tx.commercialRuleSuggestion.findFirst({where:{id:z.uuid().parse(id),tenantId:this.tenantId}})
      if(!row) throw new NotFoundException('Sugerencia no encontrada.')
      const status=approve?'APPROVED':'REJECTED'
      if(row.status!=='PENDING'&&row.status!==status) throw new ConflictException('Sugerencia ya revisada.')
      if(row.status===status) return row
      const result=await tx.commercialRuleSuggestion.update({where:{id},data:{status,reviewedByActorId:actor.id,reviewedAt:new Date()}})
      await tx.auditLog.create({data:{tenantId:this.tenantId,action:'RULE_SUGGESTION_REVIEWED',entityType:'CommercialRuleSuggestion',entityId:id,details:json({actorId:actor.id,sourceMessageId:sourceId,before:row,after:result,automaticPublication:false})}})
      return result
    })
  }
}
