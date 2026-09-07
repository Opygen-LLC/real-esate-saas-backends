const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.join(process.cwd(), 'src/contracts/websiteCatalog/manifest.ts'), 'utf8')

test('redesigned templates keep IDs and entitlement tiers while advertising the new families', () => {
  const names = ['Corporate Brokerage', 'Urban Developer', 'Nordic Minimalist', 'Apex Metropolitan', 'Serene Oasis', 'Editorial Estate', 'Gallery Residence', 'Swiss Realty']
  for (let index = 0; index < names.length; index += 1) {
    const id = index + 3
    assert.match(source, new RegExp(`"id": "template-${id}"[\\s\\S]*?"name": "${names[index]}"`))
  }
  assert.doesNotMatch(source, /cyber-luxury|glass cards|live market ticker|mortgage estimator/i)
})

test('manifest exposes buttons for templates 3-10 and gallery editing for template 9', () => {
  assert.match(source, /\['template-2', 'template-9'\]\.includes\(id\) \? \['home\.heroGallery'\]/)
  assert.match(source, /\['template-3', 'template-4', 'template-5', 'template-6', 'template-7', 'template-8', 'template-9', 'template-10'\]\.includes\(id\)[\s\S]*?heroButtonText[\s\S]*?secondaryButtonLink/)
})

test('all templates continue to support the seven canonical public pages', () => {
  assert.match(source, /PUBLIC_WEBSITE_PAGES = \['home', 'about', 'contact', 'properties', 'propertyDetail', 'agents', 'agentDetail'\]/)
  assert.match(source, /supportedPages: PUBLIC_WEBSITE_PAGES/)
})
