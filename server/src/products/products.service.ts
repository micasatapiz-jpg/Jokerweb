import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { PrismaService } from '../database/prisma.service.js'
import type { UpdatePriceRuleInput } from './products.schemas.js'

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: LocalTenantService,
  ) {}

  list() {
    return this.prisma.product.findMany({
      where: { tenantId: this.tenant.tenantId, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        description: true,
        unit: true,
        pricingMode: true,
        priceRules: {
          where: { isActive: true },
          orderBy: { validFrom: 'desc' },
          take: 1,
          select: {
            id: true,
            name: true,
            basePrice: true,
            pricePerSquareMeter: true,
            designFee: true,
            installationFee: true,
            transportFee: true,
            marginPercent: true,
            igvPercent: true,
            isDemo: true,
            validFrom: true,
          },
        },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
  }

  async updatePriceRule(productId: string, input: UpdatePriceRuleInput) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId: this.tenant.tenantId, isActive: true },
      include: {
        priceRules: {
          where: { isActive: true },
          orderBy: { validFrom: 'desc' },
          take: 1,
        },
      },
    })
    if (!product) throw new NotFoundException('No encontramos el producto seleccionado.')

    const previous = product.priceRules[0]
    const now = new Date()

    return this.prisma.$transaction(async (transaction) => {
      await transaction.priceRule.updateMany({
        where: { tenantId: this.tenant.tenantId, productId, isActive: true },
        data: { isActive: false, validUntil: now },
      })

      const rule = await transaction.priceRule.create({
        data: {
          tenantId: this.tenant.tenantId,
          productId,
          name: input.name,
          basePrice: input.basePrice,
          pricePerSquareMeter: input.pricePerSquareMeter,
          designFee: input.designFee,
          installationFee: input.installationFee,
          transportFee: input.transportFee,
          marginPercent: input.marginPercent,
          igvPercent: input.igvPercent,
          isDemo: false,
          isActive: true,
          validFrom: now,
        },
      })

      await transaction.auditLog.create({
        data: {
          tenantId: this.tenant.tenantId,
          action: 'PRICE_RULE_UPDATED',
          entityType: 'Product',
          entityId: productId,
          details: {
            productName: product.name,
            previousRuleId: previous?.id ?? null,
            newRuleId: rule.id,
            values: input,
          } as Prisma.InputJsonValue,
        },
      })

      return { product: { id: product.id, name: product.name }, priceRule: rule }
    })
  }
}
