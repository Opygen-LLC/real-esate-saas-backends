const test = require('node:test'); const assert = require('node:assert/strict');
const { load } = require('./load-typescript.cjs');
const query = load('src/contracts/websiteCatalog/query.ts');
const values = load('src/contracts/websiteCatalog/values.ts');
const content = load('src/contracts/websiteCatalog/content.ts');
const manifest = load('src/contracts/websiteCatalog/manifest.ts');
const { toPublicProperty } = load('src/app/module/property/publicProperty.serializer.ts');
const { parsePublicPropertySelection } = load('src/contracts/websiteCatalog/publicProperty.ts');
const { buildCatalogPlan } = load('src/app/module/property/propertyCatalog.pipeline.ts');

test('legacy filters decode, normalize and round-trip without losing zero or false', () => {
  const parsed = query.parsePublicPropertyQuery(new URLSearchParams('type=Apartment&location=Dhaka&listingType=rent&minPrice=0&furnished=false&page=3&sortBy=price&sortOrder=asc'));
  assert.deepEqual(parsed.issues, []); assert.equal(parsed.query.propertyType, 'Apartment'); assert.equal(parsed.query.city, 'Dhaka');
  assert.equal(parsed.query.minPrice, 0); assert.equal(parsed.query.furnished, false); assert.equal(parsed.query.listingType, 'ForRent');
  const encoded = query.serializePublicPropertyQuery(parsed.query);
  assert(!encoded.includes('type=')); assert.deepEqual(query.parsePublicPropertyQuery(new URLSearchParams(encoded)).query, parsed.query);
});
test('canonical field wins over legacy alias and legacy styles remain searchable', () => {
  assert.equal(query.parsePublicPropertyQuery({ type: 'Commercial', propertyType: 'Apartment' }).query.propertyType, 'Apartment');
  assert.equal(query.parsePublicPropertyQuery({ type: 'Penthouse', searchTerm: 'Gulshan' }).query.searchTerm, 'Gulshan Penthouse');
});
for (const [name, input] of Object.entries({ duplicates: new URLSearchParams('city=Dhaka&city=Sylhet'), injection: { propertyType: { $ne: null } }, enum: { status: 'Draft' }, range: { minPrice: 10, maxPrice: 5 }, infinity: { maxArea: 'Infinity' }, negative: { bedrooms: -1 }, fraction: { bedrooms: 1.5 }, tooLarge: { limit: 101 }, date: { availableBy: '2026-02-30' }, invalidSort: { sortBy: 'organizationId' }, cursorSort: { cursor: 'x', sortBy: 'price' } })) {
  test(`query rejects ${name} rather than broadening results`, () => assert(query.parsePublicPropertyQuery(input).issues.length));
}
test('public discounts are only valid positive lower values and respect both privacy flags', () => {
  const property = { price: 1000, discountedPrice: 600, isDiscount: true };
  assert.equal(values.effectivePropertyPrice(property), 600);
  assert.equal(values.effectivePropertyPrice({ ...property, hiddenPublicFields: ['price'] }), null);
  assert.equal(values.effectivePropertyPrice({ ...property, hiddenPublicFields: ['discount'] }), 1000);
  for (const discountedPrice of [0, -1, NaN, Infinity, 1000, 1001]) assert.equal(values.effectivePropertyPrice({ ...property, discountedPrice }), 1000);
  for (const price of [undefined, 0, -1, NaN, Infinity]) assert.equal(values.effectivePropertyPrice({ price }), null);
  assert.equal(values.effectivePropertyPrice({ ...property, hiddenPublicFields: ['price'] }, false), 600);
});
test('annual rent wins over category and units share explicit regional conversion', () => {
  assert.equal(values.propertyPricePeriod({ listingType: 'ForRent', pricing: { mode: 'YEARLY' } }), 'year');
  assert.equal(values.propertyPricePeriod({ listingType: 'ForRent' }), 'month');
  assert.equal(values.propertyPricePeriod({ listingType: 'ForSale' }), null);
  assert.equal(values.convertCatalogArea(2, 'katha', 'sqft'), 1440);
  assert.equal(values.convertCatalogArea(1, 'bigha', 'sqft', { kathaSqft: 800, bighaKatha: 16 }), 12800);
  assert.throws(() => values.convertCatalogArea(1, 'unknown', 'sqft'));
  assert.throws(() => values.areaFactors({ kathaSqft: 0 }));
});
test('pipeline filters and stable sorts before pagination; count uses identical computed predicates', () => {
  const plan = buildCatalogPlan({ baseWhere: { organizationId: 'a' }, filters: { minPrice: '500', maxPrice: '700', minArea: '1', areaUnit: 'katha' }, sortBy: 'price', sortOrder: 'asc', skip: 20, limit: 20, publicView: true });
  const sorts = plan.data.findIndex(s => s.$sort); const skip = plan.data.findIndex(s => s.$skip); const limit = plan.data.findIndex(s => s.$limit);
  assert(sorts > 0 && sorts < skip && skip < limit); assert.deepEqual(plan.data[sorts].$sort, { __catalogMissing: 1, __catalogPrice: 1, _id: 1 });
  assert.deepEqual(plan.data[2].$match.__catalogPrice, { $ne: null, $gte: 500, $lte: 700 });
  assert.equal(plan.data[2].$match.__catalogArea.$gte, 720);
  assert.deepEqual(plan.count.slice(0, -1), plan.data.slice(0, 3));
  assert.throws(() => buildCatalogPlan({ baseWhere: {}, filters: { minArea: 10, maxArea: 2 }, sortBy: 'area', sortOrder: 'desc', skip: 0, limit: 20 }));
});
test('public DTO whitelists nested fields and physically omits private/hidden data', () => {
  const dto = toPublicProperty({ _id: { toHexString: () => 'a'.repeat(24) }, organizationId: 'tenant', title: 'Home', propertyType: 'Apartment', listingType: 'ForRent', price: 120, isDiscount: true, discountedPrice: 100, pricing: { mode: 'YEARLY', internalCommission: 50 }, hiddenPublicFields: ['address', 'agent'], address: 'secret', agentId: { email: 'private' }, ownerId: 'private', images: [{ url: '/image.jpg', storageKey: 'private' }], mediaLinks: [{ url: 'https://example.com', secret: true }], createdAt: new Date('2026-01-01T00:00:00Z') });
  assert.equal(dto.effectivePrice, 100); assert.equal(dto.pricePeriod, 'year'); assert.equal(typeof dto._id, 'string'); assert.equal(typeof dto.createdAt, 'string');
  for (const field of ['ownerId', 'address', 'agentId', 'hiddenPublicFields']) assert(!(field in dto));
  assert(!('storageKey' in dto.images[0])); assert(!('secret' in dto.mediaLinks[0])); assert(!('internalCommission' in dto.pricing));
  const hidden = toPublicProperty({ price: 120, isDiscount: true, discountedPrice: 100, hiddenPublicFields: ['price'] });
  assert.equal(hidden.effectivePrice, null); assert.equal(hidden.priceStatus, 'on_request'); assert(!('price' in hidden)); assert(!('discountedPrice' in hidden));
});
test('template migration preserves explicit blanks/false/empty collections and legacy unknown tenant content', () => {
  const stored = { home: { heroTitle: '', showAgents: false, features: [], featuredPropertyIds: [], customLegacy: 'keep' }, about: { stats: [], showStats: false } };
  for (const item of manifest.WEBSITE_TEMPLATE_MANIFESTS) {
    const migrated = content.migrateWebsiteContent({ content: stored, heroTitle: 'legacy top level' }, manifest.getTemplateContentDefaults(item.id));
    assert.equal(migrated.content.home.heroTitle, ''); assert.equal(migrated.content.home.showAgents, false);
    assert.deepEqual(migrated.content.home.features, []); assert.equal(migrated.content.home.customLegacy, 'keep');
    assert.deepEqual(content.migrateWebsiteContent(migrated).content, migrated.content);
  }
  assert.equal(stored.home.customLegacy, 'keep');
  assert.throws(() => content.migrateWebsiteContent({ contentSchemaVersion: 999 }));
});
test('content patches merge individual fields, replace collections deliberately and reject unsafe input', () => {
  const before = { home: { heroTitle: 'Owner title', heroSubtitle: 'Keep', features: [{ title: 'A', description: 'B' }] } };
  const patch = { home: { heroTitle: '', features: [] } };
  assert.deepEqual(content.validateWebsiteContentPatch(patch), []);
  const after = content.mergeWebsiteContentPatch(before, patch); assert.equal(after.home.heroSubtitle, 'Keep'); assert.deepEqual(after.home.features, []); assert.equal(before.home.heroTitle, 'Owner title');
  for (const value of ['javascript:alert(1)', '//example.com', 'https://user:pass@example.com', '/\\evil']) assert(content.validateWebsiteContentPatch({ home: { heroButtonLink: value } }).length);
  assert(content.validateWebsiteContentPatch(JSON.parse('{"__proto__":{"polluted":true}}')).length);
  assert(content.validateWebsiteContentPatch({ home: { price: 500 } }).length);
  assert.deepEqual(content.validateWebsiteContentPatch({ home: { heroButtonLink: '/properties?type=Apartment' } }), []);
});
test('all ten manifests declare only known fields, valid defaults and the same schema/revision authority', () => {
  assert.equal(manifest.WEBSITE_TEMPLATE_MANIFESTS.length, 10);
  for (const item of manifest.WEBSITE_TEMPLATE_MANIFESTS) {
    assert.equal(item.manifestVersion, manifest.WEBSITE_MANIFEST_VERSION); assert.equal(item.supportedPages.length, 7);
    for (const field of item.contentFields) { const [page, key] = field.split('.'); assert(content.WEBSITE_CONTENT_FIELDS[page][key], field); }
    for (const image of item.imageSlots) assert(item.contentFields.includes(image));
    assert.deepEqual(content.validateWebsiteContentPatch(manifest.getTemplateContentDefaults(item.id)), []);
  }
  for (const invalid of [-1, 0.2, Infinity, '1']) assert.equal(manifest.isPublicationRevision(invalid), false);
  assert.equal(manifest.isPublicationRevision(0), true);
});
test('curated property selections are bounded, unique and normalized', () => {
  assert.deepEqual(parsePublicPropertySelection('A'.repeat(24)), ['a'.repeat(24)]);
  assert.deepEqual(parsePublicPropertySelection(''), []);
  for (const input of [[], 'x', 'a'.repeat(24) + ',' + 'a'.repeat(24), Array.from({ length: 26 }, (_, i) => i.toString(16).padStart(24, '0')).join(',')]) assert.throws(() => parsePublicPropertySelection(input));
});
