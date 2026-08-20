export const DASHBOARD_LIST_ORDER = {
  historical: { primary: 'createdAt', direction: 'desc', tieBreaker: '_id', tieBreakerDirection: 'desc' },
  contacts: { primary: 'updatedAt', direction: 'desc', tieBreaker: '_id', tieBreakerDirection: 'desc' },
  calendar: { primary: 'date', direction: 'asc', secondary: 'startTime', secondaryDirection: 'asc', tieBreaker: '_id', tieBreakerDirection: 'asc' },
} as const

export const PHASE0_REGRESSION_CONTRACTS = {
  contacts: {
    method: 'GET', path: '/contact', tenantScoped: true, defaultOrder: DASHBOARD_LIST_ORDER.contacts,
    response: { collection: true, paginated: true },
  },
  notifications: {
    list: { method: 'GET', path: '/notification' },
    markRead: { method: 'PATCH', path: '/notification/:id/read' },
    dismiss: { method: 'DELETE', path: '/notification/:id' },
    clickBehavior: ['dismiss', 'navigate'] as const,
  },
  teamRolePercentages: {
    denominator: 'members-in-role', independentPerRole: true,
  },
  subscriptionConfirmation: {
    realtimeEvent: 'subscription.changed', oncePerPayment: true, recovery: ['reload', 'login'] as const,
  },
  receiptDownload: {
    contentType: 'application/pdf', filenameExtension: '.pdf', brand: 'Opygen Estate',
  },
  publicBrokers: {
    adminControlled: true, requiresActiveMember: true, requiresLicenseNumber: true, tenantScoped: true,
  },
  viewings: {
    defaultTab: 'table', tabs: ['table', 'calendar'] as const,
    tableOrder: DASHBOARD_LIST_ORDER.historical,
    calendarOrder: DASHBOARD_LIST_ORDER.calendar,
  },
} as const
