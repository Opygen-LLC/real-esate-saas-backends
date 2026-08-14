import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import sendEmail from '../../helpers/sendEmail'

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

const shell = (heading: string, intro: string, code: string, footer: string) => `
  <div style="margin:0;background:#f5f5f4;padding:32px 16px;font-family:Inter,Arial,sans-serif;color:#18181b">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:18px;overflow:hidden">
      <div style="padding:28px 30px 16px">
        <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#71717a">Real Estate SaaS</div>
        <h1 style="font-size:24px;line-height:1.25;margin:12px 0 8px">${escapeHtml(heading)}</h1>
        <p style="font-size:14px;line-height:1.7;color:#52525b;margin:0">${escapeHtml(intro)}</p>
      </div>
      <div style="padding:10px 30px 24px">
        <div style="background:#18181b;color:#ffffff;border-radius:14px;padding:18px;text-align:center;font-size:32px;font-weight:800;letter-spacing:.32em">${escapeHtml(code)}</div>
        <p style="font-size:12px;line-height:1.6;color:#71717a;margin:14px 0 0">This code expires in 5 minutes and can only be used once.</p>
      </div>
      <div style="border-top:1px solid #f0efed;padding:18px 30px 24px;font-size:12px;line-height:1.6;color:#71717a">${escapeHtml(footer)}</div>
    </div>
  </div>`

const deliver = async (to: string, subject: string, html: string): Promise<void> => {
  const sent = await sendEmail(to, subject, html)
  if (!sent) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Verification email could not be delivered. Please try again shortly.', '', 'EMAIL_DELIVERY_UNAVAILABLE')
}

export const sendAccountVerificationEmail = async (input: { email: string; code: string; name?: string; agencyName?: string }) => {
  const recipient = input.name?.trim() || 'there'
  const agency = input.agencyName?.trim() || 'your agency'
  await deliver(
    input.email,
    'Verify your Real Estate SaaS account',
    shell(
      'Verify your email',
      `Hi ${recipient}, use this code to activate ${agency} and finish creating your agency workspace.`,
      input.code,
      'If you did not create this account, you can safely ignore this email.',
    ),
  )
}

export const sendPasswordResetEmail = async (input: { email: string; code: string; name?: string }) => {
  const recipient = input.name?.trim() || 'there'
  await deliver(
    input.email,
    'Reset your Real Estate SaaS password',
    shell(
      'Reset your password',
      `Hi ${recipient}, use this verification code to continue your password reset.`,
      input.code,
      'If you did not request a password reset, you can ignore this email and your password will remain unchanged.',
    ),
  )
}
