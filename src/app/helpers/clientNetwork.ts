import { isIP } from 'net'

/**
 * Return a stable abuse-control network identifier without persisting a full
 * IPv6 privacy address. IPv4-mapped addresses are normalized to IPv4 and IPv6
 * clients are grouped by /64.
 */
export const clientNetwork = (input: string): string => {
  const raw = String(input || '').trim().split('%')[0].toLowerCase()
  if (raw.startsWith('::ffff:') && isIP(raw.slice(7)) === 4) return raw.slice(7)
  if (isIP(raw) === 4) return raw
  if (isIP(raw) !== 6) return 'unknown'

  const canonical = new URL(`http://[${raw}]/`).hostname.replace(/^\[|\]$/g, '')
  const [left, right] = canonical.split('::')
  const lhs = left ? left.split(':') : []
  const rhs = right ? right.split(':') : []
  const groups = right !== undefined
    ? [...lhs, ...Array(8 - lhs.length - rhs.length).fill('0'), ...rhs]
    : lhs

  if (
    groups.slice(0, 5).every((part) => Number.parseInt(part || '0', 16) === 0)
    && Number.parseInt(groups[5] || '0', 16) === 65535
  ) {
    const a = Number.parseInt(groups[6] || '0', 16)
    const b = Number.parseInt(groups[7] || '0', 16)
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
  }

  return `${groups.slice(0, 4).map((part) => Number.parseInt(part || '0', 16).toString(16)).join(':')}::/64`
}
