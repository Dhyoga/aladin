export default defineEventHandler((event) => {
  const relPath = getRouterParam(event, 'path') ?? ''
  return serveMedia(event, useRuntimeConfig(event).mediaDir, relPath)
})
