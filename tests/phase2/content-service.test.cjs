const test = require('node:test'); const assert = require('node:assert/strict');
const { createLoader } = require('./load-typescript.cjs');
let calls = []; let count = 0;
const load = createLoader(undefined, { '../property/property.model': { Property: { countDocuments: where => { calls.push(where); return { maxTimeMS: async milliseconds => { assert.equal(milliseconds, 10000); return count; } }; } } } });
const { assertContentPropertyReferences, mergeAndMigrateContent } = load('src/app/module/websiteBuilder/websiteContent.service.ts');
const A = 'a'.repeat(24), B = 'b'.repeat(24);
test('new content references are bounded to the current tenant and public unlocked records', async () => {
  calls=[]; count=1;
  await assertContentPropertyReferences('tenant-A', { home: { heroPropertyId: A, featuredPropertyIds: [A] } });
  assert.equal(calls.length,1); assert.equal(calls[0].organizationId,'tenant-A');
  assert.deepEqual(calls[0]._id.$in,[A]); assert.deepEqual(calls[0].status.$in,['Available','UnderOffer']); assert.deepEqual(calls[0].quotaLocked,{$ne:true});
});
test('missing or foreign new references fail before any content write', async () => {
  calls=[]; count=0;
  await assert.rejects(assertContentPropertyReferences('tenant-A',{ home:{ featuredPropertyIds:[B] } }), /belonging to this agency/);
});
test('stored archived references survive unrelated edits without becoming stale copied facts', async () => {
  calls=[]; count=0;
  await assertContentPropertyReferences('tenant-A',{ home:{heroPropertyId:A,featuredPropertyIds:[B]} },{home:{heroPropertyId:A,featuredPropertyIds:[B]}});
  assert.equal(calls.length,0);
});
test('content patch migration is immutable and preserves all non-edited fields across every template', () => {
  const current={contentSchemaVersion:0,content:{home:{heroTitle:'Tenant title',heroSubtitle:'',showAgents:false,features:[],heroImage:'https://example.test/tenant.jpg'},about:{storyBody:'Tenant story'},legacyPage:{kept:true}}};
  const snapshot=structuredClone(current);
  for(let id=1;id<=10;id++){
    const result=mergeAndMigrateContent(current,{home:{featuredTitle:'New heading'}},`template-${id}`);
    assert.equal(result.content.home.heroTitle,'Tenant title'); assert.equal(result.content.home.heroSubtitle,''); assert.equal(result.content.home.showAgents,false);
    assert.deepEqual(result.content.home.features,[]); assert.equal(result.content.about.storyBody,'Tenant story'); assert.equal(result.content.home.featuredTitle,'New heading');
    assert.equal(result.content.legacyPage.kept,true); assert.equal(result.contentSchemaVersion,2);
  }
  assert.deepEqual(current,snapshot);
});
test('future versions and copied property facts are rejected rather than overwritten', () => {
  assert.throws(()=>mergeAndMigrateContent({contentSchemaVersion:99},undefined,'template-1'), /newer|unsupported/i);
  assert.throws(()=>mergeAndMigrateContent({}, {home:{price:10}},'template-1'), /Invalid website content/);
  assert.throws(()=>mergeAndMigrateContent({}, {home:{heroButtonLink:'javascript:alert(1)'}},'template-1'), /Invalid website content/);
});
