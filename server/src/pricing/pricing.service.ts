import { Injectable, NotFoundException } from '@nestjs/common'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { PrismaService } from '../database/prisma.service.js'
import { calculateDeterministicPrice } from './pricing.calculator.js'
import type { CalculateQuoteInput } from './pricing.schemas.js'
import { activePriceRuleWhere } from './active-price-rule.js'

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: LocalTenantService,
  ) {}

  async calculate(input: CalculateQuoteInput) {
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, tenantId: this.tenant.tenantId, isActive: true },
      include: {
        priceRules: {
          where: activePriceRuleWhere(this.tenant.tenantId, new Date()),
          orderBy: [{ validFrom: 'desc' }, { id: 'asc' }],
          take: 1,
        },
      },
    })

    const rule = product?.priceRules[0]
    if (!product || !rule) {
      throw new NotFoundException('No encontramos una tarifa real, activa y vigente para este producto. Se requiere revisión del encargado.')
    }

    const result = calculateDeterministicPrice(input, {
      basePrice: Number(rule.basePrice),
      pricePerSquareMeter: Number(rule.pricePerSquareMeter),
      designFee: Number(rule.designFee),
      installationFee: Number(rule.installationFee),
      transportFee: Number(rule.transportFee),
      marginPercent: Number(rule.marginPercent),
      igvPercent: Number(rule.igvPercent),
    })

    return {
      product: { id: product.id, name: product.name, unit: product.unit },
      priceRule: { id: rule.id, name: rule.name, isDemo: rule.isDemo },
      ...result,
    }
  }
}
