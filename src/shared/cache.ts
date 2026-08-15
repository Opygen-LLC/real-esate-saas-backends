import { RedisClient } from './redisClient'

const safe = (value: string): string => encodeURIComponent(value.toLowerCase().trim()).slice(0, 320)

export const Cache = {
  tenantPublic: {
    get: <T>(identifier: string) => RedisClient.getJson<T>('tenant-public', safe(identifier)),
    set: (identifier: string, value: unknown, ttl = 300) => RedisClient.setJson('tenant-public', safe(identifier), value, ttl),
    del: (...identifiers: string[]) => RedisClient.del('tenant-public', ...identifiers.filter(Boolean).map(safe)),
  },
  tenantResolve: {
    get: (identifier: string) => RedisClient.getJson<{ organizationId: string }>('tenant-resolve', safe(identifier)),
    set: (identifier: string, organizationId: string, ttl = 300) => RedisClient.setJson('tenant-resolve', safe(identifier), { organizationId }, ttl),
    del: (...identifiers: string[]) => RedisClient.del('tenant-resolve', ...identifiers.filter(Boolean).map(safe)),
  },
  plans: {
    get: <T>(key: string) => RedisClient.getJson<T>('plans', safe(key)),
    set: (key: string, value: unknown, ttl = 300) => RedisClient.setJson('plans', safe(key), value, ttl),
    del: (...keys: string[]) => RedisClient.del('plans', ...keys.map(safe)),
  },
  platformSettings: {
    get: <T>(key: string) => RedisClient.getJson<T>('platform-settings', safe(key)),
    set: (key: string, value: unknown, ttl = 300) => RedisClient.setJson('platform-settings', safe(key), value, ttl),
    del: (...keys: string[]) => RedisClient.del('platform-settings', ...keys.map(safe)),
  },
  website: {
    get: <T>(scope: 'draft' | 'published', organizationId: string, value: string) => RedisClient.getJson<T>(`website-${scope}`, `${safe(organizationId)}:${safe(value)}`),
    set: (scope: 'draft' | 'published', organizationId: string, value: string, data: unknown, ttl: number) => RedisClient.setJson(`website-${scope}`, `${safe(organizationId)}:${safe(value)}`, data, ttl),
    del: (scope: 'draft' | 'published', organizationId: string, value: string) => RedisClient.del(`website-${scope}`, `${safe(organizationId)}:${safe(value)}`),
  },
}
