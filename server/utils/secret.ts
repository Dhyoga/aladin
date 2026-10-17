import { createHash, timingSafeEqual } from 'node:crypto'
import { createError, getRequestHeader, type H3Event } from 'h3'

/**
 * Constant-time comparison. Both values are hashed first so `timingSafeEqual` always
 * gets equal-length buffers and the length of the real secret does not leak.
 */
export function safeEqualSecret(supplied: string, expected: string): boolean {
  const a = createHash('sha256').update(supplied).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * Guard for endpoints that only n8n may call (callback, internal assets).
 * - 404 when the request came through the public proxy (it carries X-Forwarded-Host;
 *   n8n calls the app directly over the internal network and never sets it).
 * - 401 when X-Aladin-Secret is missing or wrong.
 * Call it before reading the request body.
 */
export function assertInternalRequest(event: H3Event, expectedSecret: string): void {
  if (getRequestHeader(event, 'x-forwarded-host')) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  const supplied = getRequestHeader(event, 'x-aladin-secret')
  if (!supplied || !safeEqualSecret(supplied, expectedSecret)) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
}
