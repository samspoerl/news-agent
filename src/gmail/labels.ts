import { getGmailClient } from '@/gmail/client'

// Gmail REST endpoints for the authenticated user ("me").
const LABELS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/labels'
const BATCH_MODIFY_URL =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify'

// The label applied to newsletter emails once a brief has been sent from them.
// A user label (not a Gmail system one), created on first use. Rename here — the
// label is resolved by name each run, so a rename just mints/points at the new one.
export const PROCESSED_LABEL = 'PROCESSED'

// Gmail's own label id for the inbox. Removing it archives a message.
const INBOX_LABEL_ID = 'INBOX'

// The slice of Gmail's Label resource we read: name → id.
interface GmailLabel {
  id: string
  name: string
}

/**
 * Resolve a user label's id by name, creating the label if it doesn't exist yet.
 * Gmail's modify API keys on label ids, not names, so every run first maps the
 * configured name to its id — minting the label once, on the first run that marks
 * anything processed.
 */
export async function ensureLabel(name: string): Promise<string> {
  const client = getGmailClient()
  const { data } = await client.request<{ labels?: GmailLabel[] }>({
    url: LABELS_URL,
  })
  const existing = (data.labels ?? []).find((label) => label.name === name)
  if (existing) return existing.id

  const { data: created } = await client.request<GmailLabel>({
    url: LABELS_URL,
    method: 'POST',
    data: {
      name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  })
  return created.id
}

/**
 * Mark newsletter emails as processed: add the PROCESSED label and remove INBOX
 * (archive) in one batch call. Called only after a brief has been sent and
 * persisted, so an email leaves the inbox exactly when the run that used it
 * succeeded — and the next run's `in:inbox` search skips it. A no-op on an empty
 * id list; up to Gmail's 1000-id batch limit (well above the per-run message cap).
 */
export async function markProcessed(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return
  const labelId = await ensureLabel(PROCESSED_LABEL)
  await getGmailClient().request({
    url: BATCH_MODIFY_URL,
    method: 'POST',
    data: {
      ids: messageIds,
      addLabelIds: [labelId],
      removeLabelIds: [INBOX_LABEL_ID],
    },
  })
}
