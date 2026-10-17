export default defineEventHandler((event) => {
  const { sharedSecret, callbackDeps } = getJobServices()
  return handleCallbackRequest(event, { sharedSecret, callbackDeps })
})
