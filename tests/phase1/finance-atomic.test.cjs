const test = require('node:test'); const assert = require('node:assert/strict');
const { load, query, errorDependency } = require('./load-ts.cjs');

// Explicit snapshot adapter: proves service ordering/session propagation/error
// behavior. MongoDB atomicity is tested separately in the integration suite.
function harness({ failReversal = false, failAudit = false, sourceType = 'manual', status = 'paid', supported = true } = {}) {
  let state = { row: { _id: '111111111111111111111111', organizationId: 'org-a', sourceType, status,
    accountingJournalId: '222222222222222222222222', description: 'Fixture', amount: 100, type: 'expense', deletedAt: null }, journal: 'POSTED', audits: [] };
  const events = [];
  const session = { async withTransaction(fn) { const before = structuredClone(state); try { await fn(); events.push('commit'); } catch (e) { state = before; events.push('abort'); throw e; } }, async endSession() { events.push('end'); } };
  const mongoose = { isValidObjectId: () => true, Types: { ObjectId: class { constructor(value) { this.value = value; } } }, startSession: async () => session };
  const { requiredTransaction } = load('src/app/db/requiredTransaction.ts', { mongoose, '../../errors/ApiError': errorDependency,
    './mongoCapabilities': { mongoSupportsTransactions: async () => supported } });
  const User = { findOne: where => { assert.equal(where.organizationId, 'org-a'); return query({ userRole:'agency_owner',status:'active' }); } };
  const Organization = { findOne: () => query({ ownerId: 'owner', isBlocked:false }), findOneAndUpdate: (where, update, opts) => {
    assert.equal(opts.session,session); assert.equal(where.organizationId,'org-a'); return query({ownerId:'owner',isBlocked:false});
  } };
  const policy = load('src/app/module/finance/financeRemovalPolicy.ts', {
    '../../../errors/ApiError':errorDependency, '../organization/organization.model':{Organization}, '../user/user.model':{User},
    '../user/accessControl':load('src/app/module/user/accessControl.ts'),
  });
  const FinanceTransaction = { findOne: where => {
    assert.equal(where.organizationId,'org-a');
    return query(() => { const doc = structuredClone(state.row); doc.save = async options => {
      assert.equal(options.session,session); const { save, ...row } = doc; state.row = structuredClone(row); events.push('source-save');
    }; return doc; });
  } };
  const gl = { isAutomaticPostingReady: async () => false, reverseLinkedJournal: async (...args) => {
    assert.equal(args[5],session); state.journal = 'REVERSED'; events.push('reverse'); if (failReversal) throw new Error('forced reversal failure');
  }, assertLinkedJournalReversed: async (org, id, s) => {
    assert.equal(s,session); if (id && state.journal !== 'REVERSED') throw new Error('journal is not reversed');
  } };
  const deps = {
    'http-status': { NOT_FOUND:404,BAD_REQUEST:400,FORBIDDEN:403,CONFLICT:409,UNAUTHORIZED:401 }, mongoose,
    '../../../errors/ApiError': errorDependency,
    '../../helpers/paginationHelper': {}, '../../helpers/cursorPagination': {}, '../../helpers/queryPerformance': {},
    '../../db/requiredTransaction': { requiredTransaction }, './financeRemovalPolicy': policy,
    '../audit/audit.service': { writeAudit: async (input,s) => { assert.equal(s,session); state.audits.push(input); events.push('audit'); if (failAudit) throw new Error('forced audit failure'); } },
    '../domainEvent/domainEvent.service': { DomainEventService: { emit: async () => events.push('publish') } },
    '../domainEvent/transactionalOutbox.service': { TransactionalOutbox: { emit: async () => events.push('outbox'), queuePublish: async () => events.push('outbox') } },
    '../organization/organization.model': { Organization }, '../property/property.model': {Property:{}}, '../user/user.model': {User},
    '../user/userProfile.service': {}, './finance.money': load('src/app/module/finance/finance.money.ts'),
    './finance.model': {FinanceTransaction,FinanceBudget:{},FinanceCommission:{},FinanceInvoice:{},FinanceVendor:{}},
    './invoicePdf.service': {}, '../../../shared/productionEvents': { emitProductionEvent: () => undefined }, '../../shared/tenantReference.service': {},
    './financeGlIntegration.service': {FinanceGlIntegrationService:gl}, './financeOperations.model':{}, './financeBillingProfile.model':{},
    '../customerFinance/customerFinanceProjection.service': { syncBookingPaymentProjection: async () => undefined },
    '../entitlement/entitlement.service': { EntitlementService: {} }, './finance.contract': { FINANCE_ERROR_CODES: {} },
  };
  return { service:load('src/app/module/finance/finance.service.ts',deps).FinanceService, state:()=>state, events, setJournal:v=>{state.journal=v;} };
}
test('a reversal failure aborts all changes and never publishes success', async () => {
  const h=harness({failReversal:true}); await assert.rejects(h.service.voidTransaction('org-a','owner','id','Correction'), /forced reversal/);
  assert.equal(h.state().row.status,'paid'); assert.equal(h.state().journal,'POSTED'); assert.deepEqual(h.state().audits,[]);
  assert.ok(h.events.includes('reverse')); assert.ok(h.events.includes('abort')); assert.ok(!h.events.includes('publish'));
});
test('audit failure after reversal/source writes rolls the complete transaction back', async () => {
  const h=harness({failAudit:true}); await assert.rejects(h.service.voidTransaction('org-a','owner','id','Correction'), /forced audit/);
  assert.equal(h.state().row.status,'paid'); assert.equal(h.state().journal,'POSTED'); assert.deepEqual(h.state().audits,[]);
  assert.ok(h.events.indexOf('reverse') < h.events.indexOf('source-save')); assert.ok(h.events.includes('abort'));
});
test('existing journals are reversed even when optional accounting is not ready', async () => {
  const h=harness(); await h.service.voidTransaction('org-a','owner','id','Correction');
  assert.equal(h.state().row.status,'voided'); assert.equal(h.state().journal,'REVERSED'); assert.equal(h.state().audits.length,1);
  assert.ok(h.events.indexOf('commit') < h.events.indexOf('publish'));
});
test('unsupported topology performs no financial writes', async () => {
  const h=harness({supported:false}); await assert.rejects(h.service.voidTransaction('org-a','owner','id','Correction'), e=>e.code==='TRANSACTIONS_REQUIRED');
  assert.equal(h.state().row.status,'paid'); assert.deepEqual(h.events,[]);
});
test('linked transaction void fails without modifying the source or journal', async () => {
  const h=harness({sourceType:'invoice_payment'}); await assert.rejects(h.service.voidTransaction('org-a','owner','id','Correction'), e=>e.code==='FINANCE_LINKED_TRANSACTION');
  assert.equal(h.state().row.status,'paid'); assert.equal(h.state().journal,'POSTED'); assert.ok(!h.events.includes('reverse'));
});
test('service-level removal rejects ordinary write users before any transaction', async () => {
  const h=harness({status:'voided'}); await assert.rejects(h.service.deleteTransaction('org-a',{id:'owner',role:'agency_admin'},'id'), e=>e.statusCode===403);
  assert.deepEqual(h.events,[]); assert.equal(h.state().row.deletedAt,null);
});
test('owner removal rejects an unreversed linked journal even on a voided manual record', async () => {
  const h=harness({status:'voided'}); await assert.rejects(h.service.deleteTransaction('org-a',{id:'owner',role:'agency_owner'},'id'), /not reversed/);
  assert.equal(h.state().row.deletedAt,null);
});
test('owner removal hides only a voided manual record and preserves journal/history', async () => {
  const h=harness({status:'voided'}); h.setJournal('REVERSED');
  await h.service.deleteTransaction('org-a',{id:'owner',role:'agency_owner'},'id','Duplicate');
  assert.equal(h.state().row.status,'voided'); assert.ok(h.state().row.deletedAt); assert.equal(h.state().journal,'REVERSED');
  assert.equal(h.state().audits[0].action,'finance.transaction.deleted');
});
