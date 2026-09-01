import mongoose, { Types } from 'mongoose'
import config from '../../config'
import { Organization } from '../module/organization/organization.model'
import { SubscriptionPlan } from '../module/subscriptionPlan/subscriptionPlan.model'
import { PlatformSettings } from '../module/platformSettings/platformSettings.model'
import { User } from '../module/user/user.model'
import { UserProfile } from '../module/userProfile/userProfile.model'
import { effectivePermissionsForUser } from '../module/user/accessControl'
import {
  FinanceTransaction,
  FinanceInvoice,
  FinanceCommission,
  FinanceVendor,
  FinanceBudget,
} from '../module/finance/finance.model'
import { FinanceAccountingSettings } from '../module/finance/financeAccountingSettings.model'
import {
  FinanceAccount,
  FinanceFiscalYear,
  FinanceFiscalPeriod,
  FinanceJournalEntry,
  FinanceJournalLine,
  FinanceCategoryAccountMapping,
} from '../module/finance/financeAccounting.model'
import { FinanceAccountingInitialization, FinanceLegacyPaymentMethodMapping } from '../module/finance/financeInitialization.model'
import { FinanceBankAccount } from '../module/finance/financeOperations.model'
import { FinanceShareholder } from '../module/finance/financeCapital.model'

type Severity = 'critical' | 'warning' | 'info'
type Finding = { code: string; severity: Severity; message: string; count?: number; details?: Record<string, unknown> }

const staleMinutes = Math.max(5, Number(process.env.FINANCE_AUDIT_ACTIVATING_STALE_MINUTES || 30))
const scopedOrganization = process.argv.find((arg) => arg.startsWith('--organization='))?.split('=', 2)[1]?.trim()
const failOnFindings = process.argv.includes('--fail-on-findings')

const oid = (value: unknown) => value ? String(value) : ''
const listIndexes = async (model: any): Promise<Set<string>> => {
  try {
    const indexes = await model.collection.listIndexes().toArray()
    return new Set(indexes.map((item: any) => String(item.name)))
  } catch (error: any) {
    if (String(error?.codeName || '') === 'NamespaceNotFound' || Number(error?.code) === 26) return new Set()
    throw error
  }
}

const migrationReadiness = async () => {
  const [settings, accounts, journals, mappings, banks, shareholders, initialization, paymentMappings] = await Promise.all([
    listIndexes(FinanceAccountingSettings), listIndexes(FinanceAccount), listIndexes(FinanceJournalEntry),
    listIndexes(FinanceCategoryAccountMapping), listIndexes(FinanceBankAccount), listIndexes(FinanceShareholder),
    listIndexes(FinanceAccountingInitialization), listIndexes(FinanceLegacyPaymentMethodMapping),
  ])
  const phases = [
    { phase: 'advanced-accounting-phase1', applied: settings.has('finance_accounting_settings_tenant_unique') },
    { phase: 'advanced-accounting-phase2', applied: accounts.has('finance_account_tenant_code_unique') && journals.has('finance_journal_tenant_source_primary_unique') },
    { phase: 'advanced-accounting-phase3', applied: mappings.has('finance_category_mapping_tenant_type_category_unique') },
    { phase: 'advanced-accounting-phase4', applied: banks.has('finance_bank_account_tenant_gl_unique') },
    { phase: 'advanced-accounting-phase5', applied: shareholders.has('finance_shareholder_tenant_status_name') },
    { phase: 'advanced-accounting-phase7', applied: initialization.has('finance_accounting_initialization_tenant_unique') && paymentMappings.has('finance_legacy_payment_mapping_tenant_method_unique') },
  ]
  return phases
}

