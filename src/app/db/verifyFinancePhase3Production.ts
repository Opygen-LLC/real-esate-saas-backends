import mongoose from 'mongoose'
import config from '../../config'
import { Organization } from '../module/organization/organization.model'
import { FinanceAccountingSettings } from '../module/finance/financeAccountingSettings.model'
import { FinanceAccountingInitialization } from '../module/finance/financeInitialization.model'
import { FinanceJournalEntry, FinanceJournalLine } from '../module/finance/financeAccounting.model'
import { FinanceReportingService } from '../module/finance/financeReporting.service'

type Finding = { organizationId: string; code: string; message: string; details?: Record<string, unknown> }

const scopedOrganization = process.argv.find((arg) => arg.startsWith('--organization='))?.split('=', 2)[1]?.trim()
const failOnFindings = process.argv.includes('--fail-on-findings')

const run = async () => {
  await mongoose.connect(config.database_string as string, { autoIndex: false, serverSelectionTimeoutMS: 10_000 })
  const organizations = await Organization.find(scopedOrganization ? { organizationId: scopedOrganization } : {})
    .select('organizationId agencyName')
    .sort({ organizationId: 1 })
    .lean()

  const findings: Finding[] = []
  const rows: Array<Record<string, unknown>> = []

  for (const organization of organizations) {
    const organizationId = String(organization.organizationId)
    const [settings, initialization, duplicateSources, unbalancedJournals] = await Promise.all([
      FinanceAccountingSettings.findOne({ organizationId }).lean(),
      FinanceAccountingInitialization.findOne({ organizationId }).sort({ updatedAt: -1 }).lean(),
      FinanceJournalEntry.aggregate([
        { $match: { organizationId, entryRole: 'PRIMARY', sourceId: { $type: 'string', $ne: '' } } },
        { $group: { _id: { sourceType: '$sourceType', sourceId: '$sourceId' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $count: 'count' },
      ]),
      FinanceJournalLine.aggregate([
        { $match: { organizationId } },
        { $group: { _id: '$journalEntryId', debitMinor: { $sum: '$debitMinor' }, creditMinor: { $sum: '$creditMinor' } } },
        { $match: { $expr: { $ne: ['$debitMinor', '$creditMinor'] } } },
        { $count: 'count' },
      ]),
    ])

    const activationStatus = String(settings?.activationStatus || '')
    const initializationStatus = String(initialization?.status || '')
    const initialized = Boolean(settings?.initializedAt)
    const duplicateCount = Number(duplicateSources?.[0]?.count || 0)
    const unbalancedCount = Number(unbalancedJournals?.[0]?.count || 0)

    if (initializationStatus === 'ACTIVATING') findings.push({ organizationId, code: 'ACCOUNTING_MIGRATION_IN_PROGRESS', message: 'Accounting initialization is still ACTIVATING.' })
    if (activationStatus === 'MIGRATION_REQUIRED') findings.push({ organizationId, code: 'ACCOUNTING_MIGRATION_REQUIRED', message: 'Historical Finance migration is required before automatic GL posting can be enabled.' })
    if (duplicateCount) findings.push({ organizationId, code: 'DUPLICATE_ACCOUNTING_POSTING', message: 'Duplicate PRIMARY source journals were detected.', details: { duplicateSourceCount: duplicateCount } })
    if (unbalancedCount) findings.push({ organizationId, code: 'ACCOUNTING_UNBALANCED', message: 'One or more journals have debit totals different from credit totals.', details: { unbalancedJournalCount: unbalancedCount } })

    let trialBalance: Awaited<ReturnType<typeof FinanceReportingService.trialBalance>> | null = null
    let balanceSheet: Awaited<ReturnType<typeof FinanceReportingService.balanceSheet>> | null = null
    if (initialized && !['MIGRATION_REQUIRED'].includes(activationStatus)) {
      try {
        ;[trialBalance, balanceSheet] = await Promise.all([
          FinanceReportingService.trialBalance(organizationId, { includeZero: 'true' }),
          FinanceReportingService.balanceSheet(organizationId, { includeZero: 'true' }),
        ])
        if (!trialBalance.balanced) findings.push({ organizationId, code: 'TRIAL_BALANCE_UNBALANCED', message: 'Trial Balance debit and credit totals are not equal.', details: trialBalance.totals })
        if (!balanceSheet.summary.balanced) findings.push({ organizationId, code: 'ACCOUNTING_EQUATION_MISMATCH', message: 'Assets do not equal Liabilities + Equity.', details: balanceSheet.summary })
      } catch (error) {
        findings.push({ organizationId, code: 'FINANCE_REPORT_VERIFICATION_FAILED', message: error instanceof Error ? error.message : 'Financial statement verification failed.' })
      }
    }

    rows.push({
      organizationId,
      agencyName: organization.agencyName,
      initialized,
      activationStatus: activationStatus || null,
      initializationStatus: initializationStatus || null,
      duplicatePrimarySources: duplicateCount,
      unbalancedJournals: unbalancedCount,
      trialBalanceBalanced: trialBalance?.balanced ?? null,
      accountingEquationBalanced: balanceSheet?.summary.balanced ?? null,
      accountingEquationDifferenceMinor: balanceSheet?.summary.differenceMinor ?? null,
    })
  }

  const output = {
    verification: 'finance-phase3-production-read-only',
    readOnly: true,
    generatedAt: new Date().toISOString(),
    scope: scopedOrganization || 'all-organizations',
    summary: { organizations: rows.length, findings: findings.length, passed: findings.length === 0 },
    organizations: rows,
    findings,
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  if (failOnFindings && findings.length) process.exitCode = 2
}

run()
  .catch((error) => { console.error('[verify:finance-phase3-production] failed', error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
