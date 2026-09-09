import { ConflictException, ForbiddenException } from '@nestjs/common'
import type { Prisma, Conversation } from '../generated/prisma/client.js'
import { classifySecurity, hasPermission } from './actor-policy.js'
import { interpretOwnerInstruction } from './owner-instruction-interpreter.js'
import { OperatorControlsService, type OperatorCommand } from './operator-controls.service.js'
import { HeuristicAgentInterpreter } from './agent-interpreter.service.js'
import { ownerCommercialLearning } from './owner-commercial-learning.js'
import { interruptWorkflows } from './workflow-operations.service.js'
import { WorkflowOperationsService } from './workflow-operations.service.js'
import { transactionScope } from './transaction-scope.js'

const plan = (reply: string, silent = false, internalReply = false) => ({ status:'CONTROLLED',reply,tools:[],silent,internalReply })

/** Called under tenant -> conversation -> turn locks; committed together with the saved plan. */
export async function controlConversation(tx: Prisma.TransactionClient, tenantId: string, chat: Conversation, sourceIds: string[], operators: OperatorControlsService) {
  const messages = await tx.conversationMessage.findMany({ where:{ id:{ in:sourceIds },conversationId:chat.id,direction:'INBOUND' },orderBy:[{ createdAt:'asc' },{ id:'asc' }] })
  const source = messages[0]
  if (!source || messages.length !== sourceIds.length) throw new ConflictException('Fuentes incompletas.')
  const actor = await operators.resolveActor(tx,source.id)
  await tx.conversationMessage.updateMany({ where:{ id:{ in:sourceIds },conversationId:chat.id },data:{ authorType:actor?.type ?? 'CUSTOMER',authorId:actor?.id ?? null } })
  const text = messages.map(m => m.text ?? '').join('\n')
  if (actor?.type === 'OWNER' && chat.externalId === source.senderExternalId && chat.role === 'CUSTOMER') {
    await tx.conversation.update({ where:{ id:chat.id },data:{ role:'OWNER_PRIVATE' } })
    chat = { ...chat,role:'OWNER_PRIVATE' }
  }
  if (chat.automationMode === 'PAUSED') {
    const resume = interpretOwnerInstruction(text)
    if (actor && messages.every(m => m.type === 'TEXT') && resume.action === 'MODE' && resume.mode === 'AUTO' && resume.target === 'este chat') {
      try { await operators.executeInTransaction(tx,source.id,{ action:'MODE',conversationId:chat.id,mode:'AUTO' }) }
      catch (error) { if (!(error instanceof ForbiddenException)) throw error }
    }
    return plan('Conversación pausada o reanudación registrada.',true)
  }
  const internal = actor?.type === 'OWNER' || actor?.type === 'EMPLOYEE'
  let count = chat.outOfScopeCount, block = false, outOfScope = false
  for (const message of messages) {
    if (message.securityAssessment !== null) continue
    const assessment = classifySecurity(message.text ?? '',internal)
    const policy = await tx.actorPolicy.findUnique({ where:{ tenantId } })
    if (assessment.reason === 'OUT_OF_SCOPE') { count++; outOfScope = true }
    else if (assessment.reason === 'IN_SCOPE' && /letrero|impres|pedido|cotiza|banner|vinil|logo|precio/i.test(message.text ?? '')) count = 0
    const repeated = count >= (policy?.outOfScopeThreshold ?? 4) && assessment.reason === 'OUT_OF_SCOPE'
    const reason = repeated ? 'OUT_OF_SCOPE_REPEAT' : assessment.reason
    await tx.conversationMessage.update({ where:{ id:message.id },data:{ securityAssessment:{ ...assessment,reason } } })
    if (assessment.risk >= 40 || repeated) {
      block = true
      const dedupeKey = reason === 'UNAUTHORIZED_INTERNAL_REQUEST' ? `employee:${message.senderExternalId ?? chat.externalId}` : `security:${message.id}`
      await tx.ownerReview.upsert({ where:{ tenantId_dedupeKey:{ tenantId,dedupeKey } },create:{ tenantId,conversationId:chat.id,sourceMessageId:message.id,reason,risk:repeated ? 30 : assessment.risk,recommendedAction:assessment.recommendation,dedupeKey,details:{ externalSubject:message.senderExternalId,actorId:actor?.id ?? null,probableInternalActor:reason === 'UNAUTHORIZED_INTERNAL_REQUEST' } },update:{} })
      await tx.task.upsert({ where:{ tenantId_dedupeKey:{ tenantId,dedupeKey:`owner-review:${dedupeKey}` } },create:{ tenantId,conversationId:chat.id,type:'CONTACT_CUSTOMER',title:`Revisión del propietario: ${reason}`,dedupeKey:`owner-review:${dedupeKey}`,details:{ sourceMessageId:message.id,reason } },update:{} })
    }
  }
  if (count !== chat.outOfScopeCount) await tx.conversation.update({ where:{ id:chat.id },data:{ outOfScopeCount:count } })
  if (block) {
    await interruptWorkflows(tx,tenantId,chat.id,'SECURITY',source.id)
    // Security policy limits automation without blocking or deleting the contact.
    if (chat.automationMode === 'AUTO') {
      await tx.conversation.update({ where:{ id:chat.id },data:{ automationMode:'ASSIST' } })
      await operators.audit(tx,'SYSTEM','SECURITY_LIMIT',chat.id,{ mode:chat.automationMode },{ mode:'ASSIST' },source.id,'Política de revisión de seguridad')
    }
    return plan('La solicitud necesita revisión del encargado.',true)
  }
  if (internal && messages.every(m => m.type === 'TEXT')) {
    if(actor?.type==='OWNER') {
      const operations=new WorkflowOperationsService(transactionScope(tx),{tenantId} as never)
      const normalized=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
      if(/^(que tienes pendiente|que debo aprobar|que necesita mi decision)\??$/.test(normalized)) {
        const result=await operations.pending(source.id)
        return plan(chat.role==='OWNER_PRIVATE'?JSON.stringify(result).slice(0,3900):'Consulta disponible solo en el chat privado del propietario.',chat.role!=='OWNER_PRIVATE',true)
      }
      const resume=/^reanudar workflow ([0-9a-f-]{36})$/.exec(normalized)
      if(resume){await operations.manualResume(source.id,resume[1]!);return plan('Reanudación autorizada para revisar el plan guardado. No confirma pagos ni producción.',false,true)}
      const learning=await ownerCommercialLearning(tx,{tenantId} as never,source.id,text)
      if(learning)return learning
    }
    const instruction = interpretOwnerInstruction(text)
    if (instruction.action === 'SENSITIVE_REQUEST') return plan(hasPermission(actor,instruction.permission) ? 'Indica el trabajo y la aprobación verificable. No se ha confirmado ni cambiado ningún importe.' : 'No tienes permiso para esa acción sensible.',false,true)
    try {
      let command: OperatorCommand | undefined
      if (['MANUAL_JOB','VIEW_JOBS','LIST_REVIEWS','REVIEW'].includes(instruction.action)) command = instruction as OperatorCommand
      else if (instruction.action === 'MODE' || instruction.action === 'PURPOSE' || instruction.action === 'TAG') {
        if (instruction.action === 'TAG' && instruction.target !== 'este chat') {
          const contacts = await tx.contactProfile.findMany({ where:{ tenantId,name:{ equals:instruction.target,mode:'insensitive' } },take:2 })
          if (contacts.length > 1) return plan('Hay varios contactos con ese nombre. Indica el contacto exacto.',false,true)
          if (contacts.length === 1) {
            await operators.executeInTransaction(tx,source.id,{ action:'TAG',contactProfileId:contacts[0]!.id,tag:instruction.tag,remove:instruction.remove })
            return plan('Etiqueta del contacto actualizada.',chat.role === 'CUSTOMER',true)
          }
        }
        let targetId: string
        if (instruction.target === 'este chat') targetId = chat.id
        else {
          if (/^(el|ella|ese|esa|este|aqui|referencia pendiente)$/.test(instruction.target)) return plan('Indica el chat exacto; no puedo resolver esa referencia.',false,true)
          const matches = await tx.conversation.findMany({ where:{ tenantId,customerName:{ equals:instruction.target,mode:'insensitive' } },take:2 })
          if (matches.length !== 1) return plan('Necesito identificar un único chat antes de cambiarlo.',false,true)
          targetId = matches[0]!.id
        }
        if (instruction.action === 'MODE') command = { action:'MODE',conversationId:targetId,mode:instruction.mode }
        if (instruction.action === 'TAG') command = { action:'TAG',conversationId:targetId,tag:instruction.tag as 'SPAM',remove:instruction.remove }
        if (instruction.action === 'PURPOSE') command = { action:'CLASSIFY',conversationId:targetId,role:instruction.role === 'INTERNAL_TEAM' ? 'INTERNAL_TEAM' : chat.role,purpose:instruction.purpose as 'FINANCE' }
      } else if (instruction.action === 'PERMISSION') {
        const lastTarget = (chat.internalSuggestion as { operatorTargetActorId?:string } | null)?.operatorTargetActorId
        if (instruction.target === 'referencia pendiente' && !lastTarget) return plan('¿A qué empleado deseas quitarle el permiso?',false,true)
        const matches = await tx.actorIdentity.findMany({ where:{ tenantId,type:'EMPLOYEE',...(instruction.target === 'referencia pendiente' ? { id:lastTarget } : { contact:{ name:{ equals:instruction.target,mode:'insensitive' } } }) },take:2 })
        if (matches.length !== 1) return plan('Identifica un único empleado para cambiar permisos.',false,true)
        command = { action:'PERMISSION',actorId:matches[0]!.id,permission:instruction.permission,granted:instruction.granted }
      }
      if (command) {
        const result = await operators.executeInTransaction(tx,source.id,command)
        if (command.action === 'PERMISSION') await tx.conversation.update({ where:{ id:chat.id },data:{ internalSuggestion:{ operatorTargetActorId:command.actorId,operatorSourceMessageId:source.id } } })
        // Avoid leaking internal records into shared chats. Full result lives in the audit/secure adapter.
        const list = command.action === 'VIEW_JOBS' || command.action === 'LIST_REVIEWS'
        return { ...plan(list && chat.role === 'OWNER_PRIVATE' ? JSON.stringify(result).slice(0,3900) : 'Instrucción registrada.',chat.role === 'CUSTOMER',true),
          actorId:actor.id,requiredPermission:list ? command.action === 'VIEW_JOBS' ? 'VIEW_JOBS' : 'MANAGE_EMPLOYEES' : null }
      }
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof ConflictException) return plan(error.message,false,true)
      throw error
    }
  }
  if (chat.role === 'INTERNAL_TEAM') {
    if (/falta|pendiente/i.test(text)) await tx.task.upsert({ where:{ tenantId_dedupeKey:{ tenantId,dedupeKey:`internal:${source.id}` } },create:{ tenantId,conversationId:chat.id,type:'CHECK_REQUIREMENT',title:'Observación interna por revisar',details:{ sourceMessageId:source.id,observation:text.slice(0,2000) },dedupeKey:`internal:${source.id}` },update:{} })
    return plan('Registré la consulta para revisión interna.',!(/joker|\?/.test(text.toLowerCase()) && internal),true)
  }
  if (chat.automationMode === 'ASSIST' || chat.automationMode === 'HUMAN_TAKEOVER') {
    const interpretation = await new HeuristicAgentInterpreter().interpret({ text,hasImage:messages.some(m => m.type === 'IMAGE'),hasDocument:messages.some(m => m.type === 'DOCUMENT') })
    await tx.conversation.update({ where:{ id:chat.id },data:{ internalSuggestion:{ sourceMessageIds:sourceIds,interpretation,text:'Revisar requisitos del pedido y responder manualmente.',customerText:text.slice(0,4000) } } })
    return plan(chat.automationMode === 'ASSIST' ? 'Sugerencia disponible para el operador.' : 'Atención humana en curso.',true)
  }
  if (outOfScope) return plan('Puedo ayudarte con productos, pedidos y cotizaciones de Joker. ¿Qué necesitas?')
  if (internal || chat.role === 'OWNER_PRIVATE') return plan('Mensaje interno registrado.',true)
  const intent=await new HeuristicAgentInterpreter().interpret({text})
  if(intent.intent==='SOLICITA_HUMANO'||intent.intent==='RECLAMO') {
    await tx.task.upsert({where:{tenantId_dedupeKey:{tenantId,dedupeKey:`handoff:${source.id}`}},create:{tenantId,conversationId:chat.id,type:'CONTACT_CUSTOMER',title:'Solicitud de atención humana',dedupeKey:`handoff:${source.id}`,details:{sourceMessageId:source.id,reason:intent.intent}},update:{}})
    await interruptWorkflows(tx,tenantId,chat.id,intent.intent==='SOLICITA_HUMANO'?'HUMAN_REQUEST':'COMPLAINT',source.id)
    await tx.conversation.update({where:{id:chat.id},data:{automationMode:'HUMAN_TAKEOVER',status:'HANDOFF'}})
    return plan('Atención humana solicitada; contexto conservado.',true)
  }
  return null
}
