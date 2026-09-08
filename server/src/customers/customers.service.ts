import { Injectable } from '@nestjs/common'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { PrismaService } from '../database/prisma.service.js'
import type { CreateCustomerInput } from './customers.schemas.js'

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: LocalTenantService,
  ) {}

  list() {
    return this.prisma.customer.findMany({
      where: { tenantId: this.tenant.tenantId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async create(input: CreateCustomerInput) {
    const customer = await this.prisma.customer.create({
      data: { tenantId: this.tenant.tenantId, ...input },
    })

    await this.prisma.auditLog.create({
      data: {
        tenantId: this.tenant.tenantId,
        action: 'CUSTOMER_CREATED',
        entityType: 'Customer',
        entityId: customer.id,
        details: { name: customer.name },
      },
    })

    return customer
  }
}

