// Without this, HEAD requests fall through to the SPA renderer and answer 200 text/html.
// Node discards the body of a HEAD response, so the GET logic can be reused as is.
export default defineEventHandler((event) => {
  const relPath = getRouterParam(event, 'path') ?? ''
  return serveMedia(event, useRuntimeConfig(event).mediaDir, relPath)
})
