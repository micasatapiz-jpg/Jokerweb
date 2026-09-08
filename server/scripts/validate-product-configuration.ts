import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { productConfigurationSchema } from '../src/agent-core/product-configuration.schema.js'
import { commercialTariffSchema } from '../src/agent-core/commercial-pricing.js'

// Read-only validation: no DB, secrets, network, seed or publishing.
const file = process.argv[2]
if (!file) throw new Error('Uso: npx tsx scripts/validate-product-configuration.ts <archivo.json>')
const absolute = resolve(file)
if ((await stat(absolute)).size > 1048576) throw new Error('El archivo supera 1 MiB.')
const bundle = z.object({
  product: z.object({ name: z.string().trim().min(1), slug: z.string().trim().min(1), category: z.string().trim().min(1) }).strict(),
  configuration: productConfigurationSchema,
  tariff: commercialTariffSchema,
}).strict().parse(JSON.parse(await readFile(absolute, 'utf8')))
const pricing = bundle.configuration.commercialPricing
if (!pricing) throw new Error('Esta plantilla de carga requiere GENERIC_V1.')
if (bundle.configuration.autoQuoteEnabled) throw new Error('Mantén autoQuoteEnabled=false en este bloque.')
if (!bundle.configuration.quotationRules.validityDays) throw new Error('Falta vigencia de cotización.')
if (pricing.variant?.options.some(o => !Object.hasOwn(bundle.tariff.variants, o)) || pricing.addOns.some(a => !Object.hasOwn(bundle.tariff.addOns, a.rateKey))) throw new Error('Faltan tarifas para variantes/adicionales.')
console.log('Estructura válida. No se publicó ni se conectó a ninguna base. Falta aprobación comercial, asignar IDs locales y probar los resultados esperados.')
