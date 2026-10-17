import type { JobRow } from '../db/schema'
import type { JobType } from '../../shared/schemas/job'
import {
  N8N_WEBHOOK_PATHS,
  WEBHOOK_REQUEST_SCHEMAS,
  type WebhookRequestByType
} from '../../shared/schemas/n8n-contracts'
import { describeIssues } from './zod-issues'

/** Domain input per job type. The envelope and fixed fields are added by buildWebhookRequest. */
export type BrandExtractInput
  = | { source_type: 'url', url: string }
    | { source_type: 'pdf', pdf_asset_id: string }

export type PostInput = Pick<WebhookRequestByType['post'], 'brand_dna' | 'prompt' | 'aspect_ratio' | 'assets'>

export type VideoInput = Pick<WebhookRequestByType['video'], 'brand_dna' | 'prompt' | 'post' | 'assets'>

export type DispatchInput = BrandExtractInput | PostInput | VideoInput

/** A webhook body that already passed the contract. */
export type WebhookRequest = WebhookRequestByType[JobType]

/** Runs a simulated n8n in mock mode (see n8n-mock.ts). */
export interface MockRunner {
  run(job: JobRow, request: WebhookRequest): Promise<void>
}

export interface N8nClient {
  /** Resolves once n8n accepted the job (or the mock took over). Throws otherwise. */
  dispatch(job: JobRow, input: DispatchInput): Promise<void>
}

export interface N8nClientOptions {
  mode: 'mock' | 'live'
  baseUrl: string
  secret: string
  appInternalUrl: string
  fetchFn?: typeof fetch
  mockRunner?: MockRunner
  timeoutMs?: number
}

export const N8N_REQUEST_TIMEOUT_MS = 15_000

const trimTrailingSlashes = (url: string) => url.replace(/\/+$/, '')

/** Builds and validates the JSON body for the webhook of `type`. Throws on invalid input. */
export function buildWebhookRequest(
  type: JobType,
  jobId: string,
  appInternalUrl: string,
  input: DispatchInput
): WebhookRequest {
  const base = trimTrailingSlashes(appInternalUrl)
  const body = {
    job_id: jobId,
    callback_url: `${base}/api/n8n/callback`,
    asset_base_url: `${base}/api/internal/assets`,
    ...input,
    ...(type === 'video' ? { duration_seconds: 10, aspect_ratio: '9:16' } : {})
  }

  const parsed = WEBHOOK_REQUEST_SCHEMAS[type].safeParse(body)
  if (!parsed.success) {
    throw new Error(`Invalid ${type} dispatch input: ${describeIssues(parsed.error.issues)}`)
  }
  return parsed.data
}

export function createN8nClient(options: N8nClientOptions): N8nClient {
  const fetchFn = options.fetchFn ?? fetch
  const timeoutMs = options.timeoutMs ?? N8N_REQUEST_TIMEOUT_MS

  // Never let the shared secret end up in an error message (and from there in the DB or logs).
  const redact = (message: string) => (options.secret ? message.replaceAll(options.secret, '***') : message)

  return {
    async dispatch(job, input) {
      const request = buildWebhookRequest(job.type, job.id, options.appInternalUrl, input)

      if (options.mode === 'mock') {
        const runner = options.mockRunner
        if (!runner) throw new Error('n8n mock mode needs a mock runner')
        // Fire and forget, like a real n8n that answers immediately and works in the background.
        void runner.run(job, request).catch((error: unknown) => {
          console.error('[n8n-mock] scenario crashed:', error)
        })
        return
      }

      const url = `${trimTrailingSlashes(options.baseUrl)}/webhook/${N8N_WEBHOOK_PATHS[job.type]}`

      let response: Response
      try {
        response = await fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Aladin-Secret': options.secret },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(timeoutMs)
        })
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new Error(`n8n request timed out after ${timeoutMs / 1000}s`, { cause: error })
        }
        const cause = error instanceof Error ? error.message : String(error)
        // No `cause` here on purpose: the original error is not redacted and may contain the secret.
        // eslint-disable-next-line preserve-caught-error
        throw new Error(redact(`n8n request failed: ${cause}`))
      }

      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).trim().slice(0, 200)
        throw new Error(redact(`n8n responded ${response.status}${detail ? `: ${detail}` : ''}`))
      }

      // The body is irrelevant ("Respond Immediately"); release the connection.
      await response.body?.cancel().catch(() => {})
    }
  }
}
