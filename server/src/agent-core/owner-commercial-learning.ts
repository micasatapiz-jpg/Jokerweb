import { z } from 'zod'
import { ConflictException, NotFoundException } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client.js'
import { transactionScope } from './transaction-scope.js'
import { CommercialKnowledgeService } from './commercial-knowledge.service.js'
import type { LocalTenantService } from '../common/local-tenant.service.js'
// Deterministic adapter. IDs disambiguate sources; arbitrary customer prose cannot invoke it.
export async function ownerCommercialLearning(tx:Prisma.TransactionClient,tenant:LocalTenantService,sourceId:string,text:string) {
  const service=new CommercialKnowledgeService(transactionScope(tx),tenant)
  const reply=(message:string)=>({status:'COMMERCIAL_LEARNING',reply:message,tools:[],internalReply:true})
  const draft=/^conocimiento para revision ([0-9a-f-]{36}):\s*(.+)$/is.exec(text.trim())
  if(draft) {
    const id=z.uuid().safeParse(draft[1]);if(!id.success)return reply('Indica el identificador válido de la revisión comercial.')
    const review=await tx.ownerReview.findFirst({where:{id:id.data,tenantId:tenant.tenantId,reason:'COMMERCIAL_KNOWLEDGE_REQUIRED'}})
    if(!review)return reply('No encuentro esa revisión en este negocio.')
    const details=review.details as {jobId?:string;components?:{key:string}[]}
    const entry=await service.propose(sourceId,{title:'Respuesta comercial del dueño',componentKey:details.components?.[0]?.key??'special',sourceJobId:details.jobId,applicability:{materials:[],configurationId:null}})
    return reply(`Guardé un borrador ${entry.id}. Confirma alcance: solo este trabajo, referencia reutilizable o candidato a regla permanente. No publiqué tarifas.`)
  }
  const confirm=/^alcance ([0-9a-f-]{36}) (solo este trabajo|referencia reutilizable|regla permanente)$/i.exec(text.trim())
  if(confirm) {
    const scope=confirm[2]!.toLowerCase()==='solo este trabajo'?'THIS_JOB':confirm[2]!.toLowerCase()==='referencia reutilizable'?'REUSABLE_REFERENCE':'PERMANENT_RULE_CANDIDATE'
    const id=z.uuid().safeParse(confirm[1]);if(!id.success)return reply('Indica el identificador válido del borrador.')
    try { await service.confirm(sourceId,id.data,scope) }
    catch(error) {
      if(error instanceof ConflictException||error instanceof NotFoundException)return reply('No pude confirmar ese alcance. Revisa el borrador y el trabajo asociado; no se publicaron tarifas.')
      throw error
    }
    return reply('Alcance confirmado. La referencia no sustituye una tarifa publicada ni autoriza precios al cliente.')
  }
  return null
}
