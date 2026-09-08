import { z } from 'zod'
import { evaluateProductRules, type ProductConfigurationRules } from './product-configuration.schema.js'

export const interpretationSchema = z.object({
  intent: z.enum(['VENTA_NUEVA', 'CLIENTE_EXISTENTE', 'SEGUIMIENTO_PEDIDO', 'PAGO', 'RECLAMO',
    'SOLICITA_HUMANO', 'PROVEEDOR', 'EMPLEO', 'INTERNO', 'OTRO_NEGOCIO', 'FUERA_DE_ALCANCE']),
  productQuery: z.string().trim().min(1).max(150).nullable().default(null),
  newJobExplicit: z.boolean().default(false),
  selectedJobId: z.uuid().nullable().default(null),
  requirements: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/), z.union([z.string().max(4000), z.number(), z.boolean(), z.null()])).default({}),
  ambiguousMeasurement: z.boolean().default(false),
  filePurpose: z.enum(['REFERENCE', 'FINAL_ARTWORK', 'LOGO', 'PRINT_PHOTO', 'DESIGN', 'SPACE_PHOTO', 'PAYMENT_PROOF', 'UNKNOWN']).default('UNKNOWN'),
}).strict()
export type TurnInterpretation = z.infer<typeof interpretationSchema>

export function planSalesTurn(input: {
  interpretation: TurnInterpretation
  rules: ProductConfigurationRules | null
  productResolved: boolean
  jobAmbiguous: boolean
  values: Record<string, unknown>
  hasFile: boolean
  whatsappImage: boolean
  spacePhotoDeclined: boolean
  spacePhotoAsked: boolean
}) {
  const turn = input.interpretation
  if (turn.intent === 'SOLICITA_HUMANO') return { status: 'HANDOFF', reply: 'Claro, le aviso al encargado para que pueda atenderte.', task: 'CONTACT_CUSTOMER' as const }
  if (turn.intent === 'RECLAMO') return { status: 'HANDOFF', reply: 'Lamento el inconveniente. Voy a pasarle tu caso al encargado para revisarlo contigo.', task: 'HANDLE_COMPLAINT' as const }
  if (turn.intent === 'PROVEEDOR') return { status: 'SUPPLIER', reply: 'Gracias por contactarnos. Registraré tu propuesta para que el encargado la revise.', task: 'CHECK_REQUIREMENT' as const }
  if (turn.intent === 'FUERA_DE_ALCANCE' || turn.intent === 'OTRO_NEGOCIO') return { status: 'OUT_OF_SCOPE', reply: 'Este número corresponde a Joker Publicidad. Puedo ayudarte con nuestros productos, trabajos y atención comercial.' }
  if (turn.intent === 'EMPLEO' || turn.intent === 'INTERNO') return { status: 'HANDOFF', reply: 'Gracias. Pasaré tu consulta al encargado para que pueda revisarla.', task: 'CONTACT_CUSTOMER' as const }
  if (input.jobAmbiguous) return { status: 'AMBIGUOUS_JOB', reply: 'Tienes más de un trabajo. ¿Sobre cuál quieres que conversemos?' }
  if (turn.intent === 'PAGO') return { status: 'PAYMENT_REVIEW', reply: 'Gracias por avisarnos. Voy a pedir que verifiquen el pago y te confirmen el resultado.', task: 'CONFIRM_PAYMENT' as const }
  if (turn.intent === 'SEGUIMIENTO_PEDIDO') return { status: 'LOOKUP_JOB', reply: 'Voy a revisar el estado registrado de tu trabajo.' }
  if (!input.productResolved) return { status: 'IDENTIFY_PRODUCT', reply: 'Claro, te ayudo. ¿Qué necesitas comunicar y dónde lo usarás?' }
  const evaluation = evaluateProductRules(input.rules, input.values)
  if (evaluation.status === 'RULE_NOT_CONFIGURED') return { status: evaluation.status,
    reply: 'Para darte una cotización correcta necesito que revisemos este caso. Voy a consultarlo con el encargado.', task: 'CHECK_PRODUCT_RULE' as const }
  if (turn.ambiguousMeasurement) return { status: 'CLARIFY_MEASUREMENT', reply: 'Para anotar bien las medidas, ¿me confirmas el ancho y alto, y si son metros o centímetros?' }
  if (input.hasFile && turn.filePurpose === 'UNKNOWN') return { status: 'CLARIFY_FILE', reply: 'Ya recibí el archivo. ¿Es una referencia de lo que buscas o el diseño que quieres usar en el trabajo?' }
  const notes: string[] = []
  if (input.hasFile && turn.filePurpose === 'REFERENCE') notes.push('Tomaré la imagen como referencia; no la consideraré un archivo final para producción.')
  if (input.hasFile && turn.filePurpose !== 'REFERENCE' && turn.filePurpose !== 'SPACE_PHOTO') {
    notes.push('Ya recibí el archivo. Todavía necesitamos revisar si tiene la calidad adecuada para el tamaño que necesitas.')
    if (input.whatsappImage && input.rules?.fileRules.sendAsDocument) notes.push('WhatsApp puede comprimir las fotos. Si tienes el original, envíamelo desde Adjuntar → Documento para conservar la mayor calidad posible.')
  }
  if (evaluation.questions.length) return { status: evaluation.status, reply: [...notes, ...evaluation.questions].join(' ') }
  if (input.rules?.installationRules.offerSpacePhoto && !input.spacePhotoDeclined && !input.spacePhotoAsked && turn.filePurpose !== 'SPACE_PHOTO') {
    return { status: 'OPTIONAL_SPACE_PHOTO', reply: [...notes, 'Si deseas, puedes enviarme una foto del espacio para mostrar allí la propuesta. Es opcional; también podemos continuar sobre un fondo neutro.'].join(' ') }
  }
  if (evaluation.status === 'HUMAN_REVIEW') return { status: evaluation.status, reply: [...notes, 'Con estos datos pediré al encargado que revise el presupuesto antes de confirmártelo.'].join(' '), task: 'APPROVE_QUOTE' as const }
  return { status: 'READY_TO_CALCULATE', reply: [...notes, 'Ya tenemos los datos necesarios para calcular tu presupuesto.'].join(' ') }
}
