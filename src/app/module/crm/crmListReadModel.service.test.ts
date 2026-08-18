import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(__dirname, '../../../..')
const read = (relative: string) => fs.readFileSync(path.join(projectRoot, relative), 'utf8')

const functionSlice = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  if (start < 0 || end < 0) throw new Error(`Unable to locate ${startMarker}`)
  return source.slice(start, end)
}

describe('CRM list read-model performance contract', () => {
  it('keeps Lead and Contact list endpoints on the aggregation presenter instead of populate fan-out', () => {
    const leadSource = read('src/app/module/lead/lead.service.ts')
    const contactSource = read('src/app/module/contact/contact.service.ts')
    const leadList = functionSlice(leadSource, 'const getAllLeads=', 'const getTodayFollowUps=')
    const contactList = functionSlice(contactSource, 'const getAllContacts =', 'const getContactById =')

    expect(leadList).toContain('readLeadListPage')
    expect(leadList).not.toContain('.populate(')
    expect(contactList).toContain('readContactListPage')
    expect(contactList).not.toContain('.populate(')
  })

  it('enriches only the paged rows and computes total count in the same aggregate', () => {
    const source = read('src/app/module/crm/crmListReadModel.service.ts')
    expect(source).toContain('$facet')
    expect(source).toContain('{ $skip: options.skip }')
    expect(source).toContain('{ $limit: options.limit }')
    expect(source).toContain("...leadActivityLookupStages()")
    expect(source).toContain("...contactActivityLookupStages()")
    expect(source).toContain("total: [{ $count: 'count' }]")
  })

  it('declares the compound indexes used by list, follow-up and timeline lookups', () => {
    const leadModel = read('src/app/module/lead/lead.model.ts')
    const contactModel = read('src/app/module/contact/contact.model.ts')
    const taskModel = read('src/app/module/task/task.model.ts')
    const activityModel = read('src/app/module/activity/activity.model.ts')

    expect(leadModel).toContain('lead_tenant_assignee_converted_followup')
    expect(leadModel).toContain('lead_tenant_status_converted_created')
    expect(contactModel).toContain('contact_tenant_relationship_assignee_followup')
    expect(taskModel).toContain('task_tenant_lead_type_status_dueat')
    expect(activityModel).toContain('activity_tenant_lead_type_created')
    expect(activityModel).toContain('activity_tenant_contact_type_created')
  })
})
