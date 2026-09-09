import { Global, Module } from '@nestjs/common'
import { LocalTenantService } from './local-tenant.service.js'
import { OperatorApiGuard } from './operator-api.guard.js'

@Global()
@Module({
  providers: [LocalTenantService, OperatorApiGuard],
  exports: [LocalTenantService, OperatorApiGuard],
})
export class CommonModule {}
