import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { writeAudit } from '../audit/audit.service'
import { FinanceAccountingSettings } from './financeAccountingSettings.model'

type Actor = { id: string; role?: string; requestId?: string; ip?: string }

const defaultSettings = (organizationId: string) => ({
  organizationId,
  baseCurrency: 'BDT',
  accountingMethod: 'ACCRUAL' as const,
  fiscalYearStartMonth: 1,
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
  const now = new Date()
  const set: Record<string, unknown> = { updatedBy: actor.id }
  if (input.baseCurrency !== undefined) set.baseCurrency = String(input.baseCurrency).toUpperCase()
  if (input.accountingMethod !== undefined) set.accountingMethod = input.accountingMethod
  if (input.fiscalYearStartMonth !== undefined) set.fiscalYearStartMonth = input.fiscalYearStartMonth
  for (const [key, value] of Object.entries(input.defaultAccounts || {})) set[`defaultAccounts.${key}`] = value
  for (const [key, value] of Object.entries(input.taxAccounts || {})) set[`taxAccounts.${key}`] = value

  const after: any = await FinanceAccountingSettings.findOneAndUpdate(
    { organizationId },
    {
      $set: set,
      $setOnInsert: {
        organizationId,
        initializedAt: now,
        initializedBy: actor.id,
      },
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
        defaultAccounts: before.defaultAccounts,
        taxAccounts: before.taxAccounts,
      },
      after: {
        baseCurrency: after.baseCurrency,
        accountingMethod: after.accountingMethod,
        fiscalYearStartMonth: after.fiscalYearStartMonth,
        defaultAccounts: after.defaultAccounts,
        taxAccounts: after.taxAccounts,
      },
    },
  })

  return after
}

export const FinanceAccountingSettingsService = { get, update }
