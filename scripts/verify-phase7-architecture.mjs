import fs from 'node:fs'
import path from 'node:path'

const read = (file) => fs.readFileSync(file, 'utf8')
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const walk = (directory) => {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

assert(!fs.existsSync('src/app/module/bkashPayment'), 'Automated bKash gateway module must not exist')
const config = read('src/config/index.ts')
assert(!/BKASH_ENABLED|BKASH_GRANT_TOKEN_URL|config\.bkash|\bbkash:\s*\{/i.test(config), 'Automated bKash gateway configuration must be removed')

for (const legacy of ['moderation', 'compliance', 'supportTicket']) {
  const files = walk('src/app/module').filter((file) => file.toLowerCase().includes(legacy.toLowerCase()))
  assert(files.length === 0, `Legacy ${legacy} runtime module remains: ${files.join(', ')}`)
}

const app = read('src/app.ts')
assert(!/bkashPayment|moderation|supportTicket|compliance/i.test(app), 'Legacy gateway/moderation/ticket/compliance route is still mounted')

const paymentService = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
assert(/withTransaction|startSession/i.test(paymentService), 'Subscription activation must use a MongoDB transaction')
assert(/status:\s*'confirmed'/.test(paymentService), 'Confirmed manual payments must remain the activation source')

const propertyRoute = read('src/app/module/property/property.route.ts')
assert(/properties\.publish/.test(propertyRoute), 'Property publication must be protected by agency properties.publish permission')
const propertyValidation = read('src/app/module/property/property.validation.ts')
assert(/\.max\(20\)/.test(propertyValidation), 'Property photo contract must enforce max 20 photos')
const mediaService = read('src/app/module/property/propertyMedia.service.ts')
for (const provider of ['youtube', 'vimeo', 'matterport', 'kuula']) assert(mediaService.includes(`'${provider}'`), `Missing safe media provider: ${provider}`)

const platformAdmin = read('src/app/module/platformAdmin/platformAdmin.controller.ts')
assert(/confirmed manual subscription payments/i.test(platformAdmin), 'Super-admin revenue must be sourced from confirmed manual subscription payments')

const supportSettings = read('src/app/module/platformSettings/platformSettings.validation.ts')
assert(/whatsapp/i.test(supportSettings), 'Platform support contact settings must expose WhatsApp')

console.log('Phase 7 backend architecture verification passed.')
