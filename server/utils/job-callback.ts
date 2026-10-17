import type { JobRow } from '../db/schema'
import { isFinalStatus } from '../../shared/schemas/job'
import {
  CALLBACK_FILE_FIELDS,
  CALLBACK_FILE_LIMITS_BYTES,
  CallbackFields,
  COMPLETED_PAYLOAD_SCHEMAS,
  REQUIRED_COMPLETED_FILES,
  VideoCompleted,
  type CallbackFileField
} from '../../shared/schemas/n8n-contracts'
import type { AppDatabase } from './db'
import type { CallbackFile, CallbackFiles, HandlerRegistry } from './job-handlers'
import { completeJob, failJob, getJob, getJobWithTimeout, markRunning, updateStage } from './jobs'
import { describeIssues } from './zod-issues'

type Db = AppDatabase['db']

export interface ParsedCallback {
  jobId: string
  event: 'progress' | 'completed' | 'failed'
  stage?: string
  payload?: string
  error?: string
  files: CallbackFiles
}

/** One part of a multipart body, as returned by h3's readMultipartFormData. */
export interface RawPart {
  name?: string
  filename?: string
  type?: string
  data: Buffer
}

/** The text fields of the callback are invalid (maps to HTTP 400). */
export class CallbackFieldsError extends Error {}

const FILE_FIELDS: readonly string[] = CALLBACK_FILE_FIELDS

/**
 * Turns multipart parts into a ParsedCallback. Parts without a filename are text fields,
 * parts with one are files (only the whitelisted names are kept, others are ignored).
 * Empty optional text fields are treated as absent.
 */
export function parseCallbackParts(parts: RawPart[]): ParsedCallback {
  const fields: Record<string, string> = {}
  const files: CallbackFiles = {}

  for (const part of parts) {
    if (!part.name) continue
    if (part.filename === undefined) {
      const value = part.data.toString('utf8')
      if (value !== '') fields[part.name] = value
    } else if (FILE_FIELDS.includes(part.name)) {
      const field = part.name as CallbackFileField
      files[field] = {
        field,
        filename: part.filename,
        mime: part.type || 'application/octet-stream',
        data: part.data
      }
    }
  }

  const parsed = CallbackFields.safeParse(fields)
  if (!parsed.success) {
    throw new CallbackFieldsError(describeIssues(parsed.error.issues))
  }

  const { job_id: jobId, event, stage, payload, error } = parsed.data
  return { jobId, event, stage, payload, error, files }
}

export interface CallbackDeps {
  db: Db
  registry: HandlerRegistry
  now?: () => number
}

export type CallbackOutcome
  = | { outcome: 'not_found' }
    | { outcome: 'ignored', job: JobRow }
    | { outcome: 'applied', job: JobRow }

// Job ids whose `completed` handler is running right now. A retry from n8n that arrives
// meanwhile is ignored instead of running the handler twice. Single process only.
const completing = new Set<string>()

/**
 * The one place where a callback changes job state. Used by the HTTP endpoint and by
 * the mock, so both behave identically.
 */
export async function applyJobCallback(deps: CallbackDeps, callback: ParsedCallback): Promise<CallbackOutcome> {
  const now = deps.now ?? Date.now

  const job = getJobWithTimeout(deps.db, callback.jobId, now())
  if (!job) return { outcome: 'not_found' }
  if (isFinalStatus(job.status)) return { outcome: 'ignored', job }

  switch (callback.event) {
    case 'failed':
      failJob(deps.db, job.id, callback.error?.trim() || 'unknown_error', now())
      break
    case 'progress':
      await applyProgress(deps, job, callback)
      break
    case 'completed':
      if (completing.has(job.id)) return { outcome: 'ignored', job }
      completing.add(job.id)
      try {
        await applyCompleted(deps, job, callback)
      } finally {
        completing.delete(job.id)
      }
      break
  }

  return { outcome: 'applied', job: getJob(deps.db, job.id) ?? job }
}

async function applyProgress(deps: CallbackDeps, job: JobRow, callback: ParsedCallback): Promise<void> {
  const now = deps.now ?? Date.now

  const invalidFile = findOversizedFile(callback.files)
  if (invalidFile) return void failJob(deps.db, job.id, `invalid_payload: ${invalidFile}`, now())

  let payload: unknown
  if (callback.payload !== undefined) {
    const parsed = parseJson(callback.payload)
    if (!parsed.ok) return void failJob(deps.db, job.id, 'invalid_payload: payload is not valid JSON', now())
    payload = parsed.value

    if (job.type === 'video' && callback.stage === 'script') {
      const script = VideoCompleted.safeParse(payload)
      if (!script.success) {
        return void failJob(deps.db, job.id, `invalid_payload: ${describeIssues(script.error.issues)}`, now())
      }
    }
  }

  // The first callback can overtake the dispatch response, so a queued job is accepted too.
  if (!markRunning(deps.db, job.id, now(), callback.stage) && callback.stage) {
    updateStage(deps.db, job.id, callback.stage, now())
  }

  const handler = deps.registry.get(job.type)
  if (!handler?.onProgress || !callback.stage) return

  try {
    await handler.onProgress({
      job: getJob(deps.db, job.id) ?? job,
      stage: callback.stage,
      payload,
      files: callback.files
    })
  } catch (error) {
    failJob(deps.db, job.id, `handler_failed: ${errorMessage(error)}`, now())
  }
}

async function applyCompleted(deps: CallbackDeps, job: JobRow, callback: ParsedCallback): Promise<void> {
  const now = deps.now ?? Date.now
  const fail = (reason: string) => void failJob(deps.db, job.id, reason, now())

  const oversized = findOversizedFile(callback.files)
  if (oversized) return fail(`invalid_payload: ${oversized}`)

  for (const field of REQUIRED_COMPLETED_FILES[job.type] as readonly CallbackFileField[]) {
    if (!callback.files[field]) return fail(`invalid_payload: missing required file "${field}"`)
  }

  if (callback.payload === undefined) return fail('invalid_payload: payload is required')
  const json = parseJson(callback.payload)
  if (!json.ok) return fail('invalid_payload: payload is not valid JSON')

  const validated = COMPLETED_PAYLOAD_SCHEMAS[job.type].safeParse(json.value)
  if (!validated.success) return fail(`invalid_payload: ${describeIssues(validated.error.issues)}`)

  const handler = deps.registry.get(job.type)
  if (!handler) return fail('no_result_handler')

  try {
    await handler.onCompleted({
      job: getJob(deps.db, job.id) ?? job,
      stage: job.stage ?? undefined,
      payload: validated.data,
      files: callback.files
    })
  } catch (error) {
    return fail(`handler_failed: ${errorMessage(error)}`)
  }

  // False when the job timed out while the handler ran; the timeout then stands.
  completeJob(deps.db, job.id, now())
}

function findOversizedFile(files: CallbackFiles): string | undefined {
  for (const file of Object.values(files) as CallbackFile[]) {
    const limit = CALLBACK_FILE_LIMITS_BYTES[file.field]
    if (file.data.length > limit) {
      return `file "${file.field}" exceeds the ${limit / (1024 * 1024)} MB limit`
    }
  }
  return undefined
}

function parseJson(text: string): { ok: true, value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
