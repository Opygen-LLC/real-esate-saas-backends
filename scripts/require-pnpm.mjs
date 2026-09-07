import { readFileSync } from 'node:fs'
const { packageManager } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const expected = packageManager.replace('pnpm@', '')
const actual = (process.env.npm_config_user_agent || '').match(/^pnpm\/([^ ]+)/)?.[1]
if (actual !== expected) {
  console.error(`Use pnpm ${expected}: corepack enable && corepack prepare pnpm@${expected} --activate; pnpm install --frozen-lockfile`)
  process.exit(1)
}
