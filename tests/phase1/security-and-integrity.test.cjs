const test = require('node:test'); const assert = require('node:assert/strict');
const { load, query, errorDependency } = require('./load-ts.cjs');
const failCode = code => error => error.code === code;
const errors = { '../../../errors/ApiError': errorDependency };
const windowPolicy = load('src/app/module/viewing/viewingWindow.ts', errors);
const identity = load('src/app/module/viewing/viewingIdempotency.ts', errors);
const { parseTrustedProxy } = load('src/shared/trustedProxy.ts');
const basePayload = { organizationId: 'org-a', propertyId: 'abcdefabcdefabcdefabcdef', date: '2030-02-01',
  startTime: '10:00', endTime: '11:00', clientName: 'Buyer', clientPhone: '+8801712345678',
  clientEmail: 'buyer@example.test', privacyConsent: true, policyVersion: 'v1' };

for (const [label, a, b, expected] of [
  ['equal', ['10:00', '11:00'], ['10:00', '11:00'], true],
  ['contains', ['09:00', '13:00'], ['10:00', '11:00'], true],
  ['contained', ['10:00', '11:00'], ['09:00', '13:00'], true],
  ['different start', ['10:00', '11:00'], ['10:30', '11:30'], true],
  ['adjacent right', ['10:00', '11:00'], ['11:00', '12:00'], false],
  ['adjacent left', ['10:00', '11:00'], ['09:00', '10:00'], false],
]) test(`viewing intervals: ${label}`, () => assert.equal(windowPolicy.viewingWindowsOverlap(...a, ...b), expected));
for (const date of ['2030-02-30', '2030-13-01', '2030-00-10', '30-01-01']) test(`reject invalid calendar day ${date}`, () => {
  assert.throws(() => windowPolicy.assertViewingWindow(date, '10:00', '11:00'), failCode('VIEWING_INVALID_WINDOW'));
});
for (const [start, end] of [['10:00','10:00'], ['11:00','10:00'], ['9:00','10:00'], ['23:00','24:00']]) test(`reject invalid window ${start}/${end}`, () => {
  assert.throws(() => windowPolicy.assertViewingWindow('2030-02-01', start, end), failCode('VIEWING_INVALID_WINDOW'));
});
test('future validation uses Asia/Dhaka offset and allows leap days', () => {
  assert.doesNotThrow(() => windowPolicy.assertViewingWindow('2032-02-29','10:00','11:00'));
  assert.throws(() => windowPolicy.assertViewingWindow('2030-02-01','10:00','11:00', true, Date.parse('2030-02-01T04:00:00Z')), failCode('VIEWING_TIME_PAST'));
  assert.doesNotThrow(() => windowPolicy.assertViewingWindow('2030-02-01','10:00','11:00', true, Date.parse('2030-02-01T03:59:59Z')));
});
test('Rescheduled reserves availability while Cancelled/Completed do not', () => {
  for (const s of ['Scheduled','Confirmed','Rescheduled']) assert.equal(windowPolicy.isActiveViewingStatus(s), true);
  for (const s of ['Cancelled','Completed','NoShow']) assert.equal(windowPolicy.isActiveViewingStatus(s), false);
});
test('idempotency ignores tracking but binds every business field', () => {
  const first = identity.viewingRequestIdentity(basePayload, 'abcdefghijklmnop');
  const tracking = identity.viewingRequestIdentity({ ...basePayload, attribution: { utmSource: 'different' } }, 'abcdefghijklmnop');
  assert.deepEqual(tracking, first);
  for (const key of ['date','startTime','endTime','clientName','clientPhone','clientEmail','notes','policyVersion','propertyId']) {
    const changed = identity.viewingRequestIdentity({ ...basePayload, [key]: `${basePayload[key] || ''}x` }, 'abcdefghijklmnop');
    assert.equal(changed.keyDigest, first.keyDigest); assert.notEqual(changed.payloadHash, first.payloadHash, key);
  }
  assert.notEqual(identity.viewingRequestIdentity({ ...basePayload, privacyConsent: false }, 'abcdefghijklmnop').payloadHash, first.payloadHash);
});
test('idempotency keys are tenant-scoped, hashed and work for legacy clients', () => {
  const one = identity.viewingRequestIdentity(basePayload); const two = identity.viewingRequestIdentity({ ...basePayload, organizationId: 'org-b' });
  assert.deepEqual(identity.viewingRequestIdentity(basePayload), one); assert.notEqual(one.keyDigest, two.keyDigest);
  assert.match(one.keyDigest, /^[a-f0-9]{64}$/); assert.match(one.payloadHash, /^[a-f0-9]{64}$/);
  assert.equal(identity.VIEWING_RECEIPT_TTL_MS, 86400000);
});
for (const key of ['', 'short', 'a'.repeat(129), 'abcdefghijklmnop\r\nHeader: x', 'abcdefghijklmnop with spaces']) test(`invalid idempotency key ${JSON.stringify(key)}`, () => {
  assert.throws(() => identity.viewingRequestIdentity(basePayload, key), failCode('INVALID_IDEMPOTENCY_KEY'));
});
for (const value of [undefined, '', 'false', '0']) test(`proxy default ${String(value)} is untrusted`, () => assert.equal(parseTrustedProxy(value), false));
for (const value of ['true', '1', '2', '0.0.0.0/0', '::/0', '*', '192.168.0.1/33', '::1/129']) test(`reject broad/invalid proxy trust ${value}`, () => assert.throws(() => parseTrustedProxy(value)));
test('explicit proxy allowlist survives parsing', () => assert.deepEqual(parseTrustedProxy('loopback,10.20.0.0/24,::1'), ['loopback','10.20.0.0/24','::1']));

