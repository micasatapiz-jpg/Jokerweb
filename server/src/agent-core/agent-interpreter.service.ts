import { Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { SalesAgentService } from './sales-agent.service.js'
import { OpenAIInterpreterTransport } from './openai-interpreter.transport.js'
import { evaluateProductRules } from './product-configuration.schema.js'
import {
  interpretationSchema,
  type TurnInterpretation,
} from './agent-decision.js'

export type InterpreterInput = { text: string; hasImage?: boolean; hasDocument?: boolean;
  context?: Awaited<ReturnType<SalesAgentService['interpreterContext']>> }
export interface AgentInterpreter { interpret(input: InterpreterInput): Promise<TurnInterpretation> }

export class HeuristicAgentInterpreter implements AgentInterpreter {
  async interpret(input: InterpreterInput): Promise<TurnInterpretation> {
    const text = input.text.trim()
    const lower = text.toLowerCase()

    let intent: TurnInterpretation['intent'] = 'VENTA_NUEVA'
    let filePurpose: TurnInterpretation['filePurpose'] = 'UNKNOWN'

    if (
      /(hablar con el jefe|hablar con una persona|no quiero hablar con la ia|quiero un humano)/i.test(
        text,
      )
    ) {
      intent = 'SOLICITA_HUMANO'
    } else if (
      /(ya pagué|ya pague|hice (el )?yape|hice la transferencia|comprobante de pago|te mando el comprobante)/i.test(
        text,
      )
    ) {
      intent = 'PAGO'
    } else if (
      /(reclam|problema|salió mal|salio mal|no estoy conforme)/i.test(text)
    ) {
      intent = 'RECLAMO'
    } else if (
      /(soy proveedor|les ofrezco|quiero ofrecerles|vendo materiales)/i.test(text)
    ) {
      intent = 'PROVEEDOR'
    } else if (
      /(mi pedido|mi trabajo|ya está listo|ya esta listo|cuándo estará|cuando estara|precio del|dos pedidos)/i.test(
        text,
      )
    ) {
      intent = 'SEGUIMIENTO_PEDIDO'
    } else if (
      /(trabajo con ustedes|busco trabajo|dejar mi cv|curriculum)/i.test(text)
    ) {
      intent = 'EMPLEO'
    } else if (/(fútbol|futbol|partido|clima|noticias)/i.test(text)) {
      intent = 'FUERA_DE_ALCANCE'
    }

    if (input.hasImage || input.hasDocument || /ya te mand[eé].*logo/i.test(text)) {
      if (intent === 'PAGO') {
        filePurpose = 'PAYMENT_PROOF'
      } else if (/(fachada|pared|local|espacio)/i.test(text)) {
        filePurpose = 'SPACE_PHOTO'
      } else if (/logo/i.test(text)) {
        filePurpose = 'LOGO'
      } else if (/(referencia|quiero algo así|quiero algo asi)/i.test(text)) {
        filePurpose = 'REFERENCE'
      }
    }

    const normalized = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const catalog = input.context?.catalog ?? []
    const matches = catalog.filter(p => [p.name, p.slug].some(s => normalized(text).includes(normalized(s))))
    const productQuery = matches.length === 1 ? matches[0]!.name : matches.length > 1 ? null : this.detectProduct(lower)
    const newJobExplicit = /(nuevo trabajo|otra cotización|otra cotizacion|otro pedido|otro trabajo|aparte)/i.test(text)
    const selected = input.context?.jobs.filter(j => text.includes(j.id)) ?? []
    const active = selected.length === 1 ? selected[0] : input.context?.context.facts.job
    const product = matches.length === 1 ? matches[0] : !newJobExplicit && active ? catalog.find(p => p.id === active.productId) : undefined
    const requirements: Record<string, unknown> = {}
    const rules = product?.rules
    if (rules) {
      // Explicit field=value syntax works for every product; natural extraction is
      // intentionally conservative. No prices or operational facts are extracted.
      for (const [key, field] of Object.entries(rules.quotationRules.fields)) {
        const match = new RegExp(`\\b${key}\\s*[:=]\\s*([^;\\n]+)`, 'i').exec(text)
        if (!match) continue
        const value = match[1]!.trim()
        requirements[key] = field.type === 'number' ? Number(value.replace(',', '.')) : field.type === 'boolean' ? /^(si|sí|true)$/i.test(value) ? true : /^(no|false)$/i.test(value) ? false : null : value
      }
      const c = rules.commercialPricing
      if (c?.quantity.field) {
        const quantity = /\b(\d+(?:[.,]\d+)?)\s*(?:unidades?|piezas?|paquetes?|kits?)\b/i.exec(text)
        if (quantity) requirements[c.quantity.field] = Number(quantity[1]!.replace(',', '.'))
      }
      const unit = '(?:mm|cm|m|metros?|cent[ií]metros?|mil[ií]metros?|ft|in|pies|pulgadas?)\\b'
      const normalizeUnit = (s: string) => /^cent/i.test(s) ? 'cm' : /^mil/i.test(s) ? 'mm' : /^metro/i.test(s) ? 'm' : s === 'pies' ? 'ft' : /^pulg/i.test(s) ? 'in' : s
      const pair = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${unit})?\\s*(?:x|por)\\s*(\\d+(?:[.,]\\d+)?)\\s*(${unit})?`, 'i').exec(text)
      if (pair && c?.measurements.length === 2) {
        c.measurements.forEach((m, i) => {
          requirements[m.field] = Number(pair[i === 0 ? 1 : 3]!.replace(',', '.'))
          const u = pair[i === 0 ? 2 : 4] ?? pair[i === 0 ? 4 : 2]
          requirements[m.unitField] = u ? normalizeUnit(u.toLowerCase()) : null
        })
      } else if (c?.measurements.length) {
        const single = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${unit})(?:\\s*(?:de )?(ancho|alto|largo|longitud))?`, 'i').exec(text)
        const index = single?.[3] === 'alto' ? 1 : 0
        const m = c.measurements[index]
        if (single && m && (c.measurements.length === 1 || single[3])) {
          requirements[m.field] = Number(single[1]!.replace(',', '.'))
          requirements[m.unitField] = normalizeUnit(single[2]!.toLowerCase())
        }
      }
      const unitOnly = new RegExp(`^(${unit})[.!\\s]*$`, 'i').exec(text)
      if (unitOnly && active) for (const m of c?.measurements ?? []) {
        const previous = active.requirements as Record<string, unknown>
        if (typeof previous[m.field] === 'number' && !previous[m.unitField]) requirements[m.unitField] = normalizeUnit(unitOnly[1]!.toLowerCase())
      }
      if (active && /^\d+(?:[.,]\d+)?$/.test(text)) {
        const missing = evaluateProductRules(rules, active.requirements as Record<string, unknown>).missingFields
        if (missing.length === 1 && rules.quotationRules.fields[missing[0]!]?.type === 'number') requirements[missing[0]!] = Number(text.replace(',', '.'))
      }
    }
    const result = {
      intent,
      productQuery,
      newJobExplicit,
      selectedJobId: selected.length === 1 ? selected[0]!.id : null,
      requirements,
      ambiguousMeasurement: this.hasAmbiguousMeasurement(text),
      filePurpose,
    }

    return interpretationSchema.parse(result)
  }

  private detectProduct(text: string) {
    return /\b(?:un|una|mi)\s+([a-záéíóúñ]+(?:\s+de\s+[a-záéíóúñ]+)?)/i.exec(text)?.[1] ?? null
  }

  private hasAmbiguousMeasurement(text: string) {
    // Units must belong to the dimension pair. The 'm' in 'luminoso' or an
    // unrelated quantity elsewhere in the message is not a measurement unit.
    const unit = '(?:mm|cm|m|metros?|cent[ií]metros?|mil[ií]metros?)\\b'
    const pair = new RegExp(`\\d+(?:[.,]\\d+)?\\s*(${unit})?\\s*(?:x|por)\\s*\\d+(?:[.,]\\d+)?\\s*(${unit})?`, 'i').exec(text)
    return Boolean(pair && !pair[1] && !pair[2])
  }
}

@Injectable()
export class AgentInterpreterService implements AgentInterpreter {
  private readonly heuristic = new HeuristicAgentInterpreter()
  constructor(@Optional() private readonly config?: ConfigService, @Optional() private readonly openai?: OpenAIInterpreterTransport) {}
  async interpret(input: InterpreterInput): Promise<TurnInterpretation> {
    try {
      const mode = this.config?.get<string>('AGENT_INTERPRETER', 'heuristic') ?? 'heuristic'
      if (mode === 'heuristic') return await this.heuristic.interpret(input)
      if (mode !== 'openai' || !this.openai) throw new Error('Intérprete no disponible')
      const output = interpretationSchema.parse(await this.openai.interpret(input))
      if (output.selectedJobId && !input.context?.jobs.some(j => j.id === output.selectedJobId)) throw new Error('Selección ajena al contexto')
      return output
    } catch {
      // Invalid output, refusal, timeout or missing configuration: no commercial
      // mutation. Request human attention, not heuristic guessing after failure.
      return interpretationSchema.parse({ intent: 'SOLICITA_HUMANO' })
    }
  }
}
