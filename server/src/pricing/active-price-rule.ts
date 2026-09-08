import type { Prisma } from '../generated/prisma/client.js'

export function activePriceRuleWhere(tenantId: string, now: Date): Prisma.PriceRuleWhereInput {
  return { tenantId, isActive: true, isDemo: false, validFrom: { lte: now },
    OR: [{ validUntil: null }, { validUntil: { gt: now } }] }
}
