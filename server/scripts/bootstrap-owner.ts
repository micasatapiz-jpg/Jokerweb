import 'dotenv/config'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../src/database/prisma.service.js'
import { LocalTenantService } from '../src/common/local-tenant.service.js'
import { OperatorControlsService } from '../src/agent-core/operator-controls.service.js'

// Explicit operator-run local bootstrap. Never part of application startup.
const config = new ConfigService()
const url = new URL(config.getOrThrow<string>('DATABASE_URL'))
if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !process.argv.includes('--confirm-local-owner')) throw new Error('Requiere DB local y --confirm-local-owner. No ejecutar contra producción.')
const db = new PrismaService(config)
try {
  const service = new OperatorControlsService(db,new LocalTenantService(config))
  const owner = await service.bootstrapOwner({ name:config.getOrThrow('OWNER_BOOTSTRAP_NAME'),phone:config.getOrThrow('OWNER_BOOTSTRAP_PHONE'),verifiedBy:'local-operator-bootstrap' })
  console.log(JSON.stringify({ actorId:owner.id,type:owner.type,verified:true }))
} finally { await db.$disconnect() }
