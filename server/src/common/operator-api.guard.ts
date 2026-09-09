import { Injectable, SetMetadata, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { timingSafeEqual } from 'node:crypto'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from './local-tenant.service.js'
import { hasPermission, permissionSchema, type Permission } from '../agent-core/actor-policy.js'

export const OperatorPermission = (permission:Permission) => SetMetadata('operatorPermission',permission)
/** Temporary server-to-server owner credential; never embed this key in a landing page. */
@Injectable()
export class OperatorApiGuard implements CanActivate {
  constructor(private readonly config:ConfigService,private readonly db:PrismaService,private readonly tenant:LocalTenantService,private readonly reflector:Reflector) {}
  async canActivate(context:ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers:{ authorization?:string }; operatorActorId?:string }>()
    const expected = this.config.get<string>('OPERATOR_API_TOKEN',''), received = request.headers.authorization?.replace(/^Bearer /,'') ?? ''
    if (expected.length < 32 || Buffer.byteLength(expected) !== Buffer.byteLength(received) || !timingSafeEqual(Buffer.from(expected),Buffer.from(received))) throw new UnauthorizedException('Credencial de operador requerida.')
    const permission = permissionSchema.parse(this.reflector.get('operatorPermission',context.getHandler()))
    const actor = await this.db.actorIdentity.findFirst({ where:{ tenantId:this.tenant.tenantId,type:'OWNER',active:true } })
    if (!hasPermission(actor,permission)) throw new UnauthorizedException('No existe un propietario activo con ese permiso.')
    request.operatorActorId = actor!.id
    return true
  }
}
