import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { EntitlementService } from '../entitlement/entitlement.service'
import { FinanceAccountingSettings } from './financeAccountingSettings.model'
import type { AccountingActor, FinanceJournalInput } from './financeAccounting.interface'
import { FinanceAccountingService } from './financeAccounting.service'

export interface AutomatedAccountingPostingInput extends FinanceJournalInput {
  sourceType: string
  sourceId: string
  idempotencyKey?: string
  currency?: string
}

const assertAdvancedAccountingEntitlement = async (organizationId: string) => {
  const resolved = await EntitlementService.resolve(organizationId, undefined, { allowInactive: true })
  if (!resolved.limits?.entitlements?.advancedAccounting?.enabled) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Advanced accounting is not enabled for this organization', '', 'ENTITLEMENT_REQUIRED', { entitlement: 'ADVANCED_ACCOUNTING', upgradeRequired: true })
  }
}

const assertPostingPermission = (actor: AccountingActor) => {
  if (actor.system) return
  if (!actor.permissions?.includes('finance.write')) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Missing permission: finance.write')
  }
}

const postAutomated = async (organizationId: string, actor: AccountingActor, input: AutomatedAccountingPostingInput) => {
  await assertAdvancedAccountingEntitlement(organizationId)
  assertPostingPermission(actor)
  const sourceType = String(input.sourceType || '').trim().toUpperCase()
  const sourceId = String(input.sourceId || '').trim()
  if (!sourceType || sourceType === 'MANUAL' || sourceType === 'REVERSAL' || sourceType === 'OPENING_BALANCE') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Automated accounting source type is invalid')
  }
  if (!sourceId) throw new ApiError(httpStatus.BAD_REQUEST, 'Automated accounting source id is required')
  const settings = await FinanceAccountingSettings.findOne({ organizationId }).lean()
  if (!settings) throw new ApiError(httpStatus.CONFLICT, 'Initialize accounting before posting automated entries')
  const currency = String(input.currency || settings.baseCurrency).toUpperCase()
  if (currency !== settings.baseCurrency) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Accounting posting currency ${currency} does not match organization base currency ${settings.baseCurrency}`, '', 'ACCOUNTING_CURRENCY_MISMATCH')
  }
  FinanceAccountingService.validateLineAmounts(input.lines, true)
  return FinanceAccountingService.accountingTransaction(async (session) => {
    const draft = await FinanceAccountingService.createJournalDraftInternal(
      organizationId,
      actor,
      input,
      { sourceType, sourceId, idempotencyKey: input.idempotencyKey || `${sourceType}:${sourceId}`, entryRole: 'PRIMARY' },
      session,
    )
    return FinanceAccountingService.postJournalInternal(organizationId, actor, String(draft._id), session)
  })
}

export const AccountingPostingService = { postAutomated }
