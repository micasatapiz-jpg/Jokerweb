import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { resolve } from 'node:path'
import { AppModule } from './app.module.js'

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: {
        redact: ['req.headers.authorization', 'req.url'],
      },
    }),
    { rawBody: true },
  )

  app.setGlobalPrefix('api')
  app.enableShutdownHooks()

  const production = process.env.NODE_ENV === 'production'

  if (production && process.env.AI_PROVIDER !== 'openai') {
    throw new Error('El despliegue requiere AI_PROVIDER=openai.')
  }

  if (production && !process.env.OPENAI_API_KEY) {
    throw new Error('Falta OPENAI_API_KEY.')
  }

  if (production && process.env.WHATSAPP_MODE === 'cloud') {
    for (const key of [
      'WHATSAPP_APP_SECRET',
      'WHATSAPP_VERIFY_TOKEN',
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_GRAPH_VERSION',
    ]) {
      if (!process.env[key]?.trim()) {
        throw new Error(`Falta ${key}.`)
      }
    }
  }

  const server = app.getHttpAdapter().getInstance()

  await app.register(multipart, {
    limits: {
      files: 2,
      fileSize: 10 * 1024 * 1024,
      fields: 8,
    },
  })

  app.enableCors({
    origin: (
      process.env.CORS_ORIGIN ??
      'http://localhost:5173,http://127.0.0.1:5173'
    ).split(','),
    credentials: true,
  })

  if (process.env.WEB_DIST_DIR) {
    await app.register(fastifyStatic, {
      root: resolve(process.env.WEB_DIST_DIR),
      wildcard: false,
    })

    server.get('/*', (request, reply) => {
      const path = request.url.split('?')[0]

      if (
        (request.method === 'GET' || request.method === 'HEAD') &&
        !path.startsWith('/api') &&
        !/\.[a-z0-9]+$/i.test(path)
      ) {
        return reply.type('text/html').sendFile('index.html')
      }

      return reply.code(404).send({
        message: 'No encontrado',
      })
    })
  }

  const port = Number(process.env.PORT ?? 3000)

  await app.listen(port, '0.0.0.0')
}

void bootstrap()