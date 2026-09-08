import { describe, expect, it } from 'vitest'
import { interpretationSchema, planSalesTurn } from './agent-decision.js'
import { evaluateProductRules, productConfigurationSchema } from './product-configuration.schema.js'

const sampleRules = () => productConfigurationSchema.parse({
  quotationRules: { requiredFields: ['widthM', 'heightM', 'quantity'], fields: {
    widthM: { question: '¿Qué ancho necesitas en metros?', type: 'number', min: 0.01, max: 20 },
    heightM: { question: '¿Qué alto necesitas en metros?', type: 'number', min: 0.01 },
    quantity: { question: '¿Cuántas unidades necesitas?', type: 'number', min: 1 },
  } },
})
const sampleTurn = () => ({ interpretation: interpretationSchema.parse({ intent: 'VENTA_NUEVA' }), rules: sampleRules(),
  productResolved: true, jobAmbiguous: false, values: {} as Record<string, unknown>, hasFile: false, whatsappImage: false,
  spacePhotoDeclined: false, spacePhotoAsked: false })

describe('Reglas comerciales como datos', () => {
  it('no establece formatos, tiempos ni precios definitivos por defecto', () => {
    const rules = sampleRules()
    expect(rules.fileRules.preferredFormats).toEqual([])
    expect(rules.fileRules.minDpi).toBeNull()
    expect(rules.deliveryRules.standardLeadTimeHours).toBeNull()
    expect(rules.quotationRules.pricingEngine).toBeNull()
    expect(rules.autoQuoteEnabled).toBe(false)
  })
  it('regla faltante crea revisión, no una cotización inventada', () => {
    const result = planSalesTurn({ ...sampleTurn(), rules: null })
    expect(result.status).toBe('RULE_NOT_CONFIGURED')
    expect(result.task).toBe('CHECK_PRODUCT_RULE')
    expect(result.reply).not.toContain('RULE_NOT_CONFIGURED')
  })
  it('no hace más de dos preguntas aunque falten muchos datos', () => {
    const result = evaluateProductRules(sampleRules(), {})
    expect(result.missingFields).toHaveLength(3)
    expect(result.questions).toHaveLength(2)
  })
  it('el cero y valores fuera de rango no cumplen reglas numéricas', () => {
    expect(evaluateProductRules(sampleRules(), { widthM: 0, heightM: 1, quantity: 1 }).missingFields).toEqual(['widthM'])
    expect(evaluateProductRules(sampleRules(), { widthM: 50, heightM: 1, quantity: 1 }).missingFields).toEqual(['widthM'])
  })
  it('false es una respuesta válida para un campo booleano', () => {
    const rules = productConfigurationSchema.parse({ quotationRules: { requiredFields: ['installationRequired'], fields: {
      installationRequired: { type: 'boolean', question: '¿Necesitas instalación?' },
    } } })
    expect(evaluateProductRules(rules, { installationRequired: false }).missingFields).toEqual([])
  })
  it('rechaza campos sin pregunta y configuraciones incoherentes', () => {
    expect(() => productConfigurationSchema.parse({ quotationRules: { requiredFields: ['widthM'] } })).toThrow()
    expect(() => productConfigurationSchema.parse({ ...sampleRules(), autoQuoteEnabled: true })).toThrow()
  })
  it('puede configurar formatos sin imponer TIFF a todos', () => {
    const rules = productConfigurationSchema.parse({ ...sampleRules(), fileRules: { preferredFormats: ['tif', 'tiff'], sendAsDocument: true } })
    expect(rules.fileRules.preferredFormats).toEqual(['TIF', 'TIFF'])
    expect(sampleRules().fileRules.preferredFormats).toEqual([])
  })
  it('solo permite precio automático con un motor conocido y revisión desactivada', () => {
    const rules = productConfigurationSchema.parse({ ...sampleRules(), quotationRules: { ...sampleRules().quotationRules, pricingEngine: 'STANDARD_AREA_V1' },
      autoQuoteEnabled: true, requiresHumanReview: false })
    expect(evaluateProductRules(rules, { widthM: 2, heightM: 1, quantity: 1 }).status).toBe('READY')
  })
})

describe('Agente compartido: decisiones con fixtures, sin modelo', () => {
  it.each([
    ['SOLICITA_HUMANO', 'HANDOFF', 'CONTACT_CUSTOMER'],
    ['RECLAMO', 'HANDOFF', 'HANDLE_COMPLAINT'],
    ['PROVEEDOR', 'SUPPLIER', 'CHECK_REQUIREMENT'],
    ['EMPLEO', 'HANDOFF', 'CONTACT_CUSTOMER'],
    ['INTERNO', 'HANDOFF', 'CONTACT_CUSTOMER'],
    ['PAGO', 'PAYMENT_REVIEW', 'CONFIRM_PAYMENT'],
  ] as const)('%s no se procesa como nueva venta', (intent, status, task) => {
    const turn = sampleTurn()
    turn.interpretation.intent = intent
    const result = planSalesTurn(turn)
    expect(result.status).toBe(status)
    expect(result.task).toBe(task)
  })
  it('no responde preguntas generales', () => {
    const turn = sampleTurn(); turn.interpretation.intent = 'FUERA_DE_ALCANCE'
    const result = planSalesTurn(turn)
    expect(result.status).toBe('OUT_OF_SCOPE')
    expect(result.reply).toContain('Joker Publicidad')
  })
  it('varios trabajos requieren aclaración antes de tratar el pago', () => {
    const turn = sampleTurn(); turn.interpretation.intent = 'PAGO'; turn.jobAmbiguous = true
    expect(planSalesTurn(turn).status).toBe('AMBIGUOUS_JOB')
  })
  it('no supone metros para dos por uno sin unidad', () => {
    const turn = sampleTurn(); turn.interpretation.ambiguousMeasurement = true
    expect(planSalesTurn(turn).status).toBe('CLARIFY_MEASUREMENT')
  })
  it('un archivo sin propósito se aclara, no se convierte en logo automáticamente', () => {
    expect(planSalesTurn({ ...sampleTurn(), hasFile: true }).status).toBe('CLARIFY_FILE')
  })
  it('foto de impresión advierte compresión sin afirmar que no sirve', () => {
    const turn = sampleTurn(); turn.hasFile = true; turn.whatsappImage = true
    turn.interpretation.filePurpose = 'PRINT_PHOTO'; turn.rules.fileRules.sendAsDocument = true
    const reply = planSalesTurn(turn).reply
    expect(reply).toContain('puede comprimir')
    expect(reply).toContain('Documento')
    expect(reply).not.toContain('no sirve')
  })
  it('una referencia no se trata como arte final', () => {
    const turn = sampleTurn(); turn.hasFile = true; turn.interpretation.filePurpose = 'REFERENCE'
    expect(planSalesTurn(turn).reply).toContain('no la consideraré un archivo final')
  })
  it('foto opcional no se vuelve a pedir después de rechazarla', () => {
    const turn = sampleTurn(); turn.values = { widthM: 2, heightM: 1, quantity: 1 }
    turn.rules.installationRules.offerSpacePhoto = true
    expect(planSalesTurn(turn).status).toBe('OPTIONAL_SPACE_PHOTO')
    expect(planSalesTurn({ ...turn, spacePhotoDeclined: true }).status).toBe('HUMAN_REVIEW')
    expect(planSalesTurn({ ...turn, spacePhotoAsked: true }).status).toBe('HUMAN_REVIEW')
  })
})