function policyHarness(user = { userRole: 'agency_owner', status: 'active' }, organization = { ownerId: 'owner', isBlocked: false }) {
  const events = []; const User = { findOne: where => { events.push(['userScope', where]); return query(user, events, 'userSession'); } };
  const Organization = { findOne: where => { events.push(['orgScope', where]); return query(organization, events, 'orgSession'); },
    findOneAndUpdate: (where, update, opts) => { events.push(['ownerWriteLock', where, update, opts]); return query(organization); } };
  const access = load('src/app/module/user/accessControl.ts');
  const policy = load('src/app/module/finance/financeRemovalPolicy.ts', { ...errors,
    '../organization/organization.model': { Organization }, '../user/user.model': { User }, '../user/accessControl': access });
  return { policy, events };
}
for (const role of ['agency_admin','agent','super-admin',undefined,'agency-owner']) test(`removal rejects role ${String(role)}`, () => {
  assert.throws(() => policyHarness().policy.assertRemovalActor({ id: 'owner', role }), failCode('FINANCE_REMOVAL_FORBIDDEN'));
});
test('owner is verified from current scoped records, not just the role in the request', async () => {
  const { policy, events } = policyHarness(); const session = { tx: true };
  await policy.assertFinanceRemovalOwner('org-a', { id: 'owner', role: 'agency_owner' }, session);
  assert.ok(events.some(e => e[0] === 'userScope' && e[1].organizationId === 'org-a'));
  assert.ok(events.some(e => e[0] === 'userSession' && e[1] === session));
});
for (const [label, user, org] of [
  ['missing user', null, { ownerId:'owner' }], ['inactive user', { userRole:'agency_owner',status:'inactive' }, { ownerId:'owner' }],
  ['stale role', { userRole:'agency_admin',status:'active' }, { ownerId:'owner' }],
  ['ownership transferred', { userRole:'agency_owner',status:'active' }, { ownerId:'new-owner' }],
  ['blocked agency', { userRole:'agency_owner',status:'active' }, { ownerId:'owner',isBlocked:true }],
]) test(`owner verification rejects ${label}`, async () => assert.rejects(policyHarness(user, org).policy.assertFinanceRemovalOwner('org-a', { id:'owner',role:'agency_owner' }), failCode('FINANCE_REMOVAL_FORBIDDEN')));
for (const sourceType of ['invoice_payment','commission_payout','property_investment_contribution','property_investor_distribution']) test(`linked transaction ${sourceType} cannot be voided or removed generically`, () => {
  const { policy } = policyHarness(); assert.throws(() => policy.assertManualTransaction({ sourceType }), failCode('FINANCE_LINKED_TRANSACTION'));
  assert.throws(() => policy.assertTransactionRemovable({ sourceType, status:'voided' }), failCode('FINANCE_LINKED_TRANSACTION'));
});
test('manual removal requires void; invoice history and commission payouts prevent removal', () => {
  const { policy } = policyHarness();
  for (const status of ['paid','pending','cancelled']) assert.throws(() => policy.assertTransactionRemovable({ sourceType:'manual',status }), failCode('FINANCE_VOID_REQUIRED'));
  assert.doesNotThrow(() => policy.assertTransactionRemovable({ sourceType:'manual',status:'voided' }));
  for (const status of ['draft','cancelled']) assert.doesNotThrow(() => policy.assertInvoiceRemovable({status,paidAmount:0,payments:[]}));
  for (const value of [{status:'paid',paidAmount:0},{status:'cancelled',paidAmount:1},{status:'draft',payments:[{}]}]) assert.throws(() => policy.assertInvoiceRemovable(value));
  assert.doesNotThrow(() => policy.assertCommissionRemovable({status:'cancelled'}));
  for (const value of [{status:'pending'},{status:'cancelled',paidAt:new Date()},{status:'cancelled',payoutTransactionId:'id'},{status:'cancelled',payoutJournalId:'id'}]) assert.throws(() => policy.assertCommissionRemovable(value));
});

