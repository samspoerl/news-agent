import { OAuth2Client } from 'google-auth-library'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(
      `Missing ${name} — set it in .env / Actions secrets before calling Gmail.`
    )
  return value
}

let client: OAuth2Client | undefined

/**
 * One shared OAuth2 client per run. The access token minted from
 * GMAIL_REFRESH_TOKEN is reused (and refreshed transparently) across every Gmail
 * call in a run — reading newsletters and sending the brief alike. The
 * gmail.modify scope granted to the refresh token covers both.
 */
export function getGmailClient(): OAuth2Client {
  if (client) return client
  const c = new OAuth2Client({
    clientId: requireEnv('GMAIL_CLIENT_ID'),
    clientSecret: requireEnv('GMAIL_CLIENT_SECRET'),
  })
  c.setCredentials({ refresh_token: requireEnv('GMAIL_REFRESH_TOKEN') })
  client = c
  return c
}
