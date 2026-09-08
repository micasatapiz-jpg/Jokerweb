import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common'
import { z } from 'zod'

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodType) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value)
    if (result.success) return result.data

    throw new BadRequestException({
      message: 'Revisa los datos ingresados antes de continuar.',
      fields: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
  }
}

