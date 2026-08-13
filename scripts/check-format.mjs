import fs from 'node:fs'
import path from 'node:path'

const roots = ['src', 'scripts', 'ops', '.github']
const extensions = new Set(['.ts', '.js', '.mjs', '.json', '.md', '.yml', '.yaml'])
const failures = []
const walk = (directory) => {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(absolute)
    else if (extensions.has(path.extname(entry.name))) {
      const content = fs.readFileSync(absolute, 'utf8')
      const lines = content.split('\n')
      lines.forEach((line, index) => { if (/[ \t]+$/.test(line)) failures.push(`${absolute}:${index + 1}: trailing whitespace`) })
      if (content.length && !content.endsWith('\n')) failures.push(`${absolute}: missing final newline`)
    }
  }
}
roots.forEach(walk)
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('Formatting guard passed.')
