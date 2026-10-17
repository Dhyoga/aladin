// Registers what happens when a post job completes (see job-handlers.ts).
export default defineNitroPlugin(() => {
  const { mediaDir } = useRuntimeConfig()
  registerJobHandler('post', createPostResultHandler({ db: getDb().db, mediaDir }))
})
