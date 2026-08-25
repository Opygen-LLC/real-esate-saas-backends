/**
 * Central registry for permanent tenant deletion.
 *
 * `TENANT_DELETION_COLLECTIONS` contains every MongoDB collection whose
 * documents are scoped by `organizationId` and must be removed during a Super
 * Admin hard delete. The Organization document itself is deliberately not in
 * this list: it is deleted last by the purge service after all tenant/user data
 * has been removed.
 *
 * `USER_LINKED_DELETION_COLLECTIONS` covers records that must also be deleted
 * by tenant user id. Some of these collections are tenant-scoped too; keeping
 * them here additionally removes malformed/legacy records that still point at
 * a deleted tenant user but are missing or carry an incorrect organizationId.
 *
 * Platform/global collections are explicitly listed as protected so a future
 * registry edit cannot accidentally include them in a tenant purge.
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
  'agencyownerprofiles',
  'agentprofiles',

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

  // Reviews / moderation / support / privacy / compliance
  'reviewinvitations',
  'agencyreviews',
  'fraudreports',
  'supporttickets',
  'complianceprofiles',
  'consentrecords',
  'impersonationsessions',

  // A hard delete is a zero-tenant-data operation. These collections are
  // intentionally deleted as well; they are not preserved after tenant purge.
  'auditevents',
  'datasubjectrequests',
] as const

/**
 * Records that must be removed by userId before the tenant users are deleted.
 * Auth/OTP/profile collections are included even when they also have an
 * organizationId so legacy or malformed rows cannot survive a tenant purge.
 */
export const USER_LINKED_DELETION_COLLECTIONS = [
  'accountcredentials',
  'userprofiles',
  'agencyownerprofiles',
  'agentprofiles',
  'authsessions',
  'otpchallenges',
] as const

/**
 * Platform-wide collections that must never be part of a tenant purge.
 */
export const PROTECTED_PLATFORM_COLLECTIONS = [
  'superadminprofiles',
  'platformsettings',
  'subscriptionplans',
  'leadaddondefinitions',
  'leadtopuppricings',
] as const

/**
 * Organization ids reserved for platform/system identity and therefore not
 * valid hard-delete targets even if a malformed Organization row exists.
 */
export const PROTECTED_ORGANIZATION_IDS = ['platform', '__platform__'] as const

export type TenantDeletionCollection = (typeof TENANT_DELETION_COLLECTIONS)[number]
export type UserLinkedDeletionCollection = (typeof USER_LINKED_DELETION_COLLECTIONS)[number]
