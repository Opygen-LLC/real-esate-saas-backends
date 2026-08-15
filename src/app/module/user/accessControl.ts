export const permissionValues = [
  'dashboard.read',
  'properties.read', 'properties.write', 'properties.publish', 'properties.delete',
  'leads.read', 'leads.write', 'leads.assign',
  'contacts.read', 'contacts.write',
  'tasks.read', 'tasks.write',
  'viewings.read', 'viewings.write',
  'users.read', 'users.write', 'organization.manage',
  'billing.manage', 'website.write', 'domains.manage',
  'analytics.read', 'analytics.advanced',
  'crm.configure', 'crm.export',
  'messaging.manage', 'whatsapp.manage',
  'finance.read', 'finance.write',
  'compliance.read', 'compliance.write',
] as const


export type Permission = typeof permissionValues[number]

export const permissionMatrix: Record<string, Permission[]> = {
  agency_owner: [...permissionValues],
  agency_admin: [
    'dashboard.read',
    'properties.read', 'properties.write', 'properties.publish', 'properties.delete',
    'leads.read', 'leads.write', 'leads.assign',
    'contacts.read', 'contacts.write',
    'tasks.read', 'tasks.write',
    'viewings.read', 'viewings.write',
    'users.read', 'users.write', 'organization.manage',
    'website.write', 'domains.manage',
    'analytics.read', 'analytics.advanced',
    'crm.configure', 'crm.export',
    'messaging.manage', 'whatsapp.manage',
    'finance.read', 'finance.write',
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
  'contacts.write': ['contacts.read'],
  'tasks.write': ['tasks.read'],
  'viewings.write': ['viewings.read'],
  'users.write': ['users.read'],
  'finance.write': ['finance.read'],
  'analytics.advanced': ['analytics.read'],
  'crm.configure': ['leads.read', 'users.read'],
  'crm.export': ['leads.read'],
  'messaging.manage': ['leads.read'],
  'whatsapp.manage': ['leads.read'],
}

export const normalizeCustomPermissions = (input: string[] = [], options: { allowBilling?: boolean } = {}): Permission[] => {
  const allowed = new Set<string>(permissionValues)
  const selected = new Set<Permission>()
  for (const value of input) {
    if (!allowed.has(value)) continue
    if (!options.allowBilling && value === 'billing.manage') continue
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

export const permissionsForRole = (role: string): Permission[] => [...(permissionMatrix[role] || [])]
export const roleHasPermission = (role: string, permission: Permission): boolean => permissionMatrix[role]?.includes(permission) || false

export const effectivePermissionsForUser = (user: { userRole?: string; accessControl?: { useRoleDefaults?: boolean; permissions?: string[] } | null }): Permission[] => {
  const role = String(user.userRole || '')
  const defaults = permissionsForRole(role)
  if (role === 'agency_owner') return defaults
  if (user.accessControl?.useRoleDefaults === false) {
    return normalizeCustomPermissions(user.accessControl.permissions || [], { allowBilling: false })
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
  { group: 'CRM', items: [
    { permission: 'leads.read', label: 'View leads', description: 'View leads and pipeline records.' },
    { permission: 'leads.write', label: 'Manage leads', description: 'Create and update leads.' },
    { permission: 'leads.assign', label: 'Assign leads', description: 'Assign or reassign leads to team members.' },
    { permission: 'contacts.read', label: 'View contacts', description: 'View CRM contacts.' },
    { permission: 'contacts.write', label: 'Manage contacts', description: 'Create and update contacts.' },
    { permission: 'tasks.read', label: 'View tasks', description: 'View tasks and reminders.' },
    { permission: 'tasks.write', label: 'Manage tasks', description: 'Create and update tasks.' },
    { permission: 'viewings.read', label: 'View viewings', description: 'View property viewing schedule.' },
    { permission: 'viewings.write', label: 'Manage viewings', description: 'Create and update viewings.' },
  ] },
  { group: 'Team & agency', items: [
    { permission: 'users.read', label: 'View team', description: 'View the agency roster.' },
    { permission: 'users.write', label: 'Manage team', description: 'Invite and remove team members. Member access policy remains owner-only.' },
    { permission: 'organization.manage', label: 'Agency settings', description: 'Update agency profile and operational settings.' },
  ] },
  { group: 'Growth', items: [
    { permission: 'analytics.read', label: 'Reports', description: 'View standard analytics and reports.' },
    { permission: 'analytics.advanced', label: 'Advanced analytics', description: 'View premium analytics when included in the agency plan.' },
    { permission: 'website.write', label: 'Website studio', description: 'Edit website content, template and branding.' },
    { permission: 'domains.manage', label: 'Custom domain', description: 'Configure a custom domain when included in the agency plan.' },
  ] },
  { group: 'Finance & billing', items: [
    { permission: 'finance.read', label: 'View finance', description: 'View finance reports and transactions.' },
    { permission: 'finance.write', label: 'Manage finance', description: 'Create and update finance records.' },
    { permission: 'billing.manage', label: 'Manage subscription', description: 'Owner-only subscription and billing management.' },
  ] },
] as const
