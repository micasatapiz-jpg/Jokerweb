import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL no está configurada')

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
})

const tenantId = process.env.DEFAULT_TENANT_ID ?? '11111111-1111-4111-8111-111111111111'

const demoProducts = [
  {
    name: 'Letrero luminoso de acrílico',
    slug: 'letrero-luminoso-acrilico',
    category: 'Letreros',
    pricingMode: 'CUSTOM_COMPLEX' as const,
    basePrice: 120,
    pricePerSquareMeter: 310,
    designFee: 50,
    installationFee: 160,
    transportFee: 35,
    marginPercent: 20,
  },
  {
    name: 'Letras corpóreas LED',
    slug: 'letras-corporeas-led',
    category: 'Letras 3D',
    pricingMode: 'CUSTOM_COMPLEX' as const,
    basePrice: 180,
    pricePerSquareMeter: 430,
    designFee: 70,
    installationFee: 220,
    transportFee: 45,
    marginPercent: 22,
  },
  {
    name: 'Gigantografía',
    slug: 'gigantografia',
    category: 'Gran formato',
    pricingMode: 'FIXED' as const,
    basePrice: 20,
    pricePerSquareMeter: 28,
    designFee: 35,
    installationFee: 60,
    transportFee: 20,
    marginPercent: 18,
  },
  {
    name: 'Vinil adhesivo',
    slug: 'vinil-adhesivo',
    category: 'Viniles',
    pricingMode: 'FIXED' as const,
    basePrice: 15,
    pricePerSquareMeter: 42,
    designFee: 30,
    installationFee: 55,
    transportFee: 20,
    marginPercent: 18,
  },
  {
    name: 'Señalética informativa',
    slug: 'senaletica-informativa',
    category: 'Señalética',
    pricingMode: 'FIXED' as const,
    basePrice: 35,
    pricePerSquareMeter: 95,
    designFee: 30,
    installationFee: 45,
    transportFee: 20,
    marginPercent: 20,
  },
]

async function main() {
  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: { name: 'Joker Publicidad', slug: 'joker-publicidad' },
    create: {
      id: tenantId,
      name: 'Joker Publicidad',
      slug: 'joker-publicidad',
      users: {
        create: {
          name: 'Administrador Joker',
          email: 'admin@joker.local',
          role: 'OWNER',
        },
      },
    },
  })

  for (const item of demoProducts) {
    const product = await prisma.product.upsert({
      where: {
        tenantId_slug: { tenantId, slug: item.slug },
      },
      update: {
        name: item.name,
        category: item.category,
        pricingMode: item.pricingMode,
        isActive: true,
      },
      create: {
        tenantId,
        name: item.name,
        slug: item.slug,
        category: item.category,
        pricingMode: item.pricingMode,
        description: 'Producto de demostración. Reemplazar con costos reales de Joker.',
      },
    })

    const currentRule = await prisma.priceRule.findFirst({
      where: { tenantId, productId: product.id, name: 'Regla demo inicial' },
    })

    if (!currentRule) {
      await prisma.priceRule.create({
        data: {
          tenantId,
          productId: product.id,
          name: 'Regla demo inicial',
          basePrice: item.basePrice,
          pricePerSquareMeter: item.pricePerSquareMeter,
          designFee: item.designFee,
          installationFee: item.installationFee,
          transportFee: item.transportFee,
          marginPercent: item.marginPercent,
          igvPercent: 18,
          isDemo: true,
        },
      })
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
