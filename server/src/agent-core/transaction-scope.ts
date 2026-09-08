import type { Prisma } from '../generated/prisma/client.js'
import type { PrismaService } from '../database/prisma.service.js'

// Reuse the existing commercial services inside ONE outer transaction. Their callback
// transactions join that transaction; neither effects nor receipts can commit separately.
export function transactionScope(tx: Prisma.TransactionClient): PrismaService {
  return new Proxy(tx, {
    get(target, property) {
      if (property === '$transaction') return async (work: ((scope: Prisma.TransactionClient) => Promise<unknown>) | Promise<unknown>[]) =>
        typeof work === 'function' ? work(tx) : Promise.all(work)
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as unknown as PrismaService
}
