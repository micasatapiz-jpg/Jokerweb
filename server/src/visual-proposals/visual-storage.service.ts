import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const extensionByMime: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
}

@Injectable()
export class VisualStorageService {
  private readonly root: string

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('VISUAL_PROPOSALS_DIR') ?? 'uploads/visual-proposals')
  }

  async save(buffer: Buffer, mimeType: string) {
    await mkdir(this.root, { recursive: true })
    const storageKey = `${randomUUID()}${extensionByMime[mimeType] ?? '.bin'}`
    await writeFile(resolve(this.root, storageKey), buffer)
    return storageKey
  }

  async read(storageKey: string) {
    if (!/^[a-f0-9-]+\.(png|jpg|webp)$/i.test(storageKey)) throw new Error('Clave de archivo inválida.')
    return readFile(resolve(this.root, storageKey))
  }
}
