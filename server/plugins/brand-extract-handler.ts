// Registers what happens when a brand_extract job completes (see job-handlers.ts).
export default defineNitroPlugin(() => {
  const { mediaDir } = useRuntimeConfig()
  registerJobHandler('brand_extract', createBrandExtractHandler({ db: getDb().db, mediaDir }))
})
