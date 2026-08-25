/**
 * Tenant-owned collections deleted by the canonical hard-delete service.
 *
 * Keep this list centralized so new tenant-scoped modules cannot be forgotten
 * when permanent deletion is executed. A successful Super Admin hard delete
 * intentionally leaves no organization-scoped operational, audit, or data-
 * subject-request records in MongoDB.
 */
export const TENANT_DELETION_COLLECTIONS = [
  // Core workspace
  'users',
  'properties',
  'leads',
  'contacts',
  'activities',
  'tasks',
  'viewings',
  'billings',
  'notifications',
  'authsessions',
  'otpchallenges',

  // CRM / assignments / imports
  'crmconfigs',
  'leadassignmentaudits',
  'lead_import_sessions',
  'leadallowancereservations',

  // Subscription / billing / lead-capacity purchases
  'bkashpayments',
  'subscriptionbenefitperiods',
  'subscriptionbenefitstreakadjustments',
  'subscriptionchangerequests',
  'subscriptionpayments',
  'leadpurchaserequests',
  'leadtopupgrants',
  // Reserved future recurring-add-on collection names. deleteMany against a
  // non-existent Mongo collection is harmless and keeps retention future-safe.
  'recurringleadaddons',
  'leadaddonsubscriptions',
  'tenantentitlementoverrides',

  // Team / tenant configuration
  'teaminvitations',
  'amenities',
  'propertytypes',

  // Finance
  'financetransactions',
  'financeinvoices',
  'financecommissions',
  'financevendors',
  'financebudgets',

  // Website / domain / public traffic
  'banners',
  'sections',
  'landingpages',
  'websiteassets',
  'websitepages',
  'websiterevisions',
  'websitesubmissions',
  'websitepreviewtokens',
  'websiteuploadintents',
  'visitorlogs',
  'domainrecords',
  'domainevents',
  'subdomainaliases',

  // Integrations / async operations
  'operationsjobs',
  'metaevents',
  'metaintegrations',
  'smstemplates',
  'smsoptouts',
  'smsmessages',
  'whatsappintegrations',

  // Reviews / moderation / support / compliance profile
  'reviewinvitations',
  'agencyreviews',
  'fraudreports',
  'supporttickets',
  'complianceprofiles',
  'consentrecords',

  // Read-only support sessions contain tenant/user identifiers and are not part
  // of the immutable AuditEvent collection.
  'impersonationsessions',

  // A hard delete is a zero-tenant-data operation. These are deleted through
  // the raw MongoDB collection API because AuditEvent intentionally blocks
  // model-level deletes during normal application operation.
  'auditevents',
  'datasubjectrequests',
] as const

export type TenantDeletionCollection = (typeof TENANT_DELETION_COLLECTIONS)[number]
