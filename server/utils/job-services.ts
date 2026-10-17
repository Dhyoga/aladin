import { RuntimeConfigSchema } from '../../shared/schemas/runtime-config'
import type { AppDatabase } from './db'
import { startJob, type StartJobInput } from './job-dispatch'
import { applyJobCallback, type CallbackDeps } from './job-callback'
import { appHandlerRegistry } from './job-handlers'
import { createMockRunner } from './n8n-mock'
import { createN8nClient, type N8nClient } from './n8n-client'

export interface JobServices {
  db: AppDatabase['db']
  client: N8nClient
  sharedSecret: string
  callbackDeps: CallbackDeps
}

let services: JobServices | undefined

/** Wires the pipeline from runtimeConfig (live or mock client). Built once, on first use. */
export function getJobServices(): JobServices {
  if (services) return services

  const config = RuntimeConfigSchema.parse(useRuntimeConfig())
  const { db } = getDb()
  const callbackDeps: CallbackDeps = { db, registry: appHandlerRegistry }

  const client = createN8nClient({
    mode: config.n8nMode,
    baseUrl: config.n8nBaseUrl,
    secret: config.sharedSecret,
    appInternalUrl: config.appInternalUrl,
    mockRunner: config.n8nMode === 'mock'
      ? createMockRunner({ applyCallback: callback => applyJobCallback(callbackDeps, callback) })
      : undefined
  })

  services = { db, client, sharedSecret: config.sharedSecret, callbackDeps }
  return services
}

/** What the feature endpoints (brands, generations) call to start a job. */
export function dispatchJob(input: StartJobInput) {
  const { db, client } = getJobServices()
  return startJob({ db, client }, input)
}
