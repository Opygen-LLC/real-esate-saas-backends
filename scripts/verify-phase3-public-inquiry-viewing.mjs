import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const leadController = read('src/app/module/lead/lead.controller.ts')
const leadService = read('src/app/module/lead/lead.service.ts')
const websiteSubmissionService = read('src/app/module/websiteSubmission/websiteSubmission.service.ts')
const websiteSubmissionController = read('src/app/module/websiteSubmission/websiteSubmission.controller.ts')
const viewingService = read('src/app/module/viewing/viewing.service.ts')
const propertyConstants = read('src/app/module/property/property.constants.ts')
const propertyService = read('src/app/module/property/property.service.ts')
const realtimeTypes = read('src/app/module/realtime/realtime.types.ts')

assert.match(leadController, /LeadService\.publicCaptureLead[\s\S]*WebsiteSubmissionService\.captureLead\(req\.body, lead\)/)
assert.match(websiteSubmissionService, /linkedEntityType:\s*'Lead'/)
assert.match(websiteSubmissionService, /linkedEntityId:\s*lead\._id/)
assert.doesNotMatch(websiteSubmissionService, /Lead\.create\(/)
assert.match(leadService, /Property\.exists\(\{_id:propertyInterest,organizationId\}\)/)

assert.match(propertyConstants, /VIEWING_REQUESTABLE_PROPERTY_STATUSES\s*=\s*\['Available', 'UnderOffer'\]/)
assert.match(propertyService, /String\(status\)\.split\(','\)/)
assert.match(viewingService, /VIEWING_REQUESTABLE_PROPERTY_STATUSES\.includes\(property\.status\)/)
assert.match(viewingService, /VIEWING_TIME_PAST/)
assert.match(viewingService, /VIEWING_SLOT_UNAVAILABLE/)
assert.match(viewingService, /VIEWING_AGENT_BUSY/)
assert.match(viewingService, /VIEWING_AGENT_UNAVAILABLE/)
assert.match(viewingService, /PROPERTY_VIEWING_UNAVAILABLE/)

// Conflict validation happens before the public Lead is created, so a known-bad slot
// cannot leave an orphan Lead behind.
const publicStart = viewingService.indexOf('const publicRequestViewing')
const publicEnd = viewingService.indexOf('const VIEWING_LIST_SORT_FIELDS', publicStart)
const publicFlow = viewingService.slice(publicStart, publicEnd)
assert.ok(publicFlow.indexOf('checkConflict(') < publicFlow.indexOf('LeadService.createLead('))

// Website-submission enrichment is tenant-scoped and CRM-scope-aware.
assert.match(websiteSubmissionService, /Lead\.find\(\{ _id: \{ \$in: leadIds \}, organizationId, \.\.\.ownLeadScope \}\)/)
assert.match(websiteSubmissionService, /Viewing\.find\(\{ _id: \{ \$in: viewingIds \}, organizationId, \.\.\.ownViewingScope \}\)/)
assert.match(websiteSubmissionController, /crmRecordReadAccessFromRequest\(req\)/)
assert.match(realtimeTypes, /website_submission\.changed/)
assert.match(websiteSubmissionService, /type: 'website_submission\.changed'/)

// Existing reminder + realtime event paths remain part of every successful viewing creation.
assert.match(viewingService, /await scheduleReminder\(result\)/)
assert.match(viewingService, /eventType:'viewing\.scheduled'/)

console.log('[phase3] public inquiry/viewing source invariants verified')