const resolveAdvancedAccountingEntitlement = async (org: any, trialPolicy: any): Promise<{ enabled: boolean; source: string }> => {
  const planId = String(org?.subscription?.plan || 'trial')
  if (planId === 'trial') {
    const enabled = Boolean(trialPolicy?.entitlements?.advancedAccounting?.enabled ?? trialPolicy?.hasAdvancedAccounting ?? false)
    return { enabled, source: 'platform-trial-policy' }
  }
  const version = Number(org?.subscription?.planVersion || 0)
  const plan = await SubscriptionPlan.findOne(version > 0 ? { planId, version } : { planId, isCurrent: true })
    .select('planId version entitlements hasAdvancedAccounting status isCurrent')
    .lean() as any
  return {
    enabled: Boolean(plan?.entitlements?.advancedAccounting?.enabled ?? plan?.hasAdvancedAccounting ?? false),
    source: plan ? `${plan.planId}@${plan.version}` : `missing-plan:${planId}@${version || 'current'}`,
  }
}

const relationalIntegrityFor = async (organizationId: string) => {
  const accountCollection = FinanceAccount.collection.name
  const journalCollection = FinanceJournalEntry.collection.name
  const bankCollection = FinanceBankAccount.collection.name

  const lineRows = await FinanceJournalLine.aggregate([
    { $match: { organizationId } },
    { $lookup: { from: accountCollection, localField: 'accountId', foreignField: '_id', as: 'account' } },
    { $lookup: { from: journalCollection, localField: 'journalEntryId', foreignField: '_id', as: 'journal' } },
    { $project: {
      accountMissing: { $eq: [{ $size: '$account' }, 0] },
      journalMissing: { $eq: [{ $size: '$journal' }, 0] },
      accountCrossTenant: { $and: [{ $gt: [{ $size: '$account' }, 0] }, { $ne: [{ $arrayElemAt: ['$account.organizationId', 0] }, organizationId] }] },
      journalCrossTenant: { $and: [{ $gt: [{ $size: '$journal' }, 0] }, { $ne: [{ $arrayElemAt: ['$journal.organizationId', 0] }, organizationId] }] },
    } },
    { $group: { _id: null, accountMissing: { $sum: { $cond: ['$accountMissing', 1, 0] } }, journalMissing: { $sum: { $cond: ['$journalMissing', 1, 0] } }, accountCrossTenant: { $sum: { $cond: ['$accountCrossTenant', 1, 0] } }, journalCrossTenant: { $sum: { $cond: ['$journalCrossTenant', 1, 0] } } } },
  ])

  const categoryRows = await FinanceCategoryAccountMapping.aggregate([
    { $match: { organizationId } },
    { $lookup: { from: accountCollection, localField: 'accountId', foreignField: '_id', as: 'target' } },
    { $project: { missing: { $eq: [{ $size: '$target' }, 0] }, crossTenant: { $and: [{ $gt: [{ $size: '$target' }, 0] }, { $ne: [{ $arrayElemAt: ['$target.organizationId', 0] }, organizationId] }] } } },
    { $group: { _id: null, missing: { $sum: { $cond: ['$missing', 1, 0] } }, crossTenant: { $sum: { $cond: ['$crossTenant', 1, 0] } } } },
  ])

  const bankRows = await FinanceBankAccount.aggregate([
    { $match: { organizationId } },
    { $lookup: { from: accountCollection, localField: 'glAccountId', foreignField: '_id', as: 'target' } },
    { $project: { missing: { $eq: [{ $size: '$target' }, 0] }, crossTenant: { $and: [{ $gt: [{ $size: '$target' }, 0] }, { $ne: [{ $arrayElemAt: ['$target.organizationId', 0] }, organizationId] }] } } },
    { $group: { _id: null, missing: { $sum: { $cond: ['$missing', 1, 0] } }, crossTenant: { $sum: { $cond: ['$crossTenant', 1, 0] } } } },
  ])

  const paymentRows = await FinanceLegacyPaymentMethodMapping.aggregate([
    { $match: { organizationId } },
    { $lookup: { from: bankCollection, localField: 'bankAccountId', foreignField: '_id', as: 'target' } },
    { $project: { missing: { $eq: [{ $size: '$target' }, 0] }, crossTenant: { $and: [{ $gt: [{ $size: '$target' }, 0] }, { $ne: [{ $arrayElemAt: ['$target.organizationId', 0] }, organizationId] }] } } },
    { $group: { _id: null, missing: { $sum: { $cond: ['$missing', 1, 0] } }, crossTenant: { $sum: { $cond: ['$crossTenant', 1, 0] } } } },
  ])

  return {
    journalLines: lineRows[0] || { accountMissing: 0, journalMissing: 0, accountCrossTenant: 0, journalCrossTenant: 0 },
    categoryMappings: categoryRows[0] || { missing: 0, crossTenant: 0 },
    bankGlMappings: bankRows[0] || { missing: 0, crossTenant: 0 },
    paymentMethodMappings: paymentRows[0] || { missing: 0, crossTenant: 0 },
  }
}

