import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const accessControl = read('src/app/module/user/accessControl.ts')
const crmAccess = read('src/app/module/crm/crmAccess.ts')
const leadLifecycle = read('src/app/module/lead/leadLifecycle.service.ts')
const leadService = read('src/app/module/lead/lead.service.ts')
const contactService = read('src/app/module/contact/contact.service.ts')
const taskService = read('src/app/module/task/task.service.ts')
const activityService = read('src/app/module/activity/activity.service.ts')
const viewingService = read('src/app/module/viewing/viewing.service.ts')
const viewingController = read('src/app/module/viewing/viewing.controller.ts')
const propertyConstants = read('src/app/module/property/property.constants.ts')
const migration = read('src/app/db/migrateCrmTeamManagePermission.ts')

assert.match(accessControl, /'crm\.team\.manage'/)
assert.match(accessControl, /'crm\.team\.manage':\s*\['crm\.team\.read',[\s\S]*'leads\.assign'[\s\S]*'viewings\.write'/)
assert.match(accessControl, /label:\s*'Manage team CRM records'/)
assert.match(crmAccess, /canManageTeam\s*=\s*isManager\s*\|\|\s*permissions\.includes\('crm\.team\.manage'\)/)
assert.match(crmAccess, /crmMutationOwnerFilter[\s\S]*canManageTeamCrm\(access\)[\s\S]*return \{\}/)
assert.match(crmAccess, /crmAssignmentOwnerFilter[\s\S]*access\.canReadTeam\s*&&\s*access\.permissions\.includes\('leads\.assign'\)/)
assert.match(leadLifecycle, /loadAssignableLead[\s\S]*crmAssignmentOwnerFilter\('assignedAgent', access\)/)
assert.match(leadService, /canManageTeamCrm\(access\)/)
assert.match(contactService, /canManageTeamCrm\(access\)/)
assert.match(taskService, /canManageTeamCrm\(access\)/)
assert.match(activityService, /crmMutationOwnerFilter\('assignedAgent', access\)/)
assert.match(activityService, /crmMutationOwnerFilter\('assignedTo', access\)/)
assert.match(viewingService, /crmMutationOwnerFilter\('agentId',access\)/)
assert.match(viewingService, /crmReadOwnerFilter\('agentId', access\)/)
assert.match(viewingController, /crmAccessFromRequest\(req, req\.query\.scope\)/)
assert.match(propertyConstants, /CRM_PROPERTY_INTEREST_STATUSES\s*=\s*\['Available', 'UnderOffer', 'Reserved', 'ComingSoon'\]/)
assert.match(migration, /LEGACY_FULL_CRM_PERMISSIONS/)
assert.match(migration, /\$addToSet:\s*\{\s*'accessControl\.permissions': TEAM_MANAGE_PERMISSION/)

console.log('[phase4] CRM team-management and property-interest source invariants verified')
