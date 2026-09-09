import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { z } from 'zod'
import { Prisma, type ActorIdentity } from '../generated/prisma/client.js'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { hasPermission, normalizeActorPhone, permissionSchema, type Permission } from './actor-policy.js'

const target = z.uuid()
const tags = z.enum(['CLIENTES','FINANZAS','PROVEEDORES','EMPLEADOS','VENTAS','DISEÑO','PRODUCCION','OTROS','REVISION_HUMANA','SEGURIDAD','SPAM'])
export const operatorCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('MODE'), conversationId: target, mode: z.enum(['AUTO','ASSIST','HUMAN_TAKEOVER','PAUSED']) }).strict(),
  z.object({ action: z.literal('CLASSIFY'), conversationId: target, role: z.enum(['CUSTOMER','OWNER_PRIVATE','INTERNAL_TEAM','SUPPLIER']), purpose: z.enum(['SALES','FINANCE','SUPPLIERS','EMPLOYEES','PRODUCTION','DESIGN','PURCHASES','GENERAL','HUMAN_REVIEW','SECURITY','OTHER']) }).strict(),
  z.object({ action: z.literal('TAG'), conversationId: target.optional(), contactProfileId: target.optional(), tag: tags, remove: z.boolean() }).strict().refine(v => Boolean(v.conversationId) !== Boolean(v.contactProfileId)),
  z.object({ action: z.literal('LIST_TAGS'), conversationId: target }).strict(),
  z.object({ action: z.literal('PERMISSION'), actorId: target, permission: permissionSchema, granted: z.boolean() }).strict(),
  z.object({ action: z.literal('REVIEW'), reviewId: target, decision: z.enum(['APPROVE_EMPLOYEE','REJECT_EMPLOYEE','BLOCK','IGNORE','KEEP_ACTIVE','MARK_VALID']) }).strict(),
  z.object({ action: z.literal('MANUAL_JOB'), contactName: z.string().trim().min(1).max(150), title: z.string().trim().min(1).max(200), requirements: z.record(z.string().regex(/^(customerRequest|width|height|widthUnit|heightUnit|quantity|requestedDateText|designBrief|installationNotes|location)$/), z.union([z.string().max(4000),z.number().finite(),z.null()])).default({}) }).strict(),
  z.object({ action: z.literal('DOCUMENT'), jobId: target, type: z.enum(['COTIZACION','BOLETA','FACTURA','ORDEN','COMPROBANTE_INTERNO']) }).strict(),
  z.object({ action: z.literal('VIEW_JOBS') }).strict(),
  z.object({ action: z.literal('LIST_REVIEWS') }).strict(),
])
export type OperatorCommand = z.infer<typeof operatorCommandSchema>
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v))
const required: Record<OperatorCommand['action'], Permission> = { MODE:'CHANGE_AUTOMATION_MODE', CLASSIFY:'MANAGE_INTERNAL_CONVERSATIONS', TAG:'MANAGE_TAGS', LIST_TAGS:'MANAGE_TAGS', PERMISSION:'MANAGE_PERMISSIONS', REVIEW:'MANAGE_EMPLOYEES', MANUAL_JOB:'CREATE_JOB', DOCUMENT:'CREATE_DOCUMENT', VIEW_JOBS:'VIEW_JOBS', LIST_REVIEWS:'MANAGE_EMPLOYEES' }

/** No public controller. Only authenticated, persisted channel messages are authority. */
@Injectable()
export class OperatorControlsService {
  constructor(private readonly db: PrismaService, private readonly tenant: LocalTenantService) {}
  private get tenantId() { return this.tenant.tenantId }

  async resolveActor(tx: Prisma.TransactionClient, sourceId: string): Promise<ActorIdentity | null> {
    const source = await tx.conversationMessage.findFirst({ where: { id: sourceId, direction:'INBOUND', conversation:{ tenantId:this.tenantId } }, include:{ conversation:true } })
    if (!source || !['VERIFIED_WEBHOOK','AUTHENTICATED_OPERATOR'].includes(source.source) || !source.senderExternalId) return null
    return tx.actorIdentity.findFirst({ where:{ tenantId:this.tenantId, channel:source.conversation.channel, externalSubject:source.senderExternalId, active:true } })
  }

