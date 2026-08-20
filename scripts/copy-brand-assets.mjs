import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const source = resolve(process.cwd(), 'src/assets/branding')
const destination = resolve(process.cwd(), 'dist/assets/branding')
await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true, force: true })
