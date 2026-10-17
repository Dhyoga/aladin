import { z } from 'zod'

export const DEFAULT_SHARED_SECRET = 'dev-secret'
export const MIN_PRODUCTION_SECRET_LENGTH = 32

export const N8N_MODES = ['mock', 'live'] as const

const urlSchema = z.url()

export const RuntimeConfigSchema = z
  .object({
    databasePath: z.string().min(1),
    mediaDir: z.string().min(1),
    n8nMode: z.enum(N8N_MODES),
    n8nBaseUrl: z.string(),
    appInternalUrl: z.string(),
    sharedSecret: z.string().min(1)
  })
  .superRefine((config, ctx) => {
    // In live mode the app really calls n8n, so both URLs must be usable.
    if (config.n8nMode !== 'live') return
    for (const key of ['n8nBaseUrl', 'appInternalUrl'] as const) {
      if (!urlSchema.safeParse(config[key]).success) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'must be a valid URL when n8nMode is "live"'
        })
      }
    }
  })

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>
