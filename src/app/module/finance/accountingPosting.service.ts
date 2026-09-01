import httpStatus from 'http-status'
import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { EntitlementService } from '../entitlement/entitlement.service'
import { FinanceAccountingSettings } from './financeAccountingSettings.model'
import type { AccountingActor, FinanceJournalInput } from './financeAccounting.interface'
import { FinanceJournalEntry } from './financeAccounting.model'
import { FinanceAccountingService } from './financeAccounting.service'
import {
  assertLegacyFinanceCurrency,
  FINANCE_ERROR_CODES,
  financePostingIdentity,
  normalizeAccountingSourceId,
  normalizeAutomatedJournalSourceType,
  type FinanceAutomatedJournalSourceType,
  type LegacyFinanceCurrency,
} from './finance.contract'

export interface AutomatedAccountingPostingInput extends FinanceJournalInput {
  sourceType: FinanceAutomatedJournalSourceType
  sourceId: string
  idempotencyKey?: string
  currency?: LegacyFinanceCurrency
}

const withSession = <T>(query: T, session?: ClientSession): T => {
  if (session && typeof (query as any)?.session === 'function') (query as any).session(session)
  return query
}

const assertAdvancedAccountingEntitlement = async (organizationId: string, session?: ClientSession) => {
  const resolved = await EntitlementService.resolve(organizationId, session, { allowInactive: true })
  if (!resolved.limits?.entitlements?.advancedAccounting?.enabled) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Advanced accounting is not enabled for this organization', '', FINANCE_ERROR_CODES.entitlementRequired, { entitlement: 'ADVANCED_ACCOUNTING', upgradeRequired: true })
  }
}

const assertPostingPermission = (actor: AccountingActor) => {
  if (actor.system) return
  if (!actor.permissions?.includes('finance.write')) throw new ApiError(httpStatus.FORBIDDEN, 'Missing permission: finance.write', '', FINANCE_ERROR_CODES.permissionRequired, { requiredPermission: 'finance.write' })
}

const postAutomatedInSession = async (organizationId: string, actor: AccountingActor, input: AutomatedAccountingPostingInput, session?: ClientSession) => {
  // System-generated postings are allowed to keep an already-initialized ledger
  // synchronized while the tenant is temporarily downgraded/read-only. User-
  // initiated advanced-accounting writes are still protected by the entitlement
  // middleware and, when this service is called directly, by this check.
  if (!actor.system) await assertAdvancedAccountingEntitlement(organizationId, session)
  assertPostingPermission(actor)
  const sourceType = normalizeAutomatedJournalSourceType(input.sourceType)
  const sourceId = normalizeAccountingSourceId(input.sourceId)
  const identity = financePostingIdentity(sourceType, sourceId)
  const sourceIdentity = { sourceType: identity.sourceType, sourceId: identity.sourceId }
  const settings = await withSession(FinanceAccountingSettings.findOne({ organizationId }), session).lean()
  if (!settings) throw new ApiError(httpStatus.CONFLICT, 'Initialize accounting before posting automated entries', '', FINANCE_ERROR_CODES.notInitialized)
  if (String(settings.activationStatus || 'ACTIVE') !== 'ACTIVE') throw new ApiError(httpStatus.CONFLICT, 'Complete the accounting initialization migration before automatic GL posting', '', FINANCE_ERROR_CODES.migrationRequired)
  const ledgerCurrency = assertLegacyFinanceCurrency(settings.baseCurrency, 'Organization accounting base currency')
  const currency = assertLegacyFinanceCurrency(input.currency || ledgerCurrency, 'Accounting posting currency')
  FinanceAccountingService.validateLineAmounts(input.lines, true)

  const existing = await withSession(FinanceJournalEntry.findOne({ organizationId, ...sourceIdentity, entryRole: 'PRIMARY' }), session).lean()
  if (existing) {
    if (existing.status === 'DRAFT') return FinanceAccountingService.postJournalInternal(organizationId, actor, String(existing._id), session)
    return FinanceAccountingService.getJournal(organizationId, String(existing._id), session)
  }

  try {
    const draft = await FinanceAccountingService.createJournalDraftInternal(
      organizationId,
      actor,
      input,
      { ...sourceIdentity, idempotencyKey: input.idempotencyKey || identity.idempotencyKey, entryRole: 'PRIMARY' },
      session,
    )
    return FinanceAccountingService.postJournalInternal(organizationId, actor, String(draft._id), session)
  } catch (error) {
    // The unique tenant/source index is the final concurrency barrier. A retry
    // racing another request should resolve to the already-created posting,
    // not surface a false duplicate failure to the caller.
    if (error instanceof ApiError && error.code === FINANCE_ERROR_CODES.duplicatePosting) {
      const raced = await withSession(FinanceJournalEntry.findOne({ organizationId, ...sourceIdentity, entryRole: 'PRIMARY' }), session).lean()
      if (raced) {
        if (raced.status === 'DRAFT') return FinanceAccountingService.postJournalInternal(organizationId, actor, String(raced._id), session)
        return FinanceAccountingService.getJournal(organizationId, String(raced._id), session)
      }
    }
    throw error
  }
}

const postAutomated = async (organizationId: string, actor: AccountingActor, input: AutomatedAccountingPostingInput) => FinanceAccountingService.accountingTransaction((session) => postAutomatedInSession(organizationId, actor, input, session))

export const AccountingPostingService = { postAutomated, postAutomatedInSession }
