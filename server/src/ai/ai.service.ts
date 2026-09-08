import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { PrismaService } from '../database/prisma.service.js'
import type { AIProvider } from './ai-provider.interface.js'

@Injectable()
export class AIService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: LocalTenantService,
    @Inject('AI_PROVIDER') private readonly provider: AIProvider,
  ) {}

  async analyze(message: string) {
    const startedAt = Date.now()
    const products = await this.prisma.product.findMany({
      where: { tenantId: this.tenant.tenantId, isActive: true },
      select: { name: true },
      orderBy: { name: 'asc' },
    })

    try {
      const requirements = await this.provider.extractQuoteRequirements(
        message,
        products.map((product) => product.name),
      )

      await this.prisma.aIInteraction.create({
        data: {
          tenantId: this.tenant.tenantId,
          provider: this.provider.name,
          model: this.provider.model,
          status: 'SUCCESS',
          inputText: message,
          outputJson: requirements as Prisma.InputJsonValue,
          durationMs: Date.now() - startedAt,
        },
      })

      return {
        provider: this.provider.name,
        model: this.provider.model,
        requirements,
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error desconocido'
      await this.prisma.aIInteraction.create({
        data: {
          tenantId: this.tenant.tenantId,
          provider: this.provider.name,
          model: this.provider.model,
          status: detail.includes('JSON') ? 'INVALID_OUTPUT' : 'ERROR',
          inputText: message,
          error: detail.slice(0, 1000),
          durationMs: Date.now() - startedAt,
        },
      })

      throw new ServiceUnavailableException({
        message: 'No pudimos analizar la solicitud automáticamente. Puedes completar los datos manualmente.',
        retryable: true,
      })
    }
  }
}
