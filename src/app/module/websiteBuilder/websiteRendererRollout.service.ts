import ApiError from '../../../errors/ApiError'
import {
  CURRENT_WEBSITE_RENDERER_VERSION,
  LEGACY_WEBSITE_RENDERER_VERSION,
  resolveWebsiteRendererVersion,
  type WebsiteRendererVersion,
} from '../../../contracts/websiteCatalog/manifest'

export const WEBSITE_RENDERER_ROLLOUT_MODES = ['disabled', 'opt-in', 'new-sites'] as const
export type WebsiteRendererRolloutMode = typeof WEBSITE_RENDERER_ROLLOUT_MODES[number]

const rolloutMode = (): WebsiteRendererRolloutMode => {
  const raw = String(process.env.WEBSITE_RENDERER_ROLLOUT_MODE || 'disabled').trim().toLowerCase()
  return (WEBSITE_RENDERER_ROLLOUT_MODES as readonly string[]).includes(raw) ? raw as WebsiteRendererRolloutMode : 'disabled'
}

const initialRendererVersion = (): WebsiteRendererVersion =>
  rolloutMode() === 'new-sites' ? CURRENT_WEBSITE_RENDERER_VERSION : LEGACY_WEBSITE_RENDERER_VERSION

const rolloutOrganizations = (): Set<string> => {
  const parts = String(process.env.WEBSITE_RENDERER_ROLLOUT_ORGANIZATIONS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (parts.includes('*')) return new Set()
  return new Set(
    parts
      .filter((value) => /^[A-Za-z0-9_-]{3,120}$/.test(value))
      .slice(0, 500),
  )
}

const canAdoptCurrentRenderer = (organizationId?: string): boolean => {
  if (rolloutMode() === 'disabled') return false
  const cohort = rolloutOrganizations()
  return cohort.size === 0 || Boolean(organizationId && cohort.has(organizationId))
}

const assertTransitionAllowed = (organizationId: string, before: unknown, after: unknown) => {
  const previous = resolveWebsiteRendererVersion(before)
  const next = resolveWebsiteRendererVersion(after)
  if (previous !== CURRENT_WEBSITE_RENDERER_VERSION && next === CURRENT_WEBSITE_RENDERER_VERSION && !canAdoptCurrentRenderer(organizationId)) {
    throw new ApiError(409, 'The redesigned website renderer rollout is currently paused. Your saved draft was not published.', '', 'WEBSITE_RENDERER_ROLLOUT_PAUSED')
  }
}

export const WebsiteRendererRolloutService = {
  mode: rolloutMode,
  initialRendererVersion,
  canAdoptCurrentRenderer,
  resolve: resolveWebsiteRendererVersion,
  assertTransitionAllowed,
  metadata: (organizationId?: string) => ({
    mode: rolloutMode(),
    legacyVersion: LEGACY_WEBSITE_RENDERER_VERSION,
    currentVersion: CURRENT_WEBSITE_RENDERER_VERSION,
    canAdoptCurrent: canAdoptCurrentRenderer(organizationId),
    cohortRestricted: rolloutOrganizations().size > 0,
  }),
}
