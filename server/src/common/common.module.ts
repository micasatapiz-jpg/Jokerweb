import { Global, Module } from '@nestjs/common'
import { LocalTenantService } from './local-tenant.service.js'

@Global()
@Module({
  providers: [LocalTenantService],
  exports: [LocalTenantService],
})
export class CommonModule {}
