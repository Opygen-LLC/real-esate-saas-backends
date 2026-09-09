import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const expected = String(pkg.packageManager || '').replace('pnpm@', '')
const actual = (process.env.npm_config_user_agent || '').match(/^pnpm\/([^ ]+)/)?.[1]

for (const forbidden of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock']) {
  if (existsSync(join(root, forbidden))) {
    console.error(`${forbidden} is not allowed. This repository is pnpm-only; remove the foreign lockfile.`)
    process.exit(1)
  }
}
if (!existsSync(join(root, 'pnpm-lock.yaml'))) {
  console.error('pnpm-lock.yaml is required for reproducible installs.')
  process.exit(1)
}
if (!expected || actual !== expected) {
  console.error(`Use pnpm ${expected}: corepack enable && corepack prepare pnpm@${expected} --activate; pnpm install --frozen-lockfile`)
  process.exit(1)
}