  async bootstrapOwner(input: { name: string; phone: string; verifiedBy: string }) {
    const phone = normalizeActorPhone(input.phone), name = z.string().trim().min(1).parse(input.name)
    z.string().min(1).parse(input.verifiedBy)
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${this.tenantId}::uuid FOR UPDATE`
      const existing = await tx.actorIdentity.findFirst({ where:{ tenantId:this.tenantId,type:'OWNER' } })
      if (existing) {
        if (existing.externalSubject !== phone || !existing.active) throw new ConflictException('Ya existe otro propietario. Se requiere revisión explícita.')
        return existing
      }
      const contact = await tx.contactProfile.upsert({ where:{ tenantId_phone:{ tenantId:this.tenantId,phone } },create:{ tenantId:this.tenantId,phone,name,type:'INTERNO' },update:{ name,type:'INTERNO' } })
      const actor = await tx.actorIdentity.create({ data:{ tenantId:this.tenantId,contactProfileId:contact.id,externalSubject:phone,type:'OWNER',verifiedBy:input.verifiedBy } })
      await tx.actorPolicy.upsert({ where:{ tenantId:this.tenantId },create:{ tenantId:this.tenantId },update:{} })
      await this.audit(tx, actor.id,'OWNER_BOOTSTRAP',actor.id,null,actor,null,'Bootstrap local explícito')
      return actor
    })
  }

  async execute(sourceId: string, raw: unknown) {
    z.uuid().parse(sourceId)
    const command = operatorCommandSchema.parse(raw)
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${this.tenantId}::uuid FOR UPDATE`
      const result = await this.executeInTransaction(tx,sourceId,command)
      // Direct authenticated adapters consumed this message already. Do not let
      // the buffering worker merge it with a later operator instruction.
      await tx.conversationMessage.update({ where:{ id:sourceId },data:{ status:'PROCESSED',processedAt:new Date() } })
      return result
    })
  }

  async executeInTransaction(tx: Prisma.TransactionClient, sourceId: string, raw: unknown) {
    const command = operatorCommandSchema.parse(raw)
    const actor = await this.resolveActor(tx,sourceId)
    const source = await tx.conversationMessage.findFirst({ where:{ id:sourceId,conversation:{ tenantId:this.tenantId } } })
    if (!actor || source?.type !== 'TEXT' || !hasPermission(actor,required[command.action])) throw new ForbiddenException('Identidad o permiso no verificado.')
    if (['REVIEW','LIST_REVIEWS'].includes(command.action) && actor.type !== 'OWNER') throw new ForbiddenException('Solo el propietario resuelve esta cola.')
    if (command.action === 'MANUAL_JOB' && Object.keys(command.requirements).length && !hasPermission(actor,'UPDATE_REQUIREMENTS')) throw new ForbiddenException('Falta UPDATE_REQUIREMENTS.')
    const receipt = await tx.auditLog.findFirst({ where:{ tenantId:this.tenantId,action:'OPERATOR_COMMAND',entityId:sourceId } })
    if (receipt) {
      const data = receipt.details as { command: unknown; result: Prisma.JsonValue }
      if (JSON.stringify(data.command) !== JSON.stringify(json(command))) {
        // PostgreSQL JSONB key order is not significant.
        const { isDeepStrictEqual } = await import('node:util')
        if (!isDeepStrictEqual(data.command,json(command))) throw new ConflictException('El mensaje ya ejecutó otra orden.')
      }
      return data.result
    }
    let result: unknown, before: unknown = null, entityId: string = sourceId
    if (command.action === 'MODE' || command.action === 'CLASSIFY') {
      const chat = await tx.conversation.findFirst({ where:{ id:command.conversationId,tenantId:this.tenantId } })
      if (!chat) throw new NotFoundException('Chat no encontrado.')
      before = chat; entityId = chat.id
      result = await tx.conversation.update({ where:{ id:chat.id },data: command.action === 'MODE'
        ? { automationMode:command.mode, ...(command.mode === 'AUTO' && chat.status === 'HANDOFF' ? { status:'COLLECTING' as const } : {}) }
        : { role:command.role,purpose:command.purpose,...(command.role === 'INTERNAL_TEAM' ? { automationMode:'ASSIST' as const } : {}) } })
    } else if (command.action === 'PERMISSION') {
      const employee = await tx.actorIdentity.findFirst({ where:{ id:command.actorId,tenantId:this.tenantId,type:'EMPLOYEE',active:true } })
      if (!employee) throw new NotFoundException('Empleado no encontrado.')
      before = employee; entityId = employee.id
      result = await tx.actorIdentity.update({ where:{ id:employee.id },data:{ permissions:command.granted ? [...new Set([...employee.permissions,command.permission])] : employee.permissions.filter(p => p !== command.permission) } })
    } else if (command.action === 'TAG' || command.action === 'LIST_TAGS') {
      const chatId = command.conversationId
      const contactId = command.action === 'TAG' ? command.contactProfileId : undefined
      const found = chatId ? await tx.conversation.findFirst({ where:{ tenantId:this.tenantId,id:chatId } }) : await tx.contactProfile.findFirst({ where:{ tenantId:this.tenantId,id:contactId } })
      if (!found) throw new NotFoundException('Destino no encontrado.')
      entityId = found.id
      const targetKey = chatId ? `chat:${chatId}` : `contact:${contactId}`
      if (command.action === 'LIST_TAGS') result = await tx.tagAssignment.findMany({ where:{ tenantId:this.tenantId,targetKey },include:{ tag:true } })
      else {
        const tag = await tx.internalTag.upsert({ where:{ tenantId_name:{ tenantId:this.tenantId,name:command.tag } },create:{ tenantId:this.tenantId,name:command.tag },update:{} })
        before = await tx.tagAssignment.findMany({ where:{ tenantId:this.tenantId,targetKey,tagId:tag.id } })
        result = command.remove ? await tx.tagAssignment.deleteMany({ where:{ tenantId:this.tenantId,tagId:tag.id,targetKey } }) : await tx.tagAssignment.upsert({ where:{ tenantId_tagId_targetKey:{ tenantId:this.tenantId,tagId:tag.id,targetKey } },create:{ tenantId:this.tenantId,tagId:tag.id,targetKey,conversationId:chatId,contactProfileId:contactId },update:{} })
      }
    } else if (command.action === 'REVIEW') {
      const review = await tx.ownerReview.findFirst({ where:{ tenantId:this.tenantId,id:command.reviewId } })
      if (!review) throw new NotFoundException('Revisión no encontrada.')
      before = review; entityId = review.id
      if (review.status !== 'PENDING') {
        if (review.ownerDecision !== command.decision) throw new ConflictException('La revisión ya fue resuelta de otra manera.')
        result = review
      } else {
        if (command.decision.includes('EMPLOYEE') && review.reason !== 'UNAUTHORIZED_INTERNAL_REQUEST') throw new ConflictException('No es una solicitud de empleado.')
        if (command.decision === 'APPROVE_EMPLOYEE') {
          const candidate = await tx.conversationMessage.findFirstOrThrow({ where:{ id:review.sourceMessageId,conversation:{ tenantId:this.tenantId } },include:{ conversation:true } })
          if (candidate.source !== 'VERIFIED_WEBHOOK' || !candidate.senderExternalId) throw new ForbiddenException('No se puede verificar un empleado desde una simulación.')
          const phone = normalizeActorPhone(candidate.senderExternalId)
          const contact = await tx.contactProfile.upsert({ where:{ tenantId_phone:{ tenantId:this.tenantId,phone } },create:{ tenantId:this.tenantId,phone,type:'INTERNO' },update:{ type:'INTERNO' } })
          const policy = await tx.actorPolicy.findUnique({ where:{ tenantId:this.tenantId } })
          const permissions = z.array(permissionSchema).parse(policy?.employeeBasePermissions ?? ['VIEW_JOBS','CREATE_JOB','UPDATE_REQUIREMENTS'])
          await tx.actorIdentity.upsert({ where:{ tenantId_channel_externalSubject:{ tenantId:this.tenantId,channel:candidate.conversation.channel,externalSubject:phone } },create:{ tenantId:this.tenantId,contactProfileId:contact.id,externalSubject:phone,channel:candidate.conversation.channel,type:'EMPLOYEE',permissions,verifiedBy:actor.id },update:{} })
        }
        result = await tx.ownerReview.update({ where:{ id:review.id },data:{ status:command.decision === 'REJECT_EMPLOYEE' ? 'REJECTED' : 'APPROVED',ownerDecision:command.decision,resolvedBy:actor.id,resolvedAt:new Date() } })
        await tx.task.updateMany({ where:{ tenantId:this.tenantId,dedupeKey:`owner-review:${review.dedupeKey}` },data:{ status:'DONE',completedAt:new Date() } })
        // BLOCK records an owner decision, never automatically calls a provider API.
      }
    } else if (command.action === 'MANUAL_JOB') {
      const contacts = await tx.contactProfile.findMany({ where:{ tenantId:this.tenantId,name:{ equals:command.contactName,mode:'insensitive' } },take:2 })
      if (contacts.length > 1) throw new ConflictException('Nombre ambiguo: identifica el contacto.')
      const contact = contacts[0] ?? await tx.contactProfile.create({ data:{ tenantId:this.tenantId,name:command.contactName } })
      result = await tx.job.create({ data:{ tenantId:this.tenantId,contactProfileId:contact.id,title:command.title,requirements:json(command.requirements),requirementsRevision:1,origin:'MANUAL_OPERATOR',createdBy:actor.id,originKey:`operator:${sourceId}` } })
      entityId = (result as { id:string }).id
    } else if (command.action === 'DOCUMENT') {
      const job = await tx.job.findFirst({ where:{ tenantId:this.tenantId,id:command.jobId },include:{ contactProfile:true } })
      if (!job) throw new NotFoundException('Trabajo no encontrado.')
      result = await tx.businessDocument.create({ data:{ tenantId:this.tenantId,jobId:job.id,customerId:job.contactProfile.customerId,type:command.type,templateKey:command.type === 'COTIZACION' ? 'quote-pdf-v1' : 'internal-document-v1',snapshot:json({ job, fiscalIssued:false, warning:'Borrador interno. No emitido ante SUNAT.' }),createdBy:actor.id,requestKey:sourceId } })
      entityId = (result as { id:string }).id
    } else if (command.action === 'VIEW_JOBS') result = await tx.job.findMany({ where:{ tenantId:this.tenantId },orderBy:{ createdAt:'desc' },take:30,select:{ id:true,title:true,status:true } })
    else result = await tx.ownerReview.findMany({ where:{ tenantId:this.tenantId,status:'PENDING' },orderBy:{ createdAt:'asc' },take:50 })
    await this.audit(tx,actor.id,command.action,entityId,before,result,sourceId,'Instrucción explícita con permiso verificado')
    await tx.auditLog.create({ data:{ tenantId:this.tenantId,action:'OPERATOR_COMMAND',entityType:'Message',entityId:sourceId,details:json({ actorId:actor.id,command,result }) } })
    return json(result)
  }

  async audit(tx: Prisma.TransactionClient, actorId: string, action: string, entityId: string, before: unknown, after: unknown, sourceMessageId: string | null, reason: string) {
    await tx.auditLog.create({ data:{ tenantId:this.tenantId,action,entityType:'OperatorControl',entityId,details:json({ actorId,before,after,sourceMessageId,reason }) } })
  }
}
