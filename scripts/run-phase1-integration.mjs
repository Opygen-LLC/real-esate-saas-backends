import { spawnSync } from 'node:child_process';
const raw = process.env.TEST_DATABASE_URL;
let url;
try { url = new URL(raw); } catch { throw new Error('Set TEST_DATABASE_URL using compose.phase1-test.yml first'); }
if (url.protocol !== 'mongodb:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) ||
    !/^\/phase1_[a-zA-Z0-9_-]+$/.test(url.pathname) || url.searchParams.get('directConnection') !== 'true') {
  throw new Error('Refusing unsafe integration database. Only local phase1_* databases with directConnection=true are allowed.');
}
const args = ['exec', 'vitest', 'run',
  'src/tests/integration/phase1AtomicOperations.integration.test.ts',
  'src/tests/integration/ownerSafeDeletionPhase1.integration.test.ts',
  'src/tests/integration/phase2PublicForms.integration.test.ts',
  'src/tests/integration/tenantIsolation.integration.test.ts'];
const result = spawnSync('pnpm', args, { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: raw,
  WORKER_ENABLED: 'false', REDIS_ENABLED: 'false', SMS_DEV_MODE: 'true', EMAIL_DEV_MODE: 'true', TRUST_PROXY: 'false' } });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
