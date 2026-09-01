import dotenv from 'dotenv'
import path from 'path'
import nodemailer from 'nodemailer'

dotenv.config({ path: path.join(process.cwd(), '.env') })

const host = process.env.SMTP_HOST?.trim()
const port = Number(process.env.SMTP_PORT || 587)
const secure = process.env.SMTP_SECURE === 'true'
const user = process.env.SMTP_USER?.trim() || process.env.APP_EMAIL?.trim()
const pass = process.env.SMTP_PASSWORD?.trim() || process.env.APP_PASSWORD?.trim()
const from = process.env.SMTP_FROM?.trim() || user
const developmentMode = process.env.EMAIL_DEV_MODE === 'true'

console.log('=== Checking SMTP Configuration ===')
console.log(`EMAIL_DEV_MODE: ${developmentMode}`)
console.log(`SMTP_HOST: ${host || '(not set)'}`)
console.log(`SMTP_PORT: ${port}`)
console.log(`SMTP_SECURE: ${secure}`)
console.log(`SMTP_USER: ${user || '(not set)'}`)
console.log(`SMTP_PASSWORD: ${pass ? '***** (set)' : '(not set)'}`)
console.log(`SMTP_FROM: ${from || '(not set)'}`)

if (developmentMode) {
  console.error('\n❌ EMAIL_DEV_MODE=true: application email delivery is simulated and no real OTP email will be sent.')
  console.error('Set EMAIL_DEV_MODE=false in the deployment environment before running npm run test:smtp.')
  process.exit(2)
}

if (!host || !user || !pass || !from) {
  console.error('\n❌ SMTP credentials are incomplete.')
  console.error('Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM and EMAIL_DEV_MODE=false.')
  process.exit(1)
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 5000),
  greetingTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 5000),
  socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 10000),
  auth: { user, pass },
})

console.log('Testing SMTP connection with Nodemailer...')
try {
  await transporter.verify()
  console.log('\n✅ SMTP connection successful. The deployment is configured for real email delivery.')
  process.exit(0)
} catch (error) {
  const responseCode = Number(error?.responseCode || 0)
  const rawCode = String(error?.code || '').toUpperCase()
  const category = rawCode === 'EAUTH' || responseCode === 535 || responseCode === 534
    ? 'SMTP_AUTH_FAILED'
    : responseCode >= 400
      ? 'SMTP_PROVIDER_REJECTED'
      : 'SMTP_CONNECTION_FAILED'
  console.error(`\n❌ ${category}: ${error?.message || 'SMTP verification failed'}`)
  process.exit(1)
}
