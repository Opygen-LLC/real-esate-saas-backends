/** This guard must run before connecting or dropping a database in tests/fixtures. */
export const assertIsolatedTestDatabase = (raw: string | undefined): string => {
  if (!raw) throw new Error('TEST_DATABASE_URL is required; use compose.phase1-test.yml')
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Invalid TEST_DATABASE_URL') }
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !/^\/phase1_[a-zA-Z0-9_-]+$/.test(url.pathname) || url.searchParams.get('directConnection') !== 'true') {
    throw new Error('Tests/fixtures require a local mongodb:// URL, a phase1_* database name and directConnection=true. Refusing to access this database.')
  }
  return raw
}
