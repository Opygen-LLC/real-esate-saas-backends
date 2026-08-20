import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
const root=process.cwd();const read=(f:string)=>fs.readFileSync(path.join(root,f),'utf8')
const route=read('src/app/module/viewing/viewing.route.ts')
const controller=read('src/app/module/viewing/viewing.controller.ts')
const service=read('src/app/module/viewing/viewing.service.ts')
describe('Phase 9 viewings contracts',()=>{
 it('declares calendar route before id route and protects it with viewings.read',()=>{expect(route.indexOf("'/calendar'")).toBeGreaterThan(-1);expect(route.indexOf("'/calendar'")).toBeLessThan(route.indexOf("'/:id'"));expect(route).toContain("requirePermission('viewings.read')")})
 it('requires a bounded date range and tenant context',()=>{expect(controller).toContain('requireTenant(req)');expect(controller).toContain('MAX_CALENDAR_RANGE_DAYS = 62');expect(controller).toContain('startDate and endDate are required')})
 it('returns a compact chronological calendar projection',()=>{expect(service).toContain(".select('_id date startTime endTime status clientName propertyId agentId')");expect(service).toContain('paginationHelper.buildCalendarSort()');expect(service).toContain('.limit(2001)');expect(service).toContain('Too many viewings in this calendar range')})
 it('keeps the paginated table path newest first',()=>{expect(service).toContain("{ sortBy: 'createdAt', sortOrder: 'desc' }");expect(service).toContain("buildAllowedStableSort(sortBy, sortOrder, VIEWING_LIST_SORT_FIELDS, 'createdAt')")})
})
