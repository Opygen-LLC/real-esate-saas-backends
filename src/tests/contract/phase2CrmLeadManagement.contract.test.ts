import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../../..')
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

const slice = (source: string, start: string, end?: string) => {
  const from = source.indexOf(start)
  if (from < 0) throw new Error(`Missing source marker: ${start}`)
  const to = end ? source.indexOf(end, from + start.length) : source.length
  if (end && to < 0) throw new Error(`Missing source marker: ${end}`)
  return source.slice(from, to)
}

describe('Phase 2 CRM Lead management production contract', () => {
  it('keeps pagination/count separate from lookup enrichment on Lead and Contact read models', () => {
    const source = read('src/app/module/crm/crmListReadModel.service.ts')
    const leadReader = slice(source, 'export const readLeadListPage = async', 'export const readContactListPage = async')
    const contactReader = slice(source, 'export const readContactListPage = async')

    for (const reader of [leadReader, contactReader]) {
      expect(reader).toContain('{ $skip: options.skip }')
      expect(reader).toContain('{ $limit: options.limit }')
      expect(reader).toContain('Promise.all([')
      expect(reader).not.toContain('$facet')
    }
    expect(leadReader).toContain('Lead.countDocuments(documentMatch as any)')
    expect(contactReader).toContain('Contact.countDocuments(documentMatch as any)')
  })

  it('exposes one validated atomic Lead management operation while preserving dedicated lifecycle APIs', () => {
    const routes = read('src/app/module/lead/lead.route.ts')
    const validation = read('src/app/module/lead/lead.validation.ts')
    const controller = read('src/app/module/lead/lead.controller.ts')
    const service = read('src/app/module/lead/lead.service.ts')
    const lifecycle = read('src/app/module/lead/leadLifecycle.service.ts')

    expect(routes).toContain("router.patch('/:id/manage'")
    expect(routes).toContain('LeadValidation.manageLeadZodSchema')
    expect(controller).toContain('LeadService.manageLead')
    expect(validation).toContain('leadStatus: leadStatusSchema.optional()')
    expect(validation).toContain('assignedAgent: objectIdSchema.optional()')
    expect(validation).toContain('followUpDate: z.string().datetime().optional()')
    expect(service).toContain('session.withTransaction')
    expect(service).toContain('assignLeadInTransaction')
    expect(service).toContain('scheduleFollowUpInTransaction')
    expect(service).toContain('changeStatusInTransaction')
    expect(lifecycle).toContain('convertToContactInTransaction')
  })

  it('keeps website submissions pending until an explicit CRM conversion reuses canonical Lead creation', () => {
    const leadController = read('src/app/module/lead/lead.controller.ts')
    const submissionService = read('src/app/module/websiteSubmission/websiteSubmission.service.ts')
    const submissionRoutes = read('src/app/module/websiteSubmission/websiteSubmission.route.ts')

    expect(leadController).toMatch(/WebsiteSubmissionService\.captureLead\(req\.body, \{ ip: req\.ip, requestId: req\.requestId \}\)/)
    expect(leadController).not.toContain('LeadService.publicCaptureLead')
    expect(submissionService).toContain("crmTransferStatus: 'PENDING'")
    expect(submissionRoutes).toContain("'/:id/move-to-crm'")
    expect(submissionService).toContain('LeadService.createLeadWithOutcome')
    expect(submissionService).toContain("crmTransferOutcome: outcome")
    expect(submissionService).toContain("status: 'PROCESSED'")
  })
})
