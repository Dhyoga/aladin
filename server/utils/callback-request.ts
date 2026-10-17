import { createError, getRequestHeader, readMultipartFormData, type H3Event } from 'h3'
import { MAX_CALLBACK_REQUEST_BYTES } from '../../shared/schemas/n8n-contracts'
import {
  applyJobCallback,
  CallbackFieldsError,
  parseCallbackParts,
  type CallbackDeps
} from './job-callback'
import { assertInternalRequest } from './secret'

export interface CallbackRequestDeps {
  sharedSecret: string
  callbackDeps: CallbackDeps
}

/**
 * POST /api/n8n/callback. Order matters: the proxy and secret checks run before the
 * body is read, so unauthenticated callers cannot make the app buffer large uploads.
 */
export async function handleCallbackRequest(event: H3Event, deps: CallbackRequestDeps) {
  assertInternalRequest(event, deps.sharedSecret)

  const declared = Number(getRequestHeader(event, 'content-length'))
  if (Number.isFinite(declared) && declared > MAX_CALLBACK_REQUEST_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
  }

  const parts = await readMultipartFormData(event)
  if (!parts) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Expected multipart/form-data' })
  }

  let callback
  try {
    callback = parseCallbackParts(parts)
  } catch (error) {
    if (error instanceof CallbackFieldsError) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: error.message })
    }
    throw error
  }

  const result = await applyJobCallback(deps.callbackDeps, callback)
  if (result.outcome === 'not_found') {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }

  // Ignored (job already final) is still a 2xx so n8n does not retry.
  return { ok: true, status: result.job.status }
}
