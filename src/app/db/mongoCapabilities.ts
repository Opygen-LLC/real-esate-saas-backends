import mongoose from 'mongoose'

let transactionsSupported: boolean | null = null

/**
 * MongoDB multi-document transactions require a replica set member or mongos.
 * Standalone MongoDB servers support sessions, but not transactions.
 *
 * Cache the topology capability for the life of the process; changing topology
 * should be accompanied by an application restart in production.
 */
export const mongoSupportsTransactions = async (): Promise<boolean> => {
  if (transactionsSupported !== null) return transactionsSupported

  const db = mongoose.connection.db
  if (!db) {
    transactionsSupported = false
    return transactionsSupported
  }

  try {
    const hello = await db.admin().command({ hello: 1 }) as { setName?: string; msg?: string }
    transactionsSupported = Boolean(hello.setName || hello.msg === 'isdbgrid')
  } catch {
    // If topology discovery is unavailable, do not attempt a transaction that
    // would turn a recoverable request into a MongoDB TransactionNumbers error.
    transactionsSupported = false
  }

  return transactionsSupported
}

export const resetMongoCapabilitiesCacheForTests = (): void => {
  transactionsSupported = null
}
