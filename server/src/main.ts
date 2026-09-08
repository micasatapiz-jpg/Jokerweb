import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { resolve } from 'node:path'
import { createHash, timingSafeEqual } from 'node:crypto'
import { AppModule } from './app.module.js'

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: { redact: ['req.headers.authorization', 'req.url'] } }),
    { rawBody: true },
  )

  app.setGlobalPrefix('api')
  app.enableShutdownHooks()
  const production = process.env.NODE_ENV === 'production'
  const pilotUser = process.env.PILOT_USER?.trim()
  const pilotPassword = process.env.PILOT_PASSWORD
  if (production && (!pilotUser || !pilotPassword || pilotPassword.length < 20)) {
    throw new Error('Configura PILOT_USER y PILOT_PASSWORD (mínimo 20 caracteres) para el piloto privado.')
  }
  if (production && process.env.AI_PROVIDER !== 'openai') throw new Error('El despliegue requiere AI_PROVIDER=openai.')
  if (production && !process.env.OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY.')
  if (production && process.env.WHATSAPP_MODE === 'cloud') {
    for (const key of ['WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_GRAPH_VERSION']) {
      if (!process.env[key]?.trim()) throw new Error(`Falta ${key}.`)
    }
  }
  const server = app.getHttpAdapter().getInstance()
  if (production) {
    const expected = createHash('sha256').update(`Basic ${Buffer.from(`${pilotUser}:${pilotPassword}`).toString('base64')}`).digest()
    server.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?')[0]
      if (
  path === '/api/health' ||
  path === '/api/channels/whatsapp/webhook' ||
  path === '/politica-privacidad'
) return
      const actual = createHash('sha256').update(request.headers.authorization ?? '').digest()
      if (!timingSafeEqual(expected, actual)) {
        return reply.code(401).header('WWW-Authenticate', 'Basic realm="Joker piloto", charset="UTF-8"').send({ message: 'Acceso privado de pruebas.' })
      }
    })
  }
  await app.register(multipart, {
    limits: {
      files: 2,
      fileSize: 10 * 1024 * 1024,
      fields: 8,
    },
  })
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(','),
    credentials: true,
  })

  if (process.env.WEB_DIST_DIR) {
    await app.register(fastifyStatic, { root: resolve(process.env.WEB_DIST_DIR), wildcard: false })
    server.get('/*', (request, reply) => {
      const path = request.url.split('?')[0]
      if ((request.method === 'GET' || request.method === 'HEAD') && !path.startsWith('/api') && !/\.[a-z0-9]+$/i.test(path)) {
        return reply.type('text/html').sendFile('index.html')
      }
      return reply.code(404).send({ message: 'No encontrado' })
    })
  }

  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port, '0.0.0.0')
}

void bootstrap()
