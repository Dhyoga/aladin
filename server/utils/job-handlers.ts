import type { JobRow } from '../db/schema'
import type { JobType } from '../../shared/schemas/job'
import type { CallbackFileField, CompletedPayloadByType } from '../../shared/schemas/n8n-contracts'

/** A file received from n8n (parsed multipart) or produced by the mock. */
export interface CallbackFile {
  field: CallbackFileField
  filename: string
  mime: string
  data: Buffer
}

export type CallbackFiles = Partial<Record<CallbackFileField, CallbackFile>>

export interface ProgressContext {
  job: JobRow
  stage: string
  /** Parsed JSON payload when n8n sent one (e.g. the script on a video `script` stage). */
  payload: unknown
  files: CallbackFiles
}

export interface CompletedContext<T extends JobType> {
  job: JobRow
  stage: string | undefined
  /** Already validated against the contract for this job type. */
  payload: CompletedPayloadByType[T]
  files: CallbackFiles
}

/**
 * Persists what a job produced. Registered per job type by the changes that own the
 * target tables (brands, generations). The pipeline itself only manages job status.
 * Methods (not arrow properties) on purpose: it keeps handlers for different job types
 * assignable to one registry.
 */
export interface JobResultHandler<T extends JobType> {
  onProgress?(context: ProgressContext): void | Promise<void>
  onCompleted(context: CompletedContext<T>): void | Promise<void>
}

export interface HandlerRegistry {
  /** Registering a second handler for the same type replaces the first. */
  register<T extends JobType>(type: T, handler: JobResultHandler<T>): void
  get<T extends JobType>(type: T): JobResultHandler<T> | undefined
}

export function createHandlerRegistry(): HandlerRegistry {
  const handlers = new Map<JobType, JobResultHandler<JobType>>()

  return {
    register(type, handler) {
      handlers.set(type, handler as JobResultHandler<JobType>)
    },
    get<T extends JobType>(type: T) {
      return handlers.get(type) as JobResultHandler<T> | undefined
    }
  }
}

/** The application-wide registry, filled by Nitro plugins of the feature changes. */
export const appHandlerRegistry = createHandlerRegistry()

export function registerJobHandler<T extends JobType>(type: T, handler: JobResultHandler<T>): void {
  appHandlerRegistry.register(type, handler)
}
