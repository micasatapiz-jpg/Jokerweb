import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AIProvider } from './ai-provider.interface.js'
import {
  quoteRequirementsJsonSchema,
  quoteRequirementsSchema,
  type QuoteRequirements,
} from './quote-requirements.schema.js'

interface OllamaChatResponse {
  message?: { content?: string }
  error?: string
}

@Injectable()
export class OllamaProvider implements AIProvider {
  readonly name = 'OLLAMA' as const
  readonly model: string
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').replace(/\/$/, '')
    this.model = config.get<string>('OLLAMA_MODEL', 'qwen3.5:4b')
    this.timeoutMs = Number(config.get<string>('OLLAMA_TIMEOUT_MS', '90000'))
  }

  async extractQuoteRequirements(message: string, productNames: string[]): Promise<QuoteRequirements> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    const systemPrompt = [
      'Eres un asistente de ventas para Joker Publicidad de Huancayo, Perú.',
      'Extrae únicamente datos explícitos o inequívocos de la solicitud.',
      'No inventes medidas, material, cantidad, ubicación, fecha ni instalación.',
      'Usa null cuando un dato no esté disponible.',
      'missingFields debe listar en español los datos importantes que faltan.',
      'No calcules precios, descuentos, impuestos ni tiempos de entrega.',
      `Productos conocidos: ${productNames.join(', ')}.`,
      'Devuelve exclusivamente el objeto JSON solicitado.',
    ].join('\n')

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          think: false,
          format: quoteRequirementsJsonSchema,
          options: { temperature: 0.1, num_ctx: 4096 },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
        }),
        signal: controller.signal,
      })

      const payload = (await response.json()) as OllamaChatResponse
      if (!response.ok) throw new Error(payload.error ?? `Ollama respondió HTTP ${response.status}`)

      const rawContent = payload.message?.content?.trim()
      if (!rawContent) throw new Error('Ollama no devolvió contenido.')

      const cleanContent = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      return quoteRequirementsSchema.parse(JSON.parse(cleanContent))
    } finally {
      clearTimeout(timeout)
    }
  }
}

