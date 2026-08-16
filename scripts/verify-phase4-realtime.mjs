import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8')
const pkg = JSON.parse(read('package.json'))

assert.equal(pkg.dependencies['socket.io'], '^4.8.3')
assert.equal(pkg.dependencies['@socket.io/redis-adapter'], '^8.3.0')
assert.equal(pkg.dependencies.redis, '^6.2.1')

const server = read('src/server.ts')
assert.match(server, /createServer\(app\)/)
assert.match(server, /initializeRealtimeServer\(server\)/)
assert.ok(server.indexOf('closeRealtimeServer()') < server.indexOf('server!.close'), 'Socket transports must close before HTTP shutdown')

const realtimeServer = read('src/app/module/realtime/realtime.server.ts')
assert.match(realtimeServer, /createAdapter/)
assert.match(realtimeServer, /createClient/)
assert.match(realtimeServer, /io\.of\('\/dashboard'\)/)
assert.match(realtimeServer, /io\.of\('\/public'\)/)
assert.match(realtimeServer, /REALTIME_AUTH_REQUIRED/)
assert.match(realtimeServer, /realtime_ticket/)
assert.match(realtimeServer, /tenant:subscribe/)
assert.match(realtimeServer, /public:org:/)
assert.match(realtimeServer, /isBlocked: \{ \$ne: true \}/)
assert.match(realtimeServer, /websiteStatus: \{ \$ne: 'suspended' \}/)

const realtimeService = read('src/app/module/realtime/realtime.service.ts')
for (const event of ['property.changed', 'lead.changed', 'notification.changed', 'task.changed', 'viewing.changed', 'team.changed', 'auth.changed', 'session.changed']) {
  assert.ok(realtimeService.includes(event), `missing realtime event ${event}`)
}
assert.match(realtimeService, /payload\?\.publicVisible === true/)

const authRoute = read('src/app/module/auth/auth.route.ts')
const authService = read('src/app/module/auth/auth.services.ts')
assert.match(authRoute, /realtime-ticket/)
assert.match(authService, /createRealtimeTicket/)
assert.match(authService, /aud: 'dashboard_socket'/)

const domainEvents = read('src/app/module/domainEvent/domainEvent.service.ts')
assert.match(domainEvents, /RealtimeService\.fromDomainEvent\(input\)/)
assert.match(domainEvents, /NextRevalidationService\.trigger/)

const propertyService = read('src/app/module/property/property.service.ts')
for (const event of ['property.created', 'property.updated', 'property.status_changed', 'property.deleted']) {
  assert.ok(propertyService.includes(event), `missing ${event} domain event`)
}
assert.match(propertyService, /publicVisible/)

const notificationService = read('src/app/module/notification/notification.service.ts')
assert.match(notificationService, /RealtimeService\.emitNotification/)

const userService = read('src/app/module/user/user.service.ts')
assert.match(userService, /RealtimeService\.emitAuthorizationChanged/)
assert.match(userService, /team\.changed/)

const revalidation = read('src/app/module/realtime/nextRevalidation.service.ts')
assert.match(revalidation, /x-revalidate-secret/)
assert.match(revalidation, /revalidate_timeout_ms/)

const config = read('src/config/index.ts')
assert.match(config, /NEXT_REVALIDATE_SECRET/)
assert.match(config, /REALTIME_TICKET_TTL/)
assert.match(config, /REDIS_ENABLED\/REDIS_HOST is required when realtime is enabled in production/)

console.log('Phase 4 realtime architecture verification passed.')