function transactionHarness(supported = true, retry = false) {
  const events = []; let commits = 0;
  const session = { async withTransaction(fn, options) { events.push(['options', options]);
    if (retry) { await fn(); events.push(['retry']); }
    await fn(); commits += 1;
  }, async endSession() { events.push(['end']); } };
  const { requiredTransaction } = load('src/app/db/requiredTransaction.ts', {
    mongoose: { startSession: async () => { events.push(['start']); return session; } }, '../../errors/ApiError': errorDependency,
    './mongoCapabilities': { mongoSupportsTransactions: async () => supported },
  });
  return { requiredTransaction, session, events, commits: () => commits };
}
test('standalone/unavailable Mongo fails closed before the first write', async () => {
  const h = transactionHarness(false); let called = false;
  await assert.rejects(h.requiredTransaction(async () => { called = true; return 1; }), failCode('TRANSACTIONS_REQUIRED'));
  assert.equal(called, false); assert.deepEqual(h.events, []);
});
test('transaction uses majority/snapshot and ends session after success', async () => {
  const h = transactionHarness(); const result = await h.requiredTransaction(async s => { assert.equal(s,h.session); return {ok:true}; });
  assert.deepEqual(result, {ok:true}); assert.equal(h.commits(),1);
  assert.deepEqual(h.events[1][1].readConcern,{level:'snapshot'}); assert.deepEqual(h.events[1][1].writeConcern,{w:'majority'});
  assert.equal(h.events.at(-1)[0],'end');
});
test('errors are propagated, not converted into success or an optional write', async () => {
  const h = transactionHarness(); const failure = new Error('journal reversal failed');
  await assert.rejects(h.requiredTransaction(async () => { throw failure; }), e => e === failure);
  assert.equal(h.commits(),0); assert.equal(h.events.at(-1)[0],'end');
});
test('callback retry returns only the successful attempt value', async () => {
  const h = transactionHarness(true,true); let attempts=0;
  assert.equal(await h.requiredTransaction(async () => ++attempts), 2); assert.equal(h.commits(),1);
});
test('undefined callback result aborts instead of committing ambiguous success', async () => {
  const h=transactionHarness(); await assert.rejects(h.requiredTransaction(async () => undefined), failCode('TRANSACTION_INCOMPLETE')); assert.equal(h.commits(),0);
});
