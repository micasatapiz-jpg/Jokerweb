import {ForbiddenException,Injectable,NotFoundException,ConflictException} from '@nestjs/common'
import {z} from 'zod'
import {PrismaService} from '../database/prisma.service.js'
import {LocalTenantService} from '../common/local-tenant.service.js'
import type {Prisma} from '../generated/prisma/client.js'
import {OperatorControlsService} from './operator-controls.service.js'
import {emitStoredEvent} from './agent-event-store.js'
import {newWaitContext,waitContext} from './waiting-engine.js'

export async function interruptWorkflows(tx:Prisma.TransactionClient,tenantId:string,conversationId:string,reason:string,sourceId:string) {
  const rows=await tx.agentWorkflow.findMany({where:{tenantId,conversationId,state:{notIn:['COMPLETED','CANCELLED','FAILED','NEEDS_HUMAN_REVIEW']}},orderBy:{id:'asc'}})
  for(const row of rows){
    await tx.agentWorkflow.updateMany({where:{id:row.id,tenantId,version:row.version},data:{state:'NEEDS_HUMAN_REVIEW',waitingReason:reason,version:{increment:1}}})
    await tx.auditLog.create({data:{tenantId,entityType:'AgentWorkflow',entityId:row.id,action:'WORKFLOW_INTERRUPTED',details:{reason,sourceId,previousState:row.state}}})
  }
}

@Injectable()
export class WorkflowOperationsService {
  constructor(private readonly db:PrismaService,private readonly tenant:LocalTenantService){}
  private async owner(tx:Prisma.TransactionClient,sourceId:string){
    const actor=await new OperatorControlsService(this.db,this.tenant).resolveActor(tx,z.uuid().parse(sourceId))
    const source=await tx.conversationMessage.findFirst({where:{id:sourceId,conversation:{tenantId:this.tenant.tenantId}}})
    if(actor?.type!=='OWNER'||source?.type!=='TEXT')throw new ForbiddenException('OWNER verificado requerido.')
    return actor
  }
  async pending(sourceId:string,conversationId?:string){
    return this.db.$transaction(async tx=>{
      await this.owner(tx,sourceId)
      const tenantId=this.tenant.tenantId
      const workflows=await tx.agentWorkflow.findMany({where:{tenantId,...(conversationId?{conversationId}:{}),state:{notIn:['COMPLETED','CANCELLED','FAILED']}},include:{task:true,job:true,conversation:true},orderBy:{createdAt:'asc'},take:100})
      const reviews=await tx.ownerReview.findMany({where:{tenantId,status:'PENDING',...(conversationId?{conversationId}:{})},take:100})
      const approvals=await tx.approval.findMany({where:{tenantId,status:'PENDING',...(conversationId?{job:{conversationId}}:{})},take:100})
      const tasks=await tx.task.findMany({where:{tenantId,status:{in:['OPEN','IN_PROGRESS']},...(conversationId?{conversationId}:{})},take:100})
      const usedReviews=new Set<string>(),usedTasks=new Set<string>(),usedApprovals=new Set<string>()
      const chains=workflows.map(w=>{
        const c=w.contextJson as {ownerReviewId?:string;approvalId?:string}
        if(c.ownerReviewId)usedReviews.add(c.ownerReviewId);if(c.approvalId)usedApprovals.add(c.approvalId);if(w.taskId)usedTasks.add(w.taskId)
        return {correlationKey:w.correlationKey??w.requestKey,workflowId:w.id,state:w.state,waitingReason:w.waitingReason,createdAt:w.createdAt,job:w.job,conversationId:w.conversationId,task:w.task,ownerReview:reviews.find(r=>r.id===c.ownerReviewId)??null,approval:approvals.find(a=>a.id===c.approvalId)??null}
      })
      return {chains,unlinked:{reviews:reviews.filter(r=>!usedReviews.has(r.id)),approvals:approvals.filter(a=>!usedApprovals.has(a.id)),tasks:tasks.filter(t=>!usedTasks.has(t.id))},bounded:true}
    })
  }
  async manualResume(sourceId:string,workflowId:string){
    return this.db.$transaction(async tx=>{
      const tenantId=this.tenant.tenantId,actor=await this.owner(tx,sourceId)
      await tx.$queryRaw`SELECT id FROM "AgentWorkflow" WHERE id=${z.uuid().parse(workflowId)}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`
      const w=await tx.agentWorkflow.findFirst({where:{id:workflowId,tenantId}})
      if(!w)throw new NotFoundException('Workflow no encontrado.')
      const sourceKey=`manual-resume:${sourceId}`
      const receipt=await tx.agentEvent.findUnique({where:{tenantId_sourceKey:{tenantId,sourceKey}}})
      if(receipt){if(receipt.workflowId!==w.id)throw new ConflictException('Fuente ya utilizada.');return receipt}
      if(['COMPLETED','FAILED','CANCELLED'].includes(w.state))throw new ConflictException('Workflow terminado.')
      const job=w.jobId?await tx.job.findFirstOrThrow({where:{id:w.jobId,tenantId}}):null
      await tx.agentWorkflow.update({where:{id:w.id},data:{state:'WAITING_OWNER',waitingForActorType:'OWNER',waitingReason:'MANUAL_RESUME_AUTHORIZED',
        contextJson:{...(w.contextJson as object),jobRevision:job?.requirementsRevision??null,previousResumeCondition:w.resumeConditionJson,
          waiting:newWaitContext(`manual:${sourceId}`,new Date(),undefined,waitContext(w)?.status==='SATISFIED'||waitContext(w)?.resumeCurrentStep===true)},
        resumeConditionJson:{eventTypes:['MANUAL_RESUME'],actorType:'OWNER',...(w.jobId?{jobId:w.jobId}:{})},version:{increment:1}}})
      if(w.conversationId)await tx.conversation.update({where:{id:w.conversationId},data:{automationMode:'AUTO',status:'COLLECTING'}})
      const event=await emitStoredEvent(tx,tenantId,{workflowId:w.id,jobId:w.jobId??undefined,conversationId:w.conversationId??undefined,actorType:'OWNER',type:'MANUAL_RESUME',sourceKey,payload:{actorId:actor.id,sourceMessageId:sourceId}})
      await tx.auditLog.create({data:{tenantId,entityType:'AgentWorkflow',entityId:w.id,action:'MANUAL_RESUME_AUTHORIZED',details:{actorId:actor.id,sourceId}}})
      return event
    })
  }
}
