import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { Contact } from '../../app/module/contact/contact.model'


describe('CRM Phase 9 Contact relationship contract', () => {
  it('indexes relationship, assignee, conversion status and conversion time for Contact filters', () => {
    const indexes = Contact.schema.indexes().map(([keys, options]) => ({ keys, options }))
    expect(indexes.some(({ keys, options }) =>
      JSON.stringify(keys) === JSON.stringify({ organizationId: 1, relationshipState: 1, assignedTo: 1, convertedAt: -1 }) &&
      options?.name === 'contact_tenant_relationship_assignee_converted',
    )).toBe(true)
    expect(indexes.some(({ keys, options }) =>
      JSON.stringify(keys) === JSON.stringify({ organizationId: 1, relationshipState: 1, statusAtConversion: 1, convertedAt: -1 }) &&
      options?.name === 'contact_tenant_relationship_status_converted',
    )).toBe(true)
  })

  it('keeps latest interaction projection batched instead of querying Activity per Contact row', () => {
    const service = fs.readFileSync(path.resolve(process.cwd(), 'src/app/module/contact/contact.service.ts'), 'utf8')
    expect(service).toContain('latestInteractionProjection')
    expect(service).toContain('Activity.find({')
    expect(service).toContain('leadToContact')
    expect(service).toContain('latestInteraction: latestByContact.get')
  })

  it('ships an explicit production index migration for autoIndex-disabled deployments', () => {
    const migration = fs.readFileSync(path.resolve(process.cwd(), 'src/app/db/migrateCrmContactRelationships.ts'), 'utf8')
    expect(migration).toContain('contact_tenant_relationship_assignee_converted')
    expect(migration).toContain('contact_tenant_relationship_status_converted')
    expect(migration).toContain('activity_tenant_contact_created')
  })
})
