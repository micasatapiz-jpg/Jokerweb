import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { QuotesService } from '../quotes/quotes.service.js'

function enabled(value: string | undefined, fallback = false) {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'si', 'sí'].includes(value.trim().toLowerCase())
}

function naturalList(items: string[]) {
  if (items.length <= 1) return items[0] ?? 'el trabajo solicitado'
  if (items.length === 2) return `${items[0]} y ${items[1]}`
  return `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`
}

function greetingForPeru(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now))
  if (hour < 12) return 'Buenos días'
  if (hour < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

@Injectable()
export class QuoteMessageService {
  private readonly formatter = new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    minimumFractionDigits: 2,
  })

  constructor(
    private readonly quotes: QuotesService,
    private readonly config: ConfigService,
  ) {}

  async build(quoteId: string) {
    const quote = await this.quotes.get(quoteId)
    const firstName = quote.customer.name.trim().split(/\s+/)[0] || 'cliente'
    const businessName = this.config.get<string>('BUSINESS_DISPLAY_NAME', 'Joker Publicidad')
    const visitEnabled = enabled(this.config.get<string>('QUOTE_VISIT_ENABLED'))
    const visitLabel = this.config.get<string>('QUOTE_VISIT_LABEL', 'Casa Tapiz').trim()
    const visitAddress = this.config.get<string>('QUOTE_VISIT_ADDRESS', '').trim()
    const appointmentRequired = enabled(
      this.config.get<string>('QUOTE_VISIT_REQUIRES_APPOINTMENT'),
      true,
    )
    const pickupEnabled = enabled(this.config.get<string>('QUOTE_PICKUP_ENABLED'))
    const pickupLabel = this.config.get<string>('QUOTE_PICKUP_LABEL', '').trim()
    const pickupAddress = this.config.get<string>('QUOTE_PICKUP_ADDRESS', '').trim()
    const depositPercent = Math.min(100, Math.max(0, Number(this.config.get<string>('QUOTE_DEPOSIT_PERCENT', '50'))))
    const products = [...new Set(quote.items.map((item) => item.description.trim()).filter(Boolean))]
    const total = this.formatter.format(Number(quote.total))
    const isComplex = quote.items.some((item) => item.product.pricingMode === 'CUSTOM_COMPLEX')
    const includesInstallation = quote.items.some((item) => {
      const breakdown = item.pricingBreakdown as { components?: { installation?: number; transport?: number } }
      return Number(breakdown.components?.installation ?? 0) > 0 || Number(breakdown.components?.transport ?? 0) > 0
    })

    const paragraphs = [
      `${greetingForPeru()}, estimado ${firstName}. Te saluda ${businessName}. La cotización ${quote.number} por ${naturalList(products)} tiene un total de ${total}${includesInstallation ? ', incluyendo la instalación y movilidad detalladas en la cotización' : ''}.`,
    ]

    if (isComplex) {
      if (visitEnabled) {
        const place = visitAddress ? `${visitLabel}, en ${visitAddress}` : visitLabel
        paragraphs.push(
          `En este tipo de proyecto podemos revisar alternativas de acuerdo con tu presupuesto. Si deseas conversarlo, coordinamos una atención en ${place}${appointmentRequired ? ' con cita previa' : ''}.`,
        )
      } else {
        paragraphs.push(
          'En este tipo de proyecto podemos revisar alternativas de acuerdo con tu presupuesto. Escríbenos y coordinamos una llamada o una reunión.',
        )
      }
    } else {
      const pickupPlace = pickupAddress ? `${pickupLabel || 'el punto acordado'}, en ${pickupAddress}` : pickupLabel
      const pickupText = pickupEnabled && pickupPlace
        ? `Puedes recoger el pedido en ${pickupPlace}`
        : 'Podemos coordinar la entrega o el recojo'
      paragraphs.push(`${pickupText}. Para confirmar el trabajo se requiere un adelanto del ${depositPercent}%.`)
    }

    paragraphs.push('Quedamos atentos para ayudarte. Esta propuesta está sujeta a la vigencia y condiciones indicadas en la cotización.')

    return {
      quoteId: quote.id,
      quoteNumber: quote.number,
      total: Number(quote.total),
      currency: quote.currency,
      pricingMode: isComplex ? 'CUSTOM_COMPLEX' : 'FIXED',
      depositPercent: isComplex ? null : depositPercent,
      text: paragraphs.join(' '),
      visit: {
        enabled: visitEnabled,
        label: visitEnabled ? visitLabel : null,
        address: visitEnabled && visitAddress ? visitAddress : null,
        appointmentRequired: visitEnabled && appointmentRequired,
      },
    }
  }
}
