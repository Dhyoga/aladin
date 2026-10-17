import {
  DEFAULT_SHARED_SECRET,
  MIN_PRODUCTION_SECRET_LENGTH,
  RuntimeConfigSchema,
  type RuntimeConfig
} from '../../shared/schemas/runtime-config'

export interface AssertRuntimeConfigOptions {
  production: boolean
}

/**
 * Validates the runtime configuration and returns it typed.
 * Throws (so the server refuses to start) when it is invalid, or when it is
 * running in production with a missing/default/short shared secret.
 */
export function assertRuntimeConfig(config: unknown, options: AssertRuntimeConfigOptions): RuntimeConfig {
  const parsed = RuntimeConfigSchema.safeParse(config)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid runtime configuration: ${details}`)
  }

  const { sharedSecret } = parsed.data
  if (options.production
    && (sharedSecret === DEFAULT_SHARED_SECRET || sharedSecret.length < MIN_PRODUCTION_SECRET_LENGTH)) {
    throw new Error(
      `Refusing to start in production: NUXT_SHARED_SECRET must be set to a non-default value of at least ${MIN_PRODUCTION_SECRET_LENGTH} characters.`
    )
  }

  return parsed.data
}
