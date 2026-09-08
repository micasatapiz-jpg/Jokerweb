import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class LocalTenantService {
  constructor(private readonly config: ConfigService) {}

  get tenantId() {
    return this.config.getOrThrow<string>('DEFAULT_TENANT_ID')
  }
}

