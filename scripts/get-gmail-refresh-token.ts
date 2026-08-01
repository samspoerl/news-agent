import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { OAuth2Client } from 'google-auth-library'

/**
 * One-time setup helper: obtains a long-lived Gmail refresh token via the OAuth
 * "installed app" loopback flow, so the headless agent can read and send mail
 * without ever showing a consent screen again.
 *
 * Prerequisites:
 *   - GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET set in .env (a Desktop-app OAuth
 *     client works with no redirect-URI registration; for a Web-application
 *     client, register `http://127.0.0.1:<REDIRECT_PORT>` as a redirect URI).
 *   - The agent account (the mailbox named by BRIEF_SENDER) is a Test user on the
 *     consent screen, or the app is published to production.
 *
 * Run:  pnpm gmail:token
 * Then copy the printed token into .env (GMAIL_REFRESH_TOKEN) and your GitHub
 * Actions secrets. Re-run only if you revoke access or change the password.
 */

// One scope is enough: gmail.modify covers reading + labeling newsletters AND
// sending the brief (Google grants read, compose, and send under gmail.modify).
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify']

// Loopback redirect. Any port is fine for a Desktop-app client; for a
// Web-application client this exact URI must be registered on the OAuth client.
const REDIRECT_PORT = 4796
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}`

// Give up if no redirect arrives (e.g. the browser tab is closed).
const TIMEOUT_MS = 5 * 60 * 1000

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name}. Set it in .env before running this script.`)
    process.exit(1)
  }
  return value
}

const successPage =
  '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem">' +
  '<h2>✅ Authorized</h2><p>Refresh token captured. Close this tab and return to the terminal.</p>'

const errorPage =
  '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem">' +
  '<h2>❌ Something went wrong</h2><p>Check the terminal for details.</p>'

async function main() {
  const clientId = requireEnv('GMAIL_CLIENT_ID')
  const clientSecret = requireEnv('GMAIL_CLIENT_SECRET')

  const oauth = new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri: REDIRECT_URI,
  })
  const state = randomBytes(16).toString('hex')

  const authUrl = oauth.generateAuthUrl({
    access_type: 'offline', // ask Google to issue a refresh token
    prompt: 'consent', // force a refresh token even if previously granted
    scope: SCOPES,
    state,
  })

  const refreshToken = await new Promise<string>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI)
      // Ignore stray requests (e.g. favicon) so we don't close early.
      if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
        res.writeHead(404, { Connection: 'close' }).end()
        return
      }

      try {
        const error = url.searchParams.get('error')
        if (error) throw new Error(`Authorization denied: ${error}`)
        if (url.searchParams.get('state') !== state) {
          throw new Error('State mismatch — possible CSRF, aborting.')
        }

        const { tokens } = await oauth.getToken(url.searchParams.get('code')!)
        res
          .writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' })
          .end(successPage)
        // close() stops listening but leaves established keep-alive sockets (the
        // browser's, plus any /favicon.ico probe) open, which keeps the event
        // loop — and the process — alive. Destroy them so the script exits.
        server.close()
        server.closeAllConnections()

        if (!tokens.refresh_token) {
          reject(
            new Error(
              'Google returned no refresh token. Revoke this app at ' +
                'https://myaccount.google.com/permissions, then run this again.'
            )
          )
          return
        }
        console.log('\nGranted scopes:', tokens.scope ?? '(unknown)')
        resolve(tokens.refresh_token)
      } catch (err) {
        res
          .writeHead(500, { 'Content-Type': 'text/html', Connection: 'close' })
          .end(errorPage)
        server.close()
        server.closeAllConnections()
        reject(err)
      }
    })

    server.on('error', reject)
    server.listen(REDIRECT_PORT, () => {
      // Name the account when .env already knows it — signing in as the wrong
      // one is the easy mistake here, and it isn't obvious until mail goes out
      // from the wrong address.
      const agentAccount = process.env.BRIEF_SENDER
      console.log(
        `Sign in as the AGENT account${agentAccount ? ` (${agentAccount})` : ''} and approve access.`
      )
      console.log(
        'If you see "Google hasn’t verified this app", click Advanced → Go to … (unsafe).\n'
      )
      console.log('Open this URL in your browser:\n')
      console.log(authUrl + '\n')
      console.log(`Waiting for the redirect on ${REDIRECT_URI} …`)
    })

    setTimeout(() => {
      server.close()
      reject(new Error('Timed out waiting for authorization.'))
    }, TIMEOUT_MS).unref()
  })

  console.log('\n' + '─'.repeat(60))
  console.log('GMAIL_REFRESH_TOKEN=' + refreshToken)
  console.log('─'.repeat(60))
  console.log('\nCopy this into .env and your GitHub Actions secrets.')
}

main().catch((err) => {
  console.error('\n' + (err instanceof Error ? err.message : String(err)))
  process.exit(1)
})
