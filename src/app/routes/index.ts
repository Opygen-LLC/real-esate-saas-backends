import express from 'express'
import { ActivityRoute } from '../module/activity/activity.route'
import { AmenityRoute } from '../module/amenity/amenity.route'
import { AuthRoutes } from '../module/auth/auth.route'
import { BannerRoute } from '../module/banner/banner.route'
import { BillingRoute } from '../module/billing/billing.route'
import { ContactRoute } from '../module/contact/contact.route'
import { DashboardRoute } from '../module/dashboard/dashboard.route'
import { DomainRoute } from '../module/domain/domain.route'
import { LandingPageRoute } from '../module/landingPage/landingPage.route'
import { LeadRoute } from '../module/lead/lead.route'
import { OrganizationRoute } from '../module/organization/organization.route'
import { PropertyRoute } from '../module/property/property.route'
import { PropertyTypeRoute } from '../module/propertyType/propertyType.route'
import { SectionRoute } from '../module/section/section.route'
import { SmsRoute } from '../module/sms/sms.route'
import { SubscriptionPlanRoute } from '../module/subscriptionPlan/subscriptionPlan.route'
import { TaskRoute } from '../module/task/task.route'
import { UserRoute } from '../module/user/user.route'
import { ViewingRoute } from '../module/viewing/viewing.route'
import { VisitorLogsRoute } from '../module/visitorLogs/visitorLogs.route'
import { WebsiteBuilderRoute } from '../module/websiteBuilder/websiteBuilder.route'
import { LocalizationRoute } from '../module/localization/localization.route'
import { PlatformSettingsRoute } from '../module/platformSettings/platformSettings.route'
import { MetaIntegrationRoute } from '../module/metaIntegration/metaIntegration.route'
import { CrmRoute } from '../module/crm/crm.route'
import { WhatsAppRoute } from '../module/whatsapp/whatsapp.route'
import { NotificationRoute } from '../module/notification/notification.route'
import { PlatformAdminRoute } from '../module/platformAdmin/platformAdmin.route'
import { ObservabilityRoute } from '../module/observability/observability.route'
import { TeamInvitationRoute } from '../module/teamInvitation/teamInvitation.route'
import { FinanceRoute } from '../module/finance/finance.route'
import { UploadRoute } from '../module/upload/upload.route'
import { ReviewRoute } from '../module/review/review.route'
import { WebsiteSubmissionRoute } from '../module/websiteSubmission/websiteSubmission.route'

const router = express.Router()

const moduleRoutes = [
  { path: '/website-submissions', route: WebsiteSubmissionRoute },
  { path: '/reviews', route: ReviewRoute },
  { path: '/upload', route: UploadRoute },
  { path: '/finance', route: FinanceRoute },

  { path: '/team-invitations', route: TeamInvitationRoute },
  { path: '/observability', route: ObservabilityRoute },
  { path: '/platform-admin', route: PlatformAdminRoute },
  { path: '/notification', route: NotificationRoute },
  { path: '/crm', route: CrmRoute },
  { path: '/whatsapp', route: WhatsAppRoute },
  { path: '/meta', route: MetaIntegrationRoute },
  { path: '/localization', route: LocalizationRoute },
  { path: '/platform-settings', route: PlatformSettingsRoute },
  {
    path: '/auth',
    route: AuthRoutes,
  },
  {
    path: '/users',
    route: UserRoute,
  },
  {
    path: '/organization/website',
    route: WebsiteBuilderRoute,
  },
  {
    path: '/organization',
    route: OrganizationRoute,
  },
  {
    path: '/shop', // Alias for legacy endpoints compatibility
    route: OrganizationRoute,
  },
  {
    path: '/property',
    route: PropertyRoute,
  },
  {
    path: '/property-type',
    route: PropertyTypeRoute,
  },
  {
    path: '/amenity',
    route: AmenityRoute,
  },
  {
    path: '/contact',
    route: ContactRoute,
  },
  {
    path: '/lead',
    route: LeadRoute,
  },
  {
    path: '/activity',
    route: ActivityRoute,
  },
  {
    path: '/task',
    route: TaskRoute,
  },
  {
    path: '/viewing',
    route: ViewingRoute,
  },
  {
    path: '/subscription',
    route: SubscriptionPlanRoute,
  },
  {
    path: '/website-price', // Alias for plan endpoints
    route: SubscriptionPlanRoute,
  },
  {
    path: '/billing',
    route: BillingRoute,
  },
  {
    path: '/domain',
    route: DomainRoute,
  },
  {
    path: '/dashboard',
    route: DashboardRoute,
  },
  {
    path: '/banner',
    route: BannerRoute,
  },
  {
    path: '/section',
    route: SectionRoute,
  },
  {
    path: '/landing-page',
    route: LandingPageRoute,
  },
  {
    path: '/analytics',
    route: VisitorLogsRoute,
  },
  {
    path: '/sms',
    route: SmsRoute,
  },
]

moduleRoutes.forEach((route) => {
  router.use(route.path, route.route)
})

export default router
