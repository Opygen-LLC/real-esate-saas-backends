import dotenv from 'dotenv'
import { assertIsolatedTestDatabase } from '../../app/db/isolatedTestDatabase'
// Load the same .env source before checking it; otherwise a later configuration
// import could introduce an unchecked TEST_DATABASE_URL.
dotenv.config()
// Existing integration suites drop databases. Reject an unsafe target before any
// test module (and before any configuration singleton) is imported.
if (process.env.TEST_DATABASE_URL) {
  assertIsolatedTestDatabase(process.env.TEST_DATABASE_URL)
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  process.env.NODE_ENV = 'test'
  process.env.REDIS_ENABLED = 'false'
  process.env.WORKER_ENABLED = 'false'
  process.env.SMS_DEV_MODE = 'true'
  process.env.EMAIL_DEV_MODE = 'true'
  process.env.TRUST_PROXY = 'false'
}
