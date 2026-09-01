import httpStatus from 'http-status'
import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { EntitlementService } from '../entitlement/entitlement.service'
import { FinanceAccountingSettings } from './financeAccountingSettings.model'
import type { AccountingActor, FinanceJournalInput } from './financeAccounting.interface'
import { FinanceJournalEntry } from './financeAccounting.model'
import { FinanceAccountingService } from './financeAccounting.service'

export interface AutomatedAccountingPostingInput extends FinanceJournalInput {
  sourceType: string
  sourceId: string
  idempotencyKey?: string
  currency?: string
}

const withSession = <T>(query: T, session?: ClientSession): T => {
  if (session && typeof (query as any)?.session === 'function') (query as any).session(session)
  return query
}

const assertAdvancedAccountingEntitlement = async (organizationId: string, session?: ClientSession) => {
  const resolved = await EntitlementService.resolve(organizationId, session, { allowInactive: true })
  if (!resolved.limits?.entitlements?.advancedAccounting?.enabled) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Advanced accounting is not enabled for this organization', '', 'ENTITLEMENT_REQUIRED', { entitlement: 'ADVANCED_ACCOUNTING', upgradeRequired: true })
  }
}

const assertPostingPermission = (actor: AccountingActor) => {
  if (actor.system) return
  if (!actor.permissions?.includes('finance.write')) throw new ApiError(httpStatus.FORBIDDEN, 'Missing permission: finance.write')
}

const postAutomatedInSession = async (organizationId: string, actor: AccountingActor, input: AutomatedAccountingPostingInput, session?: ClientSession) => {
  // System-generated postings are allowed to keep an already-initialized ledger
  // synchronized while the tenant is temporarily downgraded/read-only. User-
  // initiated advanced-accounting writes are still protected by the entitlement
  // middleware and, when this service is called directly, by this check.
  if (!actor.system) await assertAdvancedAccountingEntitlement(organizationId, session)
  assertPostingPermission(actor)
  const sourceType = String(input.sourceType || '').trim().toUpperCase()
  const sourceId = String(input.sourceId || '').trim()
  if (!sourceType || sourceType === 'MANUAL' || sourceType === 'REVERSAL' || sourceType === 'OPENING_BALANCE') throw new ApiError(httpStatus.BAD_REQUEST, 'Automated accounting source type is invalid')
  if (!sourceId) throw new ApiError(httpStatus.BAD_REQUEST, 'Automated accounting source id is required')
  const settings = await withSession(FinanceAccountingSettings.findOne({ organizationId }), session).lean()
  if (!settings) throw new ApiError(httpStatus.CONFLICT, 'Initialize accounting before posting automated entries')
  if (String(settings.activationStatus || 'ACTIVE') !== 'ACTIVE') throw new ApiError(httpStatus.CONFLICT, 'Complete the accounting initialization migration before automatic GL posting', '', 'ACCOUNTING_MIGRATION_REQUIRED')
  const currency = String(input.currency || settings.baseCurrency).toUpperCase()
  if (currency !== settings.baseCurrency) throw new ApiError(httpStatus.BAD_REQUEST, `Accounting posting currency ${currency} does not match organization base currency ${settings.baseCurrency}`, '', 'ACCOUNTING_CURRENCY_MISMATCH')
  FinanceAccountingService.validateLineAmounts(input.lines, true)

  const existing = await withSession(FinanceJournalEntry.findOne({ organizationId, sourceType, sourceId, entryRole: 'PRIMARY' }), session).lean()
  if (existing) {
    if (existing.status === 'DRAFT') return FinanceAccountingService.postJournalInternal(organizationId, actor, String(existing._id), session)
    return FinanceAccountingService.getJournal(organizationId, String(existing._id), session)
  }

  const draft = await FinanceAccountingService.createJournalDraftInternal(
    organizationId,
    actor,
    input,
    { sourceType, sourceId, idempotencyKey: input.idempotencyKey || `${sourceType}:${sourceId}`, entryRole: 'PRIMARY' },
    session,
  )
  return FinanceAccountingService.postJournalInternal(organizationId, actor, String(draft._id), session)
}

const postAutomated = async (organizationId: string, actor: AccountingActor, input: AutomatedAccountingPostingInput) => FinanceAccountingService.accountingTransaction((session) => postAutomatedInSession(organizationId, actor, input, session))

export const AccountingPostingService = { postAutomated, postAutomatedInSession }
