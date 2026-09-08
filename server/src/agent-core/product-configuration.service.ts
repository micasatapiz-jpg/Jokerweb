import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { Prisma } from '../generated/prisma/client.js'
import { productConfigurationSchema } from './product-configuration.schema.js'
import type { TrustedActor } from './job-state.js'

@Injectable()
export class ProductConfigurationService {
  constructor(private readonly db: PrismaService, private readonly tenant: LocalTenantService) {}

  async get(productId: string) {
    const record = await this.db.productConfiguration.findFirst({ where: { tenantId: this.tenant.tenantId, productId }, orderBy: { version: 'desc' } })
    if (!record) return null
    const parsed = productConfigurationSchema.safeParse(record.rules)
    if (!parsed.success) return null
    return { ...record, rules: parsed.data }
  }

  async publish(productId: string, input: unknown, expectedVersion: number, actor: TrustedActor) {
    if (actor.role !== 'OWNER' || !actor.id) throw new ForbiddenException('Solo el dueño puede aprobar reglas de producto.')
    const rules = productConfigurationSchema.parse(input)
    const tenantId = this.tenant.tenantId
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId}::uuid AND "tenantId" = ${tenantId}::uuid FOR UPDATE`
      if (!await tx.product.findFirst({ where: { id: productId, tenantId } })) throw new NotFoundException('Producto no encontrado.')
      const latest = await tx.productConfiguration.findFirst({ where: { tenantId, productId }, orderBy: { version: 'desc' } })
      if ((latest?.version ?? 0) !== expectedVersion) throw new ConflictException('Las reglas cambiaron. Revisa la versión más reciente.')
      const record = await tx.productConfiguration.create({ data: { tenantId, productId, version: expectedVersion + 1,
        rules: rules as Prisma.InputJsonValue, updatedBy: actor.id } })
      await tx.auditLog.create({ data: { tenantId, action: 'PRODUCT_RULE_APPROVED', entityType: 'ProductConfiguration', entityId: record.id,
        details: { productId, version: record.version, actorId: actor.id, previousVersion: latest?.version ?? null } } })
      return record
    })
  }
}
