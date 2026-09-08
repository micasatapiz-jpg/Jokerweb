import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import OpenAI from 'openai'
import type { LogoAnalysis } from './visual-proposals.schemas.js'

function dataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

function parseJson(text: string): unknown {
  const clean = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(clean)
}

@Injectable()
export class OpenAIVisualService {
  private readonly client: OpenAI | null
  private readonly model: string

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('OPENAI_API_KEY')?.trim()
    this.client = apiKey ? new OpenAI({ apiKey }) : null
    this.model = config.get<string>('OPENAI_VISION_MODEL') ?? 'gpt-5.4-mini'
  }

  private get openai() {
    if (!this.client) {
      throw new ServiceUnavailableException('La propuesta visual todavía no está habilitada. Agrega OPENAI_API_KEY en server/.env y reinicia el servidor.')
    }
    return this.client
  }

  async analyzeLogo(logo: Buffer, mimeType: string, description: string): Promise<LogoAnalysis> {
    const response = await this.openai.responses.create({
      model: this.model,
      store: false,
      max_output_tokens: 900,
      input: [{
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Actúa como diseñador de publicidad exterior. Analiza el logo para preparar una propuesta conceptual según esta solicitud: "${description}".
Devuelve únicamente JSON válido con esta forma exacta:
{"summary":"...","colors":["..."],"recommendedSign":"...","designNotes":["..."],"questions":["..."]}
No inventes medidas. Conserva el nombre, texto, símbolos y colores del logo. Haz preguntas breves solo sobre datos realmente útiles. No preguntes todavía por una foto del local; la aplicación lo hará como opción separada. Responde en español de Perú.`,
          },
          { type: 'input_image', image_url: dataUrl(logo, mimeType), detail: 'high' },
        ],
      }],
    })

    const parsed = parseJson(response.output_text) as Partial<LogoAnalysis>
    return {
      summary: String(parsed.summary ?? 'Logo revisado.'),
      colors: Array.isArray(parsed.colors) ? parsed.colors.map(String).slice(0, 6) : [],
      recommendedSign: String(parsed.recommendedSign ?? 'Letrero acorde con la identidad del logo.'),
      designNotes: Array.isArray(parsed.designNotes) ? parsed.designNotes.map(String).slice(0, 6) : [],
      questions: Array.isArray(parsed.questions) ? parsed.questions.map(String).slice(0, 4) : [],
    }
  }

  async generateProposal(input: {
    logo: Buffer
    logoMimeType: string
    description: string
    analysis: LogoAnalysis
    mode: 'NEUTRAL' | 'CONTEXTUAL'
    spacePhoto?: Buffer
    spaceMimeType?: string
    notes?: string
  }) {
    const contextual = input.mode === 'CONTEXTUAL'
    const content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'high' }> = [{
      type: 'input_text',
      text: `Genera una propuesta visual fotorealista y comercial para: "${input.description}".
Recomendación previa: ${input.analysis.recommendedSign}.
Indicaciones: ${input.notes || 'sin cambios adicionales'}.
Usa el primer archivo como logo de referencia obligatorio. Respeta exactamente su identidad, composición, texto legible, símbolos y colores; no lo rediseñes ni agregues marcas.
${contextual
  ? 'El segundo archivo es la foto real del espacio. Conserva la arquitectura, perspectiva y entorno. Integra el letrero de forma realista en una ubicación adecuada, con escala e iluminación plausibles, sin alterar otros elementos.'
  : 'Presenta el letrero terminado sobre un fondo neutro de estudio, limpio y elegante, con iluminación que permita apreciar materiales, volumen y acabado.'}
La imagen es una vista conceptual, no un plano técnico. No incluyas cotas, precios, marcas de agua ni texto explicativo fuera del propio logo. Formato horizontal.`,
    }, {
      type: 'input_image',
      image_url: dataUrl(input.logo, input.logoMimeType),
      detail: 'high',
    }]

    if (contextual && input.spacePhoto && input.spaceMimeType) {
      content.push({ type: 'input_image', image_url: dataUrl(input.spacePhoto, input.spaceMimeType), detail: 'high' })
    }

    const response = await this.openai.responses.create({
      model: this.model,
      store: false,
      input: [{ role: 'user', content }],
      tools: [{ type: 'image_generation' }],
    })

    const result = response.output
      .map((item) => item as { type: string; result?: string })
      .find((item) => item.type === 'image_generation_call')?.result
    if (!result) throw new Error('OpenAI no devolvió una imagen. Intenta nuevamente con una descripción más precisa.')
    return Buffer.from(result, 'base64')
  }
}
