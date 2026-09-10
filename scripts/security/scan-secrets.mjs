#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
const requireHistory = process.argv.includes('--require-history')
const scanHistory = process.argv.includes('--history') || requireHistory
const excludedDirs = new Set(['.git', 'node_modules', 'dist', '.next', 'out', 'build', 'coverage', '.turbo', '.cache'])
const maxFileBytes = 2 * 1024 * 1024
const findings = []

const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['GitHub token', /\bgh[pousr]_[0-9A-Za-z]{30,255}\b/],
  ['Stripe live secret', /\bsk_live_[0-9A-Za-z]{20,}\b/],
  ['Slack token', /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/],
  ['SendGrid API key', /\bSG\.[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{20,}\b/],
  ['database URL with embedded credentials', /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s/:<>]+:[^\s@<>]+@[^\s]+/i],
]

const forbiddenFile = (relative) => {
  const normalized = relative.replace(/\\/g, '/')
  const base = path.posix.basename(normalized).toLowerCase()
  if (base === '.env.example') return false
  if (base === '.env' || base.startsWith('.env.')) return true
  if (/\.(?:pem|key|p12|pfx|jks)$/i.test(base)) return true
  if (/(?:service[-_]?account|credentials?|private[-_]?key).*(?:\.json)$/i.test(base)) return true
  return false
}

const looksPlaceholder = (line) => /(?:example|placeholder|change[-_ ]?me|dummy|test[-_ ]?only|user:password|your[-_]|<[^>]+>|localhost|127\.0\.0\.1)/i.test(line)

function inspectText(text, source) {
  for (const [name, pattern] of secretPatterns) {
    const match = text.match(pattern)
    if (!match) continue
    const sample = match[0]
    if (looksPlaceholder(sample)) continue
    findings.push(`${source}: possible ${name}`)
  }
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirs.has(entry.name)) continue
    const absolute = path.join(dir, entry.name)
    const relative = path.relative(root, absolute)
    if (entry.isDirectory()) {
      await walk(absolute)
      continue
    }
    if (!entry.isFile()) continue
    if (forbiddenFile(relative)) findings.push(`${relative}: secret-bearing filename must not be committed`)
    const info = await stat(absolute)
    if (info.size > maxFileBytes) continue
    const buffer = await readFile(absolute)
    if (buffer.includes(0)) continue
    inspectText(buffer.toString('utf8'), relative)
  }
}

async function gitAvailable() {
  return await new Promise((resolve) => {
    const child = spawn('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0 && output.trim() === 'true'))
  })
}

async function inspectGitHistory() {
  const available = await gitAvailable()
  if (!available) {
    if (requireHistory) {
      console.error('Full Git history is unavailable. Run this gate from a real git checkout with fetch-depth: 0.')
      process.exitCode = 2
    } else {
      console.warn('Git history unavailable; scanned the extracted working tree only.')
    }
    return
  }

  await new Promise((resolve, reject) => {
    const child = spawn('git', ['log', '--all', '--full-history', '--no-renames', '--format=commit %H', '-p', '--no-ext-diff', '--no-color'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let carry = ''
    let currentFile = ''
    let commit = ''
    child.stdout.on('data', (chunk) => {
      carry += chunk.toString('utf8')
      const lines = carry.split('\n')
      carry = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('commit ')) commit = line.slice(7).trim()
        if (line.startsWith('diff --git ')) {
          const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
          currentFile = match?.[2] || ''
          if (currentFile && forbiddenFile(currentFile)) findings.push(`${commit}:${currentFile}: secret-bearing file existed in Git history`)
          continue
        }
        if (!line.startsWith('+') && !line.startsWith('-')) continue
        if (line.startsWith('+++') || line.startsWith('---')) continue
        inspectText(line.slice(1), `${commit}:${currentFile || 'unknown-file'}`)
      }
    })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`git log exited with ${code}`)))
  })
}

await walk(root)
if (scanHistory) await inspectGitHistory()

const unique = [...new Set(findings)]
if (unique.length) {
  console.error(`Secret scan failed with ${unique.length} finding(s):`)
  for (const finding of unique) console.error(` - ${finding}`)
  process.exitCode = 1
} else if (!process.exitCode) {
  console.log(scanHistory ? 'Secret scan passed for working tree and available Git history.' : 'Secret scan passed for working tree.')
}
