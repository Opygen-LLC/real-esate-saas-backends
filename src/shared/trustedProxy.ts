import { isIP } from 'net'

/** Trust only explicitly configured edge networks; never arbitrary hop counts. */
export const parseTrustedProxy = (raw?: string): false | string[] => {
  if (!raw?.trim() || ['false', '0'].includes(raw.trim().toLowerCase())) return false
  const values = raw.split(',').map((part) => part.trim()).filter(Boolean)
  if (!values.length) throw new Error('TRUST_PROXY must contain trusted proxy IPs or CIDRs')
  for (const value of values) {
    if (['loopback', 'linklocal', 'uniquelocal'].includes(value)) continue
    const [host, mask, extra] = value.split('/')
    const family = isIP(host)
    if (!family || extra !== undefined || (mask !== undefined && (!/^\d+$/.test(mask) || Number(mask) < 1 || Number(mask) > (family === 4 ? 32 : 128)))) {
      throw new Error('TRUST_PROXY must list trusted IPs/CIDRs, not true, hop counts, or a catch-all network')
    }
  }
  return values
}
