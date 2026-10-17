export default defineNitroPlugin(() => {
  assertRuntimeConfig(useRuntimeConfig(), { production: process.env.NODE_ENV === 'production' })
})
