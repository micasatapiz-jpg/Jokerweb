import { Body, Controller, Get, Post } from '@nestjs/common'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { createCustomerSchema, type CreateCustomerInput } from './customers.schemas.js'
import { CustomersService } from './customers.service.js'

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list() {
    return this.customers.list()
  }

  @Post()
  create(@Body(new ZodValidationPipe(createCustomerSchema)) input: CreateCustomerInput) {
    return this.customers.create(input)
  }
}

