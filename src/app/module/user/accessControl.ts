export const permissionValues = [
  'dashboard.read',
  'properties.read', 'properties.write', 'properties.publish', 'properties.delete',
  'leads.read', 'leads.write', 'leads.assign', 'crm.team.read', 'crm.team.manage',
  'contacts.read', 'contacts.write',
  'tasks.read', 'tasks.write',
  'viewings.read', 'viewings.write',
  'users.read', 'users.write', 'organization.manage',
  'billing.manage', 'website.write', 'domains.manage', 'website.submissions.read', 'website.submissions.manage', 'website.submissions.delete',
  'analytics.read', 'analytics.advanced',
  'crm.configure', 'crm.export',
  'messaging.manage', 'whatsapp.manage',
  'finance.read', 'finance.write', 'finance.delete',
  'finance.accounting.read', 'finance.accounts.manage',
  'finance.journal.create', 'finance.journal.approve', 'finance.journal.post', 'finance.journal.reverse',
  'finance.receivables.manage', 'finance.payables.manage',
  'finance.bank.manage', 'finance.bank.reconcile',
  'finance.shareholders.read', 'finance.shareholders.manage', 'finance.loans.manage',
  'finance.tax.manage', 'finance.period.close', 'finance.period.reopen',
  'finance.reports.read', 'finance.reports.export', 'finance.audit.read',
] as const



export type Permission = typeof permissionValues[number]

export const permissionMatrix: Record<string, Permission[]> = {
  agency_owner: [...permissionValues],
  agency_admin: [
    'dashboard.read',
    'properties.read', 'properties.write', 'properties.publish', 'properties.delete',
    'leads.read', 'leads.write', 'leads.assign', 'crm.team.read', 'crm.team.manage',
    'contacts.read', 'contacts.write',
    'tasks.read', 'tasks.write',
    'viewings.read', 'viewings.write',
    'users.read', 'users.write', 'organization.manage',
    'website.write', 'domains.manage', 'website.submissions.read', 'website.submissions.manage',
    'analytics.read', 'analytics.advanced',
    'crm.configure', 'crm.export',
    'messaging.manage', 'whatsapp.manage',
    'finance.read', 'finance.write',
    'finance.accounting.read', 'finance.accounts.manage',
    'finance.journal.create', 'finance.journal.approve', 'finance.journal.post', 'finance.journal.reverse',
    'finance.receivables.manage', 'finance.payables.manage', 'finance.bank.manage', 'finance.bank.reconcile',
    'finance.shareholders.read', 'finance.shareholders.manage', 'finance.loans.manage', 'finance.tax.manage',
    'finance.period.close', 'finance.reports.read', 'finance.reports.export', 'finance.audit.read',
  ],
  agent: [
    'dashboard.read', 'properties.read', 'properties.write',
    'leads.read', 'leads.write', 'contacts.read', 'contacts.write',
    'tasks.read', 'tasks.write', 'viewings.read', 'viewings.write',
  ],
  staff: [
    'dashboard.read', 'properties.read', 'leads.read',
    'contacts.read', 'contacts.write', 'tasks.read', 'tasks.write',
    'viewings.read', 'viewings.write',
  ],
  viewer: [
    'dashboard.read', 'properties.read', 'leads.read', 'contacts.read',
    'tasks.read', 'viewings.read',
  ],
  user: ['dashboard.read', 'properties.read'],
  'super-admin': [],
}

const permissionDependencies: Partial<Record<Permission, Permission[]>> = {
  'properties.write': ['properties.read'],
  'properties.publish': ['properties.read', 'properties.write'],
  'properties.delete': ['properties.read'],
  'leads.write': ['leads.read'],
  'leads.assign': ['leads.read'],
  'crm.team.manage': ['crm.team.read', 'leads.read', 'leads.write', 'leads.assign', 'contacts.read', 'contacts.write', 'tasks.read', 'tasks.write', 'viewings.read', 'viewings.write'],
  'contacts.write': ['contacts.read'],
  'tasks.write': ['tasks.read'],
  'viewings.write': ['viewings.read'],
  'website.submissions.manage': ['website.submissions.read'],
  'website.submissions.delete': ['website.submissions.read'],
  'users.write': ['users.read'],
  'finance.write': ['finance.read'],
  'finance.delete': ['finance.read'],
  'finance.accounting.read': ['finance.read'],
  'finance.accounts.manage': ['finance.accounting.read'],
  'finance.journal.create': ['finance.accounting.read'],
  'finance.journal.approve': ['finance.accounting.read'],
  'finance.journal.post': ['finance.accounting.read'],
  'finance.journal.reverse': ['finance.accounting.read'],
  'finance.receivables.manage': ['finance.accounting.read'],
  'finance.payables.manage': ['finance.accounting.read'],
  'finance.bank.manage': ['finance.accounting.read'],
  'finance.bank.reconcile': ['finance.accounting.read', 'finance.bank.manage'],
  'finance.shareholders.read': ['finance.accounting.read'],
  'finance.shareholders.manage': ['finance.shareholders.read'],
  'finance.loans.manage': ['finance.accounting.read'],
  'finance.tax.manage': ['finance.accounting.read'],
  'finance.period.close': ['finance.accounting.read'],
  'finance.period.reopen': ['finance.accounting.read', 'finance.period.close'],
  'finance.reports.read': ['finance.accounting.read'],
  'finance.reports.export': ['finance.reports.read'],
  'finance.audit.read': ['finance.accounting.read'],
  'analytics.advanced': ['analytics.read'],
  'crm.configure': ['leads.read', 'users.read'],
  'crm.export': ['leads.read', 'contacts.read'],
  'messaging.manage': ['leads.read'],
  'whatsapp.manage': ['leads.read'],
}

