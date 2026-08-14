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

console.log('=== Checking SMTP Configuration ===')
console.log(`EMAIL_DEV_MODE: ${process.env.EMAIL_DEV_MODE}`)
console.log(`SMTP_HOST: ${host || '(not set)'}`)
console.log(`SMTP_PORT: ${port}`)
console.log(`SMTP_SECURE: ${secure}`)
console.log(`SMTP_USER: ${user || '(not set)'}`)
console.log(`SMTP_PASSWORD: ${pass ? '***** (set)' : '(not set)'}`)
console.log(`SMTP_FROM: ${from || '(not set)'}`)

if (!host || !user || !pass || !from) {
  console.error('\n❌ ERROR: SMTP credentials are missing or commented out in .env!')
  console.error('To send real emails, set EMAIL_DEV_MODE=false and set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM in .env.')
  process.exit(1)
}

if (process.env.EMAIL_DEV_MODE === 'true') {
  console.warn('\n⚠️ WARNING: EMAIL_DEV_MODE is set to true in .env.')
  console.warn('Real emails WILL NOT be sent to inboxes while EMAIL_DEV_MODE=true.')
  console.warn('Set EMAIL_DEV_MODE=false in .env to send real emails via SMTP.\n')
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: { user, pass },
})

console.log('Testing SMTP connection with Nodemailer...')
transporter.verify((err) => {
  if (err) {
    console.error('\n❌ SMTP Connection Failed:', err.message)
    process.exit(1)
  } else {
    console.log('\n✅ SMTP Connection Successful! Server is ready to send emails.')
    process.exit(0)
  }
})
