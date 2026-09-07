import mongoose, { type ClientSession } from 'mongoose'
import ApiError from '../../errors/ApiError'
import { mongoSupportsTransactions } from './mongoCapabilities'

/** Sensitive writes never fall back to a partially committed standalone operation. */
export const requiredTransaction = async <T>(work: (session: ClientSession) => Promise<T>): Promise<T> => {
  if (!(await mongoSupportsTransactions())) {
    throw new ApiError(503, 'This operation requires a MongoDB replica set or mongos', '', 'TRANSACTIONS_REQUIRED')
  }
  const session = await mongoose.startSession()
  try {
    let result: T | undefined
    await session.withTransaction(async () => {
      // The driver can re-run the callback after a write conflict. Callers must
      // perform no network delivery and must recreate their state per attempt.
      result = await work(session)
      if (result === undefined) throw new ApiError(500, 'The transaction callback did not return a result', '', 'TRANSACTION_INCOMPLETE')
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary', maxCommitTimeMS: 15000 })
    if (result === undefined) throw new ApiError(500, 'The transaction did not complete', '', 'TRANSACTION_INCOMPLETE')
    return result
  } finally {
    await session.endSession()
  }
}
