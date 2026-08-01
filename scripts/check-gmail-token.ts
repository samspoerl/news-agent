import 'dotenv/config'
import { OAuth2Client } from 'google-auth-library'

/**
 * Minimal read to prove a Gmail refresh token still works: fetch the mailbox
 * profile. Handy for confirming a rotated or revoked token is actually dead.
 *
 * Tests process.env.GMAIL_REFRESH_TOKEN. Because dotenv does not override an
 * already-set variable, you can check a specific token without editing .env —
 * set it inline for the one run:
 *
 *   PowerShell:  $env:GMAIL_REFRESH_TOKEN="1//old…"; pnpm gmail:check
 *   bash:        GMAIL_REFRESH_TOKEN="1//old…" pnpm gmail:check
 *
 * Run:  pnpm gmail:check
 * Exits 0 if the token is valid, 1 if the read fails (e.g. invalid_grant).
 */

const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name}. Set it in .env before running this script.`)
    process.exit(1)
  }
  return value
}

async function main() {
  const oauth = new OAuth2Client({
    clientId: requireEnv('GMAIL_CLIENT_ID'),
    clientSecret: requireEnv('GMAIL_CLIENT_SECRET'),
  })
  oauth.setCredentials({ refresh_token: requireEnv('GMAIL_REFRESH_TOKEN') })

  const { data } = await oauth.request<{
    emailAddress: string
    messagesTotal: number
  }>({
    url: PROFILE_URL,
  })

  console.log('✅ Refresh token is VALID.')
  console.log(`   Mailbox:  ${data.emailAddress}`)
  console.log(`   Messages: ${data.messagesTotal}`)
}

main().catch((err) => {
  // invalid_grant is Google's response for a revoked, expired, or malformed token.
  const detail =
    (err as { response?: { data?: { error?: string } } })?.response?.data
      ?.error ?? (err instanceof Error ? err.message : String(err))
  if (detail === 'invalid_grant') {
    console.error('❌ Refresh token is INVALID (auth rejected: invalid_grant).')
  } else {
    console.error('❌ Gmail read failed:', detail)
  }
  process.exit(1)
})
