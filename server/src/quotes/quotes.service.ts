import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { PrismaService } from '../database/prisma.service.js'
import { PricingService } from '../pricing/pricing.service.js'
import type { CreateQuoteInput } from './quotes.schemas.js'

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: LocalTenantService,
    private readonly pricing: PricingService,
  ) {}

  list() {
    return this.prisma.quote.findMany({
      where: { tenantId: this.tenant.tenantId },
      include: {
        customer: { select: { id: true, name: true, phone: true, company: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async get(id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, tenantId: this.tenant.tenantId },
      include: {
        customer: true,
        items: { include: { product: true, priceRule: true } },
        attachments: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!quote) throw new NotFoundException('No encontramos la cotización solicitada.')
    return quote
  }

  async create(input: CreateQuoteInput) {
    if (input.items.some((item) => item.discountPercent !== 0)) {
      throw new ConflictException('Los descuentos requieren una aprobación autorizada; no pueden indicarse directamente en una cotización pública.')
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: input.customerId, tenantId: this.tenant.tenantId },
    })
    if (!customer) throw new NotFoundException('No encontramos el cliente seleccionado.')

    const calculatedItems = await Promise.all(input.items.map((item) => this.pricing.calculate(item)))
    const subtotal = calculatedItems.reduce((sum, item) => sum + item.subtotal, 0)
    const discount = calculatedItems.reduce((sum, item) => sum + item.discount, 0)
    const tax = calculatedItems.reduce((sum, item) => sum + item.tax, 0)
    const total = calculatedItems.reduce((sum, item) => sum + item.total, 0)
    const year = new Date().getFullYear()
    const number = `COT-${year}-${randomUUID()}`
    const validUntil = new Date()
    validUntil.setDate(validUntil.getDate() + input.validDays)

    return this.prisma.$transaction(async (transaction) => {
      const quote = await transaction.quote.create({
        data: {
          tenantId: this.tenant.tenantId,
          customerId: input.customerId,
          number,
          sourceText: input.sourceText,
          notes: input.notes,
          designBrief: input.designBrief,
          installationNotes: input.installationNotes,
          serviceAddress: input.serviceAddress,
          subtotal,
          discount,
          tax,
          total,
          validUntil,
          items: {
            create: calculatedItems.map((item, index) => ({
              productId: item.product.id,
              priceRuleId: item.priceRule.id,
              description: item.product.name,
              quantity: item.quantity,
              widthM: input.items[index].widthM,
              heightM: input.items[index].heightM,
              areaM2: item.areaM2,
              unitPrice: item.unitPrice,
              subtotal: item.subtotal,
              pricingBreakdown: {
                components: item.components,
                discount: item.discount,
                tax: item.tax,
                total: item.total,
                priceRuleName: item.priceRule.name,
                priceRuleWasDemo: item.priceRule.isDemo,
              } as Prisma.InputJsonValue,
            })),
          },
        },
        include: { customer: true, items: true },
      })

      await transaction.auditLog.create({
        data: {
          tenantId: this.tenant.tenantId,
          action: 'QUOTE_CREATED',
          entityType: 'Quote',
          entityId: quote.id,
          details: { number: quote.number, total: Number(quote.total) },
        },
      })

      return quote
    })
  }

  async approve(id: string) {
    const quote = await this.get(id)
    if (quote.workflowSnapshot || await this.prisma.job.findFirst({ where: { tenantId: this.tenant.tenantId, quoteId: id } })) {
      throw new ConflictException('Este presupuesto requiere la revisión autorizada del flujo comercial.')
    }
    if (quote.status === 'APPROVED') return quote
    if (quote.status === 'REJECTED' || quote.status === 'EXPIRED') {
      throw new ConflictException('Esta cotización no puede aprobarse en su estado actual.')
    }

    return this.prisma.$transaction(async (transaction) => {
      const approved = await transaction.quote.update({
        where: { id },
        data: { status: 'APPROVED', approvedAt: new Date() },
        include: { customer: true, items: { include: { product: true } } },
      })

      await transaction.auditLog.create({
        data: {
          tenantId: this.tenant.tenantId,
          action: 'QUOTE_APPROVED',
          entityType: 'Quote',
          entityId: approved.id,
          details: { number: approved.number, total: Number(approved.total) },
        },
      })

      return approved
    })
  }
}
