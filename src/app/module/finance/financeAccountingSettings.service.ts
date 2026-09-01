import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { writeAudit } from '../audit/audit.service'
import { FinanceAccountingSettings } from './financeAccountingSettings.model'
import { FinanceAccount, FinanceFiscalYear } from './financeAccounting.model'
import { assertLegacyFinanceCurrency, FINANCE_ERROR_CODES, LEGACY_FINANCE_CURRENCY } from './finance.contract'

type Actor = { id: string; role?: string; requestId?: string; ip?: string }

const defaultSettings = (organizationId: string) => ({
  organizationId,
  baseCurrency: LEGACY_FINANCE_CURRENCY,
  accountingMethod: 'ACCRUAL' as const,
  fiscalYearStartMonth: 1,
  makerCheckerRequired: false,
  activationStatus: 'ACTIVE' as const,
  accountingStartDate: null,
  activatedAt: null,
  activatedBy: null,
  defaultAccounts: {},
  taxAccounts: {},
  initializedAt: null,
  initializedBy: null,
  updatedBy: null,
  createdAt: null,
  updatedAt: null,
})

const get = async (organizationId: string) => {
  if (!organizationId) throw new ApiError(httpStatus.FORBIDDEN, 'Tenant context required')
  return (await FinanceAccountingSettings.findOne({ organizationId }).lean()) || defaultSettings(organizationId)
}

const update = async (organizationId: string, actor: Actor, input: Record<string, any>) => {
  if (!organizationId) throw new ApiError(httpStatus.FORBIDDEN, 'Tenant context required')
  if (!actor.id) throw new ApiError(httpStatus.UNAUTHORIZED, 'Authenticated actor required')

  const before: any = await get(organizationId)
  const accountRefs = [
    ...Object.values(input.defaultAccounts || {}),
    ...Object.values(input.taxAccounts || {}),
  ].filter((value): value is string => Boolean(value))
  if (accountRefs.length) {
    const unique = [...new Set(accountRefs.map(String))]
    const owned = await FinanceAccount.countDocuments({ organizationId, _id: { $in: unique }, status: 'ACTIVE' })
    if (owned != unique.length) throw new ApiError(httpStatus.BAD_REQUEST, 'One or more default accounting accounts do not belong to this organization or are inactive')
  }

  if (input.baseCurrency !== undefined) assertLegacyFinanceCurrency(input.baseCurrency)
  // Existing tenants created by earlier Advanced Accounting phases may contain
  // a non-BDT base currency. Do not let another settings update perpetuate that
  // incompatible state; the Phase 2 reconciliation/migration tooling reports
  // and repairs it explicitly before ledger writes resume.
  if (String(before.baseCurrency || LEGACY_FINANCE_CURRENCY).toUpperCase() !== LEGACY_FINANCE_CURRENCY) {
    throw new ApiError(httpStatus.CONFLICT, 'Accounting base currency must be reconciled to BDT before settings can be changed', '', FINANCE_ERROR_CODES.currencyMismatch, {
      expectedCurrency: LEGACY_FINANCE_CURRENCY,
      actualCurrency: before.baseCurrency,
    })
  }
  if (input.fiscalYearStartMonth !== undefined && Number(input.fiscalYearStartMonth) !== Number(before.fiscalYearStartMonth || 1)) {
    if (await FinanceFiscalYear.exists({ organizationId })) {
      throw new ApiError(httpStatus.CONFLICT, 'Fiscal year start month cannot be changed after fiscal years have been initialized')
    }
  }
  const set: Record<string, unknown> = { updatedBy: actor.id }
  if (input.baseCurrency !== undefined) set.baseCurrency = assertLegacyFinanceCurrency(input.baseCurrency)
  if (input.accountingMethod !== undefined) set.accountingMethod = input.accountingMethod
  if (input.fiscalYearStartMonth !== undefined) set.fiscalYearStartMonth = input.fiscalYearStartMonth
  if (input.makerCheckerRequired !== undefined) set.makerCheckerRequired = Boolean(input.makerCheckerRequired)
  for (const [key, value] of Object.entries(input.defaultAccounts || {})) set[`defaultAccounts.${key}`] = value
  for (const [key, value] of Object.entries(input.taxAccounts || {})) set[`taxAccounts.${key}`] = value

  const after: any = await FinanceAccountingSettings.findOneAndUpdate(
    { organizationId },
    {
      $set: set,
      $setOnInsert: { organizationId },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean()

  if (!after) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to save accounting settings')

  await writeAudit({
    organizationId,
    actorId: actor.id,
    actorRole: actor.role || 'tenant',
    action: 'finance.accounting_settings_updated',
    entityType: 'financeAccountingSettings',
    entityId: String(after._id),
    reason: 'Advanced accounting settings updated',
    requestId: actor.requestId,
    ip: actor.ip,
    metadata: {
      before: {
        baseCurrency: before.baseCurrency,
        accountingMethod: before.accountingMethod,
        fiscalYearStartMonth: before.fiscalYearStartMonth,
        makerCheckerRequired: before.makerCheckerRequired,
        activationStatus: before.activationStatus,
        defaultAccounts: before.defaultAccounts,
        taxAccounts: before.taxAccounts,
      },
      after: {
        baseCurrency: after.baseCurrency,
        accountingMethod: after.accountingMethod,
        fiscalYearStartMonth: after.fiscalYearStartMonth,
        makerCheckerRequired: after.makerCheckerRequired,
        activationStatus: after.activationStatus,
        defaultAccounts: after.defaultAccounts,
        taxAccounts: after.taxAccounts,
      },
    },
  })

  return after
}

export const FinanceAccountingSettingsService = { get, update }
