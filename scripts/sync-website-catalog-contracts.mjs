#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const index = args.indexOf('--frontend')
if (index === -1 || !args[index + 1]) throw new Error('Usage: node scripts/sync-website-catalog-contracts.mjs --frontend ../frontend [--check]')
const target = resolve(args[index + 1], 'src/contracts/generated/websiteCatalog')
const source = join(backend, 'src/contracts/websiteCatalog')
const check = args.includes('--check')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const files = (await readdir(source)).filter((name) => name.endsWith('.ts')).sort()
const manifest = { version: 1, authoritativeSource: 'backend/src/contracts/websiteCatalog', files: {} }
if (!check) await mkdir(target, { recursive: true })
for (const file of files) {
  const content = await readFile(join(source, file), 'utf8')
  const generated = `// GENERATED from backend/src/contracts/websiteCatalog/${file}; do not edit.\n${content}`
  manifest.files[file] = { sourceSha256: hash(content), generatedSha256: hash(generated) }
  if (check) {
    if (await readFile(join(target, file), 'utf8') !== generated) throw new Error(`Contract drift: ${file}. Regenerate from the backend.`)
  } else await writeFile(join(target, file), generated)
}
const json = `${JSON.stringify(manifest, null, 2)}\n`
for (const destination of [join(source, 'contract-manifest.json'), join(target, 'contract-manifest.json')]) {
  if (check) { if (await readFile(destination, 'utf8') !== json) throw new Error(`Manifest drift: ${destination}`) }
  else await writeFile(destination, json)
}
console.log(`${check ? 'Verified' : 'Generated'} ${files.length} canonical website/catalog contracts`)
