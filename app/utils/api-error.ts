/**
 * A readable message from whatever a failed `$fetch` (or any other call) threw.
 * The server puts the text to show in `data.message` (see AGENTS.md); `$fetch` wraps it.
 */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error && typeof error === 'object') {
    const data = (error as { data?: unknown }).data
    if (data && typeof data === 'object') {
      const message = (data as { message?: unknown }).message
      if (typeof message === 'string' && message) return message
    }
    const message = (error as { message?: unknown }).message
    // $fetch messages look like `[POST] "/api/x": 400 Bad Request`; they say nothing useful to a user.
    if (typeof message === 'string' && message && !/^\[[A-Z]+\] "/.test(message)) return message
  }
  return fallback
}
