import { describe, expect, it } from 'vitest'
import { AgentInterpreterService } from './agent-interpreter.service.js'

describe('AgentInterpreterService', () => {
  const interpreter = new AgentInterpreterService()

  it.each(['Un luminoso de 2 x 1', 'Quiero imprimir 2 x 1', 'Local a 3 metros, banner 2 x 1'])('no toma letras o medidas ajenas como unidad: %s', async (text) => {
    expect((await interpreter.interpret({ text })).ambiguousMeasurement).toBe(true)
  })

  it.each(['Banner 200cm x 100cm', 'Banner 2 por 1 metros', 'Banner 2 metros por 1 metro'])('reconoce la unidad de la pareja: %s', async (text) => {
    expect((await interpreter.interpret({ text })).ambiguousMeasurement).toBe(false)
  })

  it('detecta pago', async () => {
    const result = await interpreter.interpret({
      text: 'Ya hice el Yape y te mando el comprobante',
      hasImage: true,
    })

    expect(result.intent).toBe('PAGO')
    expect(result.filePurpose).toBe('PAYMENT_PROOF')
  })

  it('detecta solicitud de humano', async () => {
    const result = await interpreter.interpret({
      text: 'No quiero hablar con la IA, quiero hablar con el jefe',
    })

    expect(result.intent).toBe('SOLICITA_HUMANO')
  })

  it('detecta proveedor', async () => {
    const result = await interpreter.interpret({
      text: 'Soy proveedor y quiero ofrecerles acrílico',
    })

    expect(result.intent).toBe('PROVEEDOR')
  })

  it('detecta seguimiento de pedido', async () => {
    const result = await interpreter.interpret({
      text: '¿Ya está listo mi banner?',
    })

    expect(result.intent).toBe('SEGUIMIENTO_PEDIDO')
    expect(result.productQuery).toBe('banner')
  })

  it('detecta venta nueva', async () => {
    const result = await interpreter.interpret({
      text: 'Quiero un letrero para mi negocio',
    })

    expect(result.intent).toBe('VENTA_NUEVA')
    expect(result.productQuery).toBe('letrero')
  })

  it('detecta medida ambigua sin unidad', async () => {
    const result = await interpreter.interpret({
      text: 'Quiero un banner de 2 x 1',
    })

    expect(result.ambiguousMeasurement).toBe(true)
  })

  it('no marca medida ambigua si tiene unidad', async () => {
    const result = await interpreter.interpret({
      text: 'Quiero un banner de 2 m x 1 m',
    })

    expect(result.ambiguousMeasurement).toBe(false)
  })

  it('detecta foto de fachada', async () => {
    const result = await interpreter.interpret({
      text: 'Te mando la foto de la fachada',
      hasImage: true,
    })

    expect(result.filePurpose).toBe('SPACE_PHOTO')
  })
})
