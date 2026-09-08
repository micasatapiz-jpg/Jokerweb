import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { updatePriceRuleSchema, type UpdatePriceRuleInput } from './products.schemas.js'
import { ProductsService } from './products.service.js'

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list() {
    return this.products.list()
  }

  @Put(':id/price-rule')
  updatePriceRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePriceRuleSchema)) input: UpdatePriceRuleInput,
  ) {
    return this.products.updatePriceRule(id, input)
  }
}