const ownerOnlyPermissions = new Set<Permission>(['billing.manage', 'finance.delete', 'finance.period.reopen', 'website.submissions.delete'])

export const normalizeCustomPermissions = (input: string[] = [], options: { allowBilling?: boolean } = {}): Permission[] => {
  const allowed = new Set<string>(permissionValues)
  const selected = new Set<Permission>()
  for (const value of input) {
    if (!allowed.has(value)) continue
    if (ownerOnlyPermissions.has(value as Permission) && !(options.allowBilling && value === 'billing.manage')) continue
    selected.add(value as Permission)
  }
  let changed = true
  while (changed) {
    changed = false
    for (const permission of Array.from(selected)) {
      for (const dependency of permissionDependencies[permission] || []) {
        if (!selected.has(dependency)) { selected.add(dependency); changed = true }
      }
    }
  }
  return Array.from(selected)
}

const mandatoryAgencyAdminCrmPermissions: Permission[] = [
  'leads.read', 'leads.write', 'leads.assign', 'crm.team.read', 'crm.team.manage',
  'contacts.read', 'contacts.write',
  'tasks.read', 'tasks.write',
  'viewings.read', 'viewings.write',
  'crm.export',
]

export const permissionsForRole = (role: string): Permission[] => [...(permissionMatrix[role] || [])]
export const roleHasPermission = (role: string, permission: Permission): boolean => permissionMatrix[role]?.includes(permission) || false

export const effectivePermissionsForUser = (user: { userRole?: string; accessControl?: { useRoleDefaults?: boolean; permissions?: string[] } | null }): Permission[] => {
  const role = String(user.userRole || '')
  const defaults = permissionsForRole(role)
  if (role === 'agency_owner') return defaults
  if (user.accessControl?.useRoleDefaults === false) {
    const custom = normalizeCustomPermissions(user.accessControl.permissions || [], { allowBilling: false })
    // Agency admins are CRM managers by contract. Custom permissions can restrict
    // unrelated modules, but cannot remove the CRM authority required by that role.
    if (role === 'agency_admin') return [...new Set<Permission>([...custom, ...mandatoryAgencyAdminCrmPermissions])]
    return custom
  }
  return defaults
}

