// Registers what happens when a video job progresses and completes (see job-handlers.ts).
export default defineNitroPlugin(() => {
  const { mediaDir } = useRuntimeConfig()
  registerJobHandler('video', createVideoResultHandler({ db: getDb().db, mediaDir }))
})
