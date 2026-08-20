import fs from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import sharp from 'sharp'

export type ReceiptStatus = 'CONFIRMED' | 'PAID'

export interface SubscriptionReceiptPdfInput {
  receiptNumber: string
  paymentNumber: string
  status: ReceiptStatus
  agencyName: string
  customerEmail?: string | null
  planName: string
  planVersion?: number | null
  billingCycle: 'monthly' | 'yearly' | 'one-time' | string
  periodStart?: Date | string | null
  periodEnd?: Date | string | null
  paymentMethod?: string | null
  paymentReference?: string | null
  paidAt?: Date | string | null
  confirmedAt?: Date | string | null
  subtotal: number
  vatRate?: number | null
  vatAmount?: number | null
  total: number
  currency?: string | null
  taxOperatorLegalName?: string | null
  taxBin?: string | null
}

export interface GeneratedReceiptPdf {
  buffer: Buffer
  fileName: string
}

const BRAND = {
  name: 'OPYGEN ESTATE',
  productLine: 'A Product of Opygen',
  blue: rgb(0.145, 0.388, 0.922),
  ink: rgb(0.059, 0.09, 0.165),
  muted: rgb(0.392, 0.455, 0.545),
  border: rgb(0.886, 0.91, 0.941),
  panel: rgb(0.973, 0.98, 0.988),
  success: rgb(0.086, 0.502, 0.278),
  successBg: rgb(0.863, 0.988, 0.906),
} as const

const LOGO_PATH = path.resolve(__dirname, '../../../assets/branding/opygen-estate-logo.svg')
let logoPngPromise: Promise<Buffer> | null = null

const getLogoPng = async (): Promise<Buffer> => {
  if (!logoPngPromise) {
    logoPngPromise = fs.readFile(LOGO_PATH).then((svg) => sharp(svg, { density: 180 }).png().toBuffer())
  }
  return logoPngPromise
}

const safeAscii = (value: unknown, fallback = 'N/A'): string => {
  const normalized = String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  const printable = normalized.replace(/[^\x20-\x7E]/g, '?').trim()
  return printable || fallback
}

const formatMoney = (amount: number, currency = 'BDT'): string => {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0
  return `${safeAscii(currency || 'BDT', 'BDT')} ${new Intl.NumberFormat('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`
}

const toDate = (value?: Date | string | null): Date | null => {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const formatDate = (value?: Date | string | null, includeTime = false): string => {
  const date = toDate(value)
  if (!date) return 'N/A'
  return new Intl.DateTimeFormat('en-BD', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
    timeZone: 'Asia/Dhaka',
  }).format(date)
}

const cycleLabel = (cycle: string): string => {
  if (cycle === 'yearly') return 'Yearly'
  if (cycle === 'monthly') return 'Monthly'
  if (cycle === 'one-time') return 'One-time'
  return safeAscii(cycle)
}