export const permissionCatalog = [
  { group: 'Workspace', items: [
    { permission: 'dashboard.read', label: 'Dashboard', description: 'View agency overview and daily metrics.' },
  ] },
  { group: 'Listings', items: [
    { permission: 'properties.read', label: 'View properties', description: 'View agency listings.' },
    { permission: 'properties.write', label: 'Create & edit properties', description: 'Add listings and update property information.' },
    { permission: 'properties.publish', label: 'Publish & change listing status', description: 'Make listings public and change inventory visibility/status. Agency owners control who receives this permission.' },
    { permission: 'properties.delete', label: 'Delete properties', description: 'Archive or delete listings.' },
  ] },
  { group: 'Website submissions', items: [
    { permission: 'website.submissions.read', label: 'View website submissions', description: 'View public website form submissions for this agency.' },
    { permission: 'website.submissions.manage', label: 'Manage website submissions', description: 'Update website submission inbox status and processing state.' },
  ] },
  { group: 'CRM', items: [
    { permission: 'leads.read', label: 'View leads', description: 'View leads and pipeline records.' },
    { permission: 'leads.write', label: 'Manage leads', description: 'Create and update leads.' },
    { permission: 'leads.assign', label: 'Assign leads', description: 'Assign or reassign leads to team members.' },
    { permission: 'crm.team.read', label: 'View team CRM records', description: 'Switch from assigned-to-me records to team-wide leads, contacts, tasks, and viewings.' },
    { permission: 'crm.team.manage', label: 'Manage team CRM records', description: 'Edit team-wide leads, contacts, tasks, follow-ups, activities, and viewings. Includes team visibility and lead assignment permissions.' },
    { permission: 'crm.export', label: 'Export CRM records', description: 'Download only the lead/contact records this member is allowed to view. Team-wide exports still require View team CRM records.' },
    { permission: 'contacts.read', label: 'View contacts', description: 'View CRM contacts.' },
    { permission: 'contacts.write', label: 'Manage contacts', description: 'Create and update contacts.' },
    { permission: 'tasks.read', label: 'View tasks', description: 'View tasks and reminders.' },
    { permission: 'tasks.write', label: 'Manage tasks', description: 'Create and update tasks.' },
    { permission: 'viewings.read', label: 'View viewings', description: 'View property viewing schedule.' },
    { permission: 'viewings.write', label: 'Manage viewings', description: 'Create and update viewings.' },
  ] },
  { group: 'Team & agency', items: [
    { permission: 'users.read', label: 'View team', description: 'View the agency roster.' },
    { permission: 'users.write', label: 'Manage team', description: 'Invite/remove team members and manage public broker visibility. Member access policy remains owner-only.' },
    { permission: 'organization.manage', label: 'Agency settings', description: 'Update agency profile and operational settings.' },
  ] },
  { group: 'Growth', items: [
    { permission: 'analytics.read', label: 'Reports', description: 'View standard analytics and reports.' },
    { permission: 'analytics.advanced', label: 'Advanced analytics', description: 'View premium analytics when included in the agency plan.' },
    { permission: 'website.write', label: 'Website studio', description: 'Edit website content, template and branding.' },
    { permission: 'domains.manage', label: 'Custom domain', description: 'Configure a custom domain when included in the agency plan.' },
  ] },
  { group: 'Finance & billing', items: [
    { permission: 'finance.read', label: 'View finance', description: 'View legacy finance reports and transactions.' },
    { permission: 'finance.write', label: 'Manage finance', description: 'Create and update legacy finance records.' },
    { permission: 'finance.accounting.read', label: 'View accounting', description: 'View Advanced Accounting workspace and ledger data when entitled or preserved read-only.' },
    { permission: 'finance.accounts.manage', label: 'Manage Chart of Accounts', description: 'Create and maintain custom General Ledger accounts.' },
    { permission: 'finance.journal.create', label: 'Create journals', description: 'Create and edit draft manual journal entries.' },
    { permission: 'finance.journal.approve', label: 'Approve journals', description: 'Approve draft journals when maker-checker is enabled.' },
    { permission: 'finance.journal.post', label: 'Post journals', description: 'Post approved or permitted draft journals to the General Ledger.' },
    { permission: 'finance.journal.reverse', label: 'Reverse journals', description: 'Create controlled reversal entries for posted journals.' },
    { permission: 'finance.receivables.manage', label: 'Manage receivables', description: 'Manage Accounts Receivable operations.' },
    { permission: 'finance.payables.manage', label: 'Manage payables', description: 'Manage vendor bills and Accounts Payable.' },
    { permission: 'finance.bank.manage', label: 'Manage banking', description: 'Manage finance bank accounts and transfers.' },
    { permission: 'finance.bank.reconcile', label: 'Reconcile banks', description: 'Import statements, match transactions and complete bank reconciliation.' },
    { permission: 'finance.shareholders.read', label: 'View shareholders', description: 'View shareholder registry and equity history.' },
    { permission: 'finance.shareholders.manage', label: 'Manage shareholders', description: 'Manage shareholder registry, equity and dividends.' },
    { permission: 'finance.loans.manage', label: 'Manage loans', description: 'Manage shareholder and company loans.' },
    { permission: 'finance.tax.manage', label: 'Manage tax', description: 'Create and maintain tax/VAT configuration.' },
    { permission: 'finance.period.close', label: 'Close accounting periods', description: 'Complete month-end and year-end accounting close.' },
    { permission: 'finance.period.reopen', label: 'Reopen accounting periods', description: 'Owner-only permission to reopen previously closed periods.' },
    { permission: 'finance.reports.read', label: 'View financial statements', description: 'View GL-based financial statements and advanced reports.' },
    { permission: 'finance.reports.export', label: 'Export financial reports', description: 'Download financial reports as PDF, CSV or XLSX.' },
    { permission: 'finance.audit.read', label: 'View finance audit trail', description: 'View accounting audit and close history.' },
    { permission: 'billing.manage', label: 'Manage subscription', description: 'Owner-only subscription and billing management.' },
  ] },
] as const
