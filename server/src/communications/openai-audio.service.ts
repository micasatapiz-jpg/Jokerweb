import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import OpenAI, { toFile } from 'openai'

@Injectable()
export class OpenAIAudioService {
  private readonly client: OpenAI | null
  readonly transcriptionModel: string
  readonly speechModel: string
  readonly voice: string

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('OPENAI_API_KEY')?.trim()
    this.client = apiKey ? new OpenAI({ apiKey }) : null
    this.transcriptionModel = config.get<string>('OPENAI_TRANSCRIPTION_MODEL', 'gpt-transcribe')
    this.speechModel = config.get<string>('OPENAI_SPEECH_MODEL', 'gpt-4o-mini-tts')
    this.voice = config.get<string>('OPENAI_SPEECH_VOICE', 'marin')
  }

  get enabled() {
    return this.client !== null
  }

  private get openai() {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'El audio con OpenAI todavía no está habilitado. Agrega OPENAI_API_KEY en server/.env y reinicia la API.',
      )
    }
    return this.client
  }

  async transcribe(input: { buffer: Buffer; filename: string; mimeType: string }) {
    const file = await toFile(input.buffer, input.filename, { type: input.mimeType })
    const response = await this.openai.audio.transcriptions.create({
      file,
      model: this.transcriptionModel,
      language: 'es',
      prompt: 'Joker Publicidad, Huancayo, letreros luminosos, letras corpóreas, viniles, gigantografías, señalética, instalación, medidas y cotización en soles.',
    })

    const text = response.text.trim()
    if (!text) throw new Error('OpenAI no detectó palabras en el audio.')
    return text
  }

  async synthesize(text: string) {
    const response = await this.openai.audio.speech.create({
      model: this.speechModel,
      voice: this.voice,
      input: text,
      response_format: 'mp3',
      instructions: 'Habla en español peruano con voz cordial, clara y profesional. Mantén un ritmo natural de atención comercial, sin exagerar ni sonar como anuncio.',
    })
    return Buffer.from(await response.arrayBuffer())
  }
}
