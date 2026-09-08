import { Injectable } from '@nestjs/common'
import PDFDocument from 'pdfkit'
import type { QuotesService } from './quotes.service.js'

type QuoteDetail = Awaited<ReturnType<QuotesService['get']>>

const soles = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
})

@Injectable()
export class QuotePdfService {
  async render(quote: QuoteDetail): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true })
      const chunks: Buffer[] = []

      document.on('data', (chunk: Buffer) => chunks.push(chunk))
      document.on('end', () => resolve(Buffer.concat(chunks)))
      document.on('error', reject)

      const ink = '#141414'
      const accent = '#f3b51b'
      const muted = '#666666'

      document.rect(0, 0, document.page.width, 12).fill(accent)
      document.fillColor(ink).font('Helvetica-Bold').fontSize(25).text('JOKER', 48, 42)
      document.font('Helvetica').fontSize(10).fillColor(muted).text('Publicidad y comunicación visual', 48, 72)
      document.font('Helvetica-Bold').fontSize(17).fillColor(ink).text('COTIZACIÓN', 360, 45, { align: 'right' })
      document.font('Helvetica').fontSize(10).fillColor(muted).text(quote.number, 360, 69, { align: 'right' })

      document.moveTo(48, 98).lineTo(547, 98).strokeColor('#dddddd').stroke()
      document.font('Helvetica-Bold').fontSize(10).fillColor(ink).text('CLIENTE', 48, 116)
      document.font('Helvetica').fontSize(11).text(quote.customer.name, 48, 135)
      if (quote.customer.company) document.text(quote.customer.company, 48, 151)
      if (quote.customer.phone) document.text(`Teléfono: ${quote.customer.phone}`, 48, 167)
      if (quote.customer.email) document.text(`Correo: ${quote.customer.email}`, 48, 183)

      const createdAt = new Intl.DateTimeFormat('es-PE', { dateStyle: 'long' }).format(quote.createdAt)
      const validUntil = quote.validUntil
        ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'long' }).format(quote.validUntil)
        : 'Por coordinar'
      document.font('Helvetica-Bold').fontSize(10).text('FECHA', 350, 116)
      document.font('Helvetica').fontSize(10).text(createdAt, 350, 135, { align: 'right' })
      document.font('Helvetica-Bold').text('VÁLIDA HASTA', 350, 158, { align: 'right' })
      document.font('Helvetica').text(validUntil, 350, 177, { align: 'right' })

      let y = 222
      document.rect(48, y, 499, 28).fill(ink)
      document.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
      document.text('DESCRIPCIÓN', 58, y + 10, { width: 250 })
      document.text('CANT.', 324, y + 10, { width: 45, align: 'right' })
      document.text('P. UNIT.', 380, y + 10, { width: 70, align: 'right' })
      document.text('SUBTOTAL', 462, y + 10, { width: 75, align: 'right' })
      y += 28

      for (const item of quote.items) {
        const description = [
          item.description,
          item.widthM && item.heightM ? `${Number(item.widthM)} m × ${Number(item.heightM)} m` : null,
        ]
          .filter(Boolean)
          .join(' · ')
        const rowHeight = Math.max(36, document.heightOfString(description, { width: 250 }) + 18)
        document.rect(48, y, 499, rowHeight).fillAndStroke('#fafafa', '#e5e5e5')
        document.fillColor(ink).font('Helvetica').fontSize(9)
        document.text(description, 58, y + 10, { width: 250 })
        document.text(String(item.quantity), 324, y + 10, { width: 45, align: 'right' })
        document.text(soles.format(Number(item.unitPrice)), 380, y + 10, { width: 70, align: 'right' })
        document.text(soles.format(Number(item.subtotal)), 462, y + 10, { width: 75, align: 'right' })
        y += rowHeight
      }

      y += 18
      const totalLine = (label: string, amount: number, bold = false) => {
        document.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 13 : 10).fillColor(ink)
        document.text(label, 345, y, { width: 90, align: 'right' })
        document.text(soles.format(amount), 447, y, { width: 90, align: 'right' })
        y += bold ? 24 : 18
      }
      totalLine('Subtotal', Number(quote.subtotal))
      if (Number(quote.discount) > 0) totalLine('Descuento', -Number(quote.discount))
      totalLine('IGV', Number(quote.tax))
      document.moveTo(345, y - 4).lineTo(537, y - 4).strokeColor(accent).lineWidth(2).stroke()
      totalLine('TOTAL', Number(quote.total), true)

      const observations = [
        quote.designBrief ? `Diseño: ${quote.designBrief}` : null,
        quote.serviceAddress ? `Ubicación: ${quote.serviceAddress}` : null,
        quote.installationNotes ? `Instalación: ${quote.installationNotes}` : null,
        quote.notes,
      ].filter(Boolean).join('\n')
      if (observations) {
        y += 8
        document.font('Helvetica-Bold').fontSize(10).text('OBSERVACIONES', 48, y)
        document.font('Helvetica').fontSize(9).fillColor(muted).text(observations, 48, y + 17, { width: 480 })
      }

      document.font('Helvetica').fontSize(8).fillColor(muted)
      document.text(
        'Precios expresados en soles e incluyen IGV. La producción se programa al confirmar la cotización.',
        48,
        760,
        { width: 499, align: 'center' },
      )
      document.end()
    })
  }
}
