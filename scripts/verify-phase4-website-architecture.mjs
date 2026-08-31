import fs from 'node:fs'
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const requireText = (p, checks) => { const s=read(p); for (const [label, re] of checks) if (!re.test(s)) throw new Error(`${p}: missing ${label}`) }
requireText('src/app/module/websiteBuilder/websiteArchitecture.contract.ts', [
  ['render modes', /WEBSITE_RENDER_MODES.*template.*builder/s], ['canonical contract', /CanonicalWebsiteContract/], ['section keys', /WEBSITE_SECTION_KEYS/],
])
requireText('src/app/module/websiteBuilder/websitePublication.service.ts', [['revision increment', /publicationRevision[^\n]*1|\$inc:\s*\{\s*'websiteSettings\.publicationRevision':\s*1/s], ['tenant cache invalidation', /invalidateTenant\(organizationId\)/]])
requireText('src/app/module/organization/organization.service.ts', [['shared website publication pipeline', /WebsitePublicationService\.commitPublicationState[\s\S]*renderMode,/]])
requireText('src/app/module/websiteBuilder/websiteBuilder.service.ts', [
  ['builder publication pipeline', /commitPublicationState\(\{\s*organizationId,\s*renderMode:\s*'builder'/],
  ['validated restore', /restoreRevision[\s\S]*prepareBuilderDocument\(revision\.document\)[\s\S]*assertEntitlement/],
  ['revision schema version', /schemaVersion:\s*Number\(document\.schemaVersion/],
])
const registry=read('src/app/module/websiteBuilder/templateRegistry.ts')
for (let i=1;i<=10;i++) if (!new RegExp(`id: 'template-${i}'[\\s\\S]{0,1200}?advancedBuilder: true`).test(registry)) throw new Error(`template-${i} is not explicitly Advanced Builder supported`)
requireText('src/app/helpers/sanitize.ts', [['custom css sanitizer', /sanitizeCustomCss/], ['fixed positioning blocked', /fixed or sticky positioning/], ['selector blocks rejected', /disallowed construct/]])
requireText('src/app/db/reconcileWebsiteArchitecturePhase4.ts', [['read-only default', /mode=.*DRY-RUN|DRY-RUN/], ['manual review gate', /Refusing apply while/], ['tenant relations', /collectTenantRelationFindings/], ['builder revisions', /websiterevisions/], ['section styles', /WEBSITE_SECTION_KEYS/]])
console.log('Phase 4 website architecture invariants: PASS')
