import { Cache } from '../../../shared/cache'

export const WebsiteCache = {
  get: <T>(scope: 'draft' | 'published', organizationId: string, value: string): Promise<T | null> => Cache.website.get<T>(scope, organizationId, value),
  set: (scope: 'draft' | 'published', organizationId: string, value: string, data: unknown, ttlSeconds: number): Promise<void> => Cache.website.set(scope, organizationId, value, data, ttlSeconds),
  del: (scope: 'draft' | 'published', organizationId: string, value: string): Promise<void> => Cache.website.del(scope, organizationId, value),
}