const run = async () => {
  await mongoose.connect(config.database_string as string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const platform = await PlatformSettings.findOne({ key: 'platform' }).select('trial').lean() as any
  const migrations = await migrationReadiness()
  const orgFilter = scopedOrganization ? { organizationId: scopedOrganization } : {}
  const organizations = await Organization.find(orgFilter).select('organizationId agencyName subscription').sort({ organizationId: 1 }).lean() as any[]
  const reports: any[] = []
  let critical = 0
  let warnings = 0

  for (const org of organizations) {
    const organizationId = String(org.organizationId)
    const findings: Finding[] = []
    const add = (finding: Finding) => { findings.push(finding); if (finding.severity === 'critical') critical += 1; if (finding.severity === 'warning') warnings += 1 }

    const [
      settings, initialization, accountCount, systemAccountCount, fiscalYearCount, fiscalPeriodCount,
      categoryMappingCount, paymentMappingCount, bankCount, legacyTransactionCount, legacyInvoiceCount,
      legacyCommissionCount, legacyVendorCount, legacyBudgetCount, duplicateSources, unbalancedJournals,
      relationIntegrity, users,
    ] = await Promise.all([
      FinanceAccountingSettings.findOne({ organizationId }).lean() as any,
      FinanceAccountingInitialization.findOne({ organizationId }).lean() as any,
      FinanceAccount.countDocuments({ organizationId }),
      FinanceAccount.countDocuments({ organizationId, isSystem: true }),
      FinanceFiscalYear.countDocuments({ organizationId }),
      FinanceFiscalPeriod.countDocuments({ organizationId }),
      FinanceCategoryAccountMapping.countDocuments({ organizationId }),
      FinanceLegacyPaymentMethodMapping.countDocuments({ organizationId }),
      FinanceBankAccount.countDocuments({ organizationId }),
      FinanceTransaction.countDocuments({ organizationId }),
      FinanceInvoice.countDocuments({ organizationId }),
      FinanceCommission.countDocuments({ organizationId }),
      FinanceVendor.countDocuments({ organizationId }),
      FinanceBudget.countDocuments({ organizationId }),
      FinanceJournalEntry.aggregate([
        { $match: { organizationId, entryRole: 'PRIMARY', sourceId: { $type: 'string' } } },
        { $group: { _id: { sourceType: '$sourceType', sourceId: '$sourceId' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $count: 'count' },
      ]),
      FinanceJournalLine.aggregate([
        { $match: { organizationId } },
        { $group: { _id: '$journalEntryId', debit: { $sum: '$debitMinor' }, credit: { $sum: '$creditMinor' } } },
        { $match: { $expr: { $ne: ['$debit', '$credit'] } } },
        { $count: 'count' },
      ]),
      relationalIntegrityFor(organizationId),
      User.find({ organizationId, status: 'active' }).select('_id userRole status').lean(),
    ])

    const entitlement = await resolveAdvancedAccountingEntitlement(org, platform?.trial || {})
    const userIds = users.map((user: any) => user._id)
    const profiles = userIds.length ? await UserProfile.find({ userId: { $in: userIds } }).select('userId accessControl').lean() : []
    const profileByUser = new Map(profiles.map((profile: any) => [String(profile.userId), profile.accessControl]))
    const permissionCounts: Record<string, number> = {}
    for (const user of users as any[]) {
      const permissions = effectivePermissionsForUser({ userRole: user.userRole, accessControl: profileByUser.get(String(user._id)) })
      for (const permission of permissions.filter((value) => value.startsWith('finance.'))) permissionCounts[permission] = (permissionCounts[permission] || 0) + 1
    }

    const legacyCount = legacyTransactionCount + legacyInvoiceCount + legacyCommissionCount + legacyVendorCount + legacyBudgetCount
    const duplicateCount = Number(duplicateSources?.[0]?.count || 0)
    const unbalancedCount = Number(unbalancedJournals?.[0]?.count || 0)
    const activationStatus = settings?.activationStatus || null
    const initStatus = initialization?.status || null

    if (initStatus === 'ACTIVATING') {
      const updatedAt = new Date(initialization.updatedAt || initialization.createdAt || 0).getTime()
      const ageMinutes = updatedAt ? Math.floor((Date.now() - updatedAt) / 60000) : Number.POSITIVE_INFINITY
      if (ageMinutes >= staleMinutes) add({ code: 'ACCOUNTING_ACTIVATION_STALE', severity: 'critical', message: `Accounting initialization has been ACTIVATING for ${ageMinutes} minute(s).`, details: { ageMinutes, staleThresholdMinutes: staleMinutes } })
    }
    if (activationStatus === 'MIGRATION_REQUIRED') add({ code: 'ACCOUNTING_MIGRATION_REQUIRED', severity: 'warning', message: 'Accounting is blocked until historical finance initialization is completed.' })
    if (activationStatus === 'LOCKED_READ_ONLY') add({ code: 'ACCOUNTING_LOCKED_READ_ONLY', severity: 'info', message: 'Accounting is preserved read-only for this organization.' })
    if (settings?.initializedAt && systemAccountCount === 0) add({ code: 'INITIALIZED_WITHOUT_SYSTEM_ACCOUNTS', severity: 'critical', message: 'Accounting settings are initialized but no system Chart of Accounts entries exist.' })
    if (settings?.initializedAt && fiscalYearCount === 0) add({ code: 'INITIALIZED_WITHOUT_FISCAL_YEAR', severity: 'critical', message: 'Accounting settings are initialized but no fiscal year exists.' })
    if (String(settings?.baseCurrency || 'BDT').toUpperCase() !== 'BDT' && legacyCount > 0) add({ code: 'LEGACY_BASE_CURRENCY_MISMATCH', severity: 'critical', message: 'Legacy Finance contains BDT-only records while Advanced Accounting uses a non-BDT base currency.', count: legacyCount, details: { baseCurrency: settings.baseCurrency, legacyCurrency: 'BDT' } })
    if (duplicateCount > 0) add({ code: 'DUPLICATE_PRIMARY_SOURCE_POSTING', severity: 'critical', message: 'Duplicate PRIMARY journals exist for the same sourceType + sourceId.', count: duplicateCount })
    if (unbalancedCount > 0) add({ code: 'UNBALANCED_JOURNALS', severity: 'critical', message: 'One or more journals have total debit different from total credit.', count: unbalancedCount })

    const relationNumbers = [
      ['JOURNAL_ACCOUNT_REFERENCE_INVALID', relationIntegrity.journalLines.accountMissing + relationIntegrity.journalLines.accountCrossTenant],
      ['JOURNAL_ENTRY_REFERENCE_INVALID', relationIntegrity.journalLines.journalMissing + relationIntegrity.journalLines.journalCrossTenant],
      ['CATEGORY_ACCOUNT_MAPPING_INVALID', relationIntegrity.categoryMappings.missing + relationIntegrity.categoryMappings.crossTenant],
      ['BANK_GL_MAPPING_INVALID', relationIntegrity.bankGlMappings.missing + relationIntegrity.bankGlMappings.crossTenant],
      ['PAYMENT_METHOD_BANK_MAPPING_INVALID', relationIntegrity.paymentMethodMappings.missing + relationIntegrity.paymentMethodMappings.crossTenant],
    ] as Array<[string, number]>
    for (const [code, count] of relationNumbers) if (count > 0) add({ code, severity: 'critical', message: 'Missing or cross-tenant Finance reference detected.', count })

    // Settings account references are another common source of tenant/data drift.
    const settingsRefs = settings ? Object.values({ ...(settings.defaultAccounts || {}), ...(settings.taxAccounts || {}) }).filter(Boolean).map(oid) : []
    if (settingsRefs.length) {
      const validAccounts = await FinanceAccount.find({ _id: { $in: settingsRefs.filter((value) => Types.ObjectId.isValid(value)).map((value) => new Types.ObjectId(value)) } }).select('_id organizationId').lean()
      const validById = new Map(validAccounts.map((row: any) => [String(row._id), String(row.organizationId)]))
      const invalid = settingsRefs.filter((ref) => !Types.ObjectId.isValid(ref) || !validById.has(ref) || validById.get(ref) !== organizationId)
      if (invalid.length) add({ code: 'SETTINGS_ACCOUNT_REFERENCE_INVALID', severity: 'critical', message: 'Accounting settings contain missing or cross-tenant account references.', count: invalid.length })
    }

    if (entitlement.enabled && !permissionCounts['finance.accounting.read']) add({ code: 'ENTITLED_WITHOUT_ACCOUNTING_READER', severity: 'warning', message: 'Advanced Accounting is entitled but no active tenant role/profile currently resolves finance.accounting.read.' })

    reports.push({
      organizationId,
      agencyName: org.agencyName,
      subscription: { plan: org.subscription?.plan || 'trial', planVersion: org.subscription?.planVersion || null, status: org.subscription?.status || null, advancedAccounting: entitlement },
      permissions: { activeUsers: users.length, financePermissionUserCounts: permissionCounts },
      accounting: {
        settings: settings ? { initializedAt: settings.initializedAt, activationStatus, accountingStartDate: settings.accountingStartDate, baseCurrency: settings.baseCurrency } : null,
        initialization: initialization ? { status: initStatus, accountingStartDate: initialization.accountingStartDate, updatedAt: initialization.updatedAt } : null,
        counts: { accounts: accountCount, systemAccounts: systemAccountCount, fiscalYears: fiscalYearCount, fiscalPeriods: fiscalPeriodCount, categoryMappings: categoryMappingCount, paymentMethodMappings: paymentMappingCount, bankAccounts: bankCount },
      },
      legacyFinance: { currency: 'BDT', transactions: legacyTransactionCount, invoices: legacyInvoiceCount, commissions: legacyCommissionCount, vendors: legacyVendorCount, budgets: legacyBudgetCount, totalRecords: legacyCount },
      integrity: { duplicatePrimarySources: duplicateCount, unbalancedJournals: unbalancedCount, ...relationIntegrity },
      findings,
    })
  }

  const result = {
    audit: 'finance-phase1-read-only',
    readOnly: true,
    generatedAt: new Date().toISOString(),
    scope: scopedOrganization || 'all-organizations',
    staleActivatingThresholdMinutes: staleMinutes,
    migrationReadiness: migrations,
    summary: { organizations: reports.length, criticalFindings: critical, warningFindings: warnings },
    organizations: reports,
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (failOnFindings && critical > 0) process.exitCode = 2
}

run()
  .catch((error) => { console.error('[audit:finance] failed', error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
