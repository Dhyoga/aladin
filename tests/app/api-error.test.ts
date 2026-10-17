import { describe, expect, it } from 'vitest'
import { errorMessage } from '../../app/utils/api-error'

describe('errorMessage', () => {
  it('prefers the message the server put in data.message', () => {
    const error = Object.assign(new Error('[POST] "/api/brands": 400 Bad Request'), {
      data: { statusCode: 400, message: 'URL must be a valid http or https address' }
    })
    expect(errorMessage(error)).toBe('URL must be a valid http or https address')
  })

  it('does not show the technical $fetch message', () => {
    expect(errorMessage(new Error('[POST] "/api/brands": 500 Internal Server Error'), 'Could not create the brand'))
      .toBe('Could not create the brand')
  })

  it('shows the message of an ordinary error', () => {
    expect(errorMessage(new Error('Network down'))).toBe('Network down')
  })

  it('falls back for anything else', () => {
    expect(errorMessage(undefined, 'fallback')).toBe('fallback')
    expect(errorMessage('boom', 'fallback')).toBe('fallback')
    expect(errorMessage({ data: { message: '' } }, 'fallback')).toBe('fallback')
  })
})