const paymentMethodLabel = (method?: string | null): string => {
  if (!method) return 'Manual'
  return safeAscii(method).replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

const fitText = (font: PDFFont, value: string, size: number, maxWidth: number): string => {
  const safe = safeAscii(value)
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe

  const suffix = '...'
  let candidate = safe
  while (candidate.length > 1 && font.widthOfTextAtSize(`${candidate}${suffix}`, size) > maxWidth) {
    candidate = candidate.slice(0, -1)
  }
  return `${candidate}${suffix}`
}

const drawLabelValue = (
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
) => {
  page.drawText(safeAscii(label), { x, y, size: 8, font: fonts.bold, color: BRAND.muted })
  page.drawText(fitText(fonts.regular, value, 10.5, width), { x, y: y - 15, size: 10.5, font: fonts.regular, color: BRAND.ink })
}

const drawLogo = async (pdf: PDFDocument, page: PDFPage): Promise<PDFImage | null> => {
  try {
    const image = await pdf.embedPng(await getLogoPng())
    page.drawImage(image, { x: 48, y: 753, width: 168, height: 37.3 })
    return image
  } catch {
    // The receipt still renders a text brand if a deployment accidentally misses the SVG asset.
    return null
  }
}

const buildFileName = (receiptNumber: string): string => {
  const safeReceipt = safeAscii(receiptNumber, 'receipt').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'receipt'
  return `opygen-estate-${safeReceipt}.pdf`
}

const generateSubscriptionReceiptPdf = async (input: SubscriptionReceiptPdfInput): Promise<GeneratedReceiptPdf> => {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Opygen Estate Receipt ${safeAscii(input.receiptNumber)}`)
  pdf.setAuthor('Opygen Estate')
  pdf.setSubject('Subscription Payment Receipt')
  pdf.setCreator('Opygen Estate')
  pdf.setProducer('Opygen Estate')
  pdf.setCreationDate(new Date())
  pdf.setModificationDate(new Date())

  const page = pdf.addPage([595.28, 841.89])
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const fonts = { regular, bold }

  page.drawRectangle({ x: 0, y: 805, width: 595.28, height: 36.89, color: BRAND.blue })
  const logo = await drawLogo(pdf, page)
  if (!logo) {
    page.drawText(BRAND.name, { x: 48, y: 765, size: 18, font: bold, color: BRAND.ink })
  }

  page.drawText('Subscription Payment Receipt', { x: 48, y: 716, size: 19, font: bold, color: BRAND.ink })
  page.drawText('Official subscription payment record', { x: 48, y: 697, size: 9.5, font: regular, color: BRAND.muted })

  page.drawRectangle({ x: 430, y: 706, width: 116, height: 26, color: BRAND.successBg, borderColor: BRAND.success, borderWidth: 0.6 })
  page.drawText(safeAscii(input.status), { x: 449, y: 715, size: 9, font: bold, color: BRAND.success })

  page.drawLine({ start: { x: 48, y: 676 }, end: { x: 547, y: 676 }, thickness: 1, color: BRAND.border })

  drawLabelValue(page, fonts, 'Receipt Number', input.receiptNumber, 48, 652, 220)
  drawLabelValue(page, fonts, 'Payment Number', input.paymentNumber, 310, 652, 237)
  drawLabelValue(page, fonts, 'Agency Name', input.agencyName, 48, 607, 220)
  drawLabelValue(page, fonts, 'Customer Email', input.customerEmail || 'N/A', 310, 607, 237)

  page.drawRectangle({ x: 48, y: 494, width: 499, height: 82, color: BRAND.panel, borderColor: BRAND.border, borderWidth: 0.7 })
  page.drawText('SUBSCRIPTION', { x: 64, y: 555, size: 8, font: bold, color: BRAND.muted })
  page.drawText(fitText(bold, `${input.planName}${input.planVersion ? ` v${input.planVersion}` : ''}`, 14, 230), { x: 64, y: 531, size: 14, font: bold, color: BRAND.ink })
  page.drawText(cycleLabel(input.billingCycle), { x: 64, y: 510, size: 9.5, font: regular, color: BRAND.muted })
  page.drawText('SUBSCRIPTION PERIOD', { x: 310, y: 555, size: 8, font: bold, color: BRAND.muted })
  page.drawText(fitText(regular, `${formatDate(input.periodStart)} - ${formatDate(input.periodEnd)}`, 10.5, 221), { x: 310, y: 531, size: 10.5, font: regular, color: BRAND.ink })

  drawLabelValue(page, fonts, 'Payment Method', paymentMethodLabel(input.paymentMethod), 48, 463, 220)
  drawLabelValue(page, fonts, 'Transaction / Reference', input.paymentReference || 'N/A', 310, 463, 237)
  drawLabelValue(page, fonts, 'Paid Date', formatDate(input.paidAt, true), 48, 418, 220)
  drawLabelValue(page, fonts, 'Confirmed Date', formatDate(input.confirmedAt, true), 310, 418, 237)

  const taxAmount = Math.max(0, Number(input.vatAmount || 0))
  const subtotal = Number.isFinite(Number(input.subtotal)) ? Number(input.subtotal) : 0
  const total = Number.isFinite(Number(input.total)) ? Number(input.total) : subtotal + taxAmount
  const currency = input.currency || 'BDT'

  page.drawLine({ start: { x: 48, y: 374 }, end: { x: 547, y: 374 }, thickness: 1, color: BRAND.border })
  page.drawText('PAYMENT SUMMARY', { x: 48, y: 350, size: 8, font: bold, color: BRAND.muted })
  page.drawText('Subtotal', { x: 330, y: 321, size: 10, font: regular, color: BRAND.muted })
  page.drawText(fitText(regular, formatMoney(subtotal, currency), 10, 117), { x: 430, y: 321, size: 10, font: regular, color: BRAND.ink })

  let totalY = 287
  if (taxAmount > 0 || Number(input.vatRate || 0) > 0) {
    const rate = Number(input.vatRate || 0)
    page.drawText(rate > 0 ? `VAT / Tax (${rate}%)` : 'VAT / Tax', { x: 330, y: 297, size: 10, font: regular, color: BRAND.muted })
    page.drawText(fitText(regular, formatMoney(taxAmount, currency), 10, 117), { x: 430, y: 297, size: 10, font: regular, color: BRAND.ink })
    totalY = 263
  }

  page.drawRectangle({ x: 320, y: totalY - 11, width: 227, height: 38, color: BRAND.ink })
  page.drawText('TOTAL PAID', { x: 334, y: totalY + 3, size: 9, font: bold, color: rgb(1, 1, 1) })
  page.drawText(fitText(bold, formatMoney(total, currency), 12, 112), { x: 421, y: totalY + 1, size: 12, font: bold, color: rgb(1, 1, 1) })

  if (input.taxOperatorLegalName || input.taxBin) {
    page.drawText('Tax details', { x: 48, y: 292, size: 8, font: bold, color: BRAND.muted })
    if (input.taxOperatorLegalName) page.drawText(fitText(regular, input.taxOperatorLegalName, 9, 230), { x: 48, y: 274, size: 9, font: regular, color: BRAND.ink })
    if (input.taxBin) page.drawText(`BIN: ${safeAscii(input.taxBin)}`, { x: 48, y: 258, size: 8.5, font: regular, color: BRAND.muted })
  }

  page.drawLine({ start: { x: 48, y: 112 }, end: { x: 547, y: 112 }, thickness: 1, color: BRAND.border })
  page.drawText('Opygen Estate', { x: 48, y: 87, size: 10, font: bold, color: BRAND.ink })
  page.drawText(BRAND.productLine, { x: 48, y: 71, size: 8.5, font: regular, color: BRAND.muted })
  page.drawText(fitText(regular, 'This receipt was generated electronically and does not require a signature.', 7.5, 274), { x: 273, y: 78, size: 7.5, font: regular, color: BRAND.muted })

  const bytes = await pdf.save({ useObjectStreams: true })
  return { buffer: Buffer.from(bytes), fileName: buildFileName(input.receiptNumber) }
}

export const SubscriptionReceiptPdfService = {
  generateSubscriptionReceiptPdf,
}
