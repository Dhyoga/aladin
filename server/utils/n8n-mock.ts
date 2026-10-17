import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { JobRow } from '../db/schema'
import { isFinalStatus } from '../../shared/schemas/job'
import type { CallbackFile, CallbackFiles } from './job-handlers'
import type { CallbackOutcome, ParsedCallback } from './job-callback'
import type { MockRunner, WebhookRequest } from './n8n-client'

/** Put this text in a URL or prompt to make the mock job fail (to demo the failed state). */
export const MOCK_FAIL_TRIGGER = 'mock:fail'

/** Pause before each event, in ms, so the UI can show progress. Tests inject their own sleep. */
export const MOCK_DELAYS = {
  brand_extract: [1500, 1500, 1000],
  post: [1200, 1800, 800],
  video: [1200, 2000, 3000, 2500]
} as const

/** Reads fixtures from a folder. The default runtime folder is server/fixtures under the cwd. */
export function createFixtureLoader(dir: string): (name: string) => Promise<Buffer> {
  return name => readFile(join(dir, name))
}

export const loadFixture = createFixtureLoader(resolve(process.cwd(), 'server/fixtures'))

export interface MockRunnerOptions {
  /** The same callback core the HTTP endpoint uses. */
  applyCallback: (callback: ParsedCallback) => Promise<CallbackOutcome>
  loadFixture?: (name: string) => Promise<Buffer>
  sleep?: (ms: number) => Promise<void>
}

type EventBody = Omit<ParsedCallback, 'jobId'>

interface Step {
  delay: number
  build: () => Promise<EventBody>
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Simulates n8n: plays a scenario per job type by delivering callback events through the
 * real callback core. Resolves when the scenario ends (completed, failed, or the job went final).
 */
export function createMockRunner(options: MockRunnerOptions): MockRunner {
  const load = options.loadFixture ?? loadFixture
  const sleep = options.sleep ?? defaultSleep

  const fixtureJson = async (name: string) => JSON.parse((await load(name)).toString('utf8')) as Record<string, unknown>
  const fixtureFile = async (field: CallbackFile['field'], filename: string, mime: string): Promise<CallbackFile> => ({
    field,
    filename,
    mime,
    data: await load(filename)
  })
  const files = (...list: CallbackFile[]): CallbackFiles => Object.fromEntries(list.map(file => [file.field, file]))
  const progress = (stage: string, extra: Partial<EventBody> = {}): Promise<EventBody> =>
    Promise.resolve({ event: 'progress', stage, files: {}, ...extra })

  function stepsFor(job: JobRow, request: WebhookRequest): Step[] {
    switch (job.type) {
      case 'brand_extract': {
        const [d1, d2, d3] = MOCK_DELAYS.brand_extract
        const isPdf = 'source_type' in request && request.source_type === 'pdf'
        return [
          { delay: d1, build: () => progress(isPdf ? 'reading' : 'crawling') },
          { delay: d2, build: () => progress('structuring') },
          {
            delay: d3,
            build: async () => {
              const brandDna = await fixtureJson('brand-dna.json')
              if ('source_type' in request && request.source_type === 'url') {
                brandDna.identity = { ...(brandDna.identity as object), website: request.url }
              }
              return {
                event: 'completed',
                payload: JSON.stringify({ brand_dna: brandDna }),
                files: files(await fixtureFile('logo', 'logo.png', 'image/png'))
              }
            }
          }
        ]
      }
      case 'post': {
        const [d1, d2, d3] = MOCK_DELAYS.post
        return [
          { delay: d1, build: () => progress('caption') },
          { delay: d2, build: () => progress('image') },
          {
            delay: d3,
            build: async () => ({
              event: 'completed',
              payload: (await load('post.json')).toString('utf8'),
              files: files(await fixtureFile('image', 'post.png', 'image/png'))
            })
          }
        ]
      }
      case 'video': {
        const [d1, d2, d3, d4] = MOCK_DELAYS.video
        return [
          {
            delay: d1,
            build: async () => progress('script', { payload: (await load('video-script.json')).toString('utf8') })
          },
          {
            delay: d2,
            build: async () => progress('storyboard', {
              files: files(await fixtureFile('storyboard', 'storyboard.png', 'image/png'))
            })
          },
          { delay: d3, build: () => progress('video') },
          {
            delay: d4,
            build: async () => ({
              event: 'completed',
              payload: (await load('video-script.json')).toString('utf8'),
              files: files(await fixtureFile('video', 'video.mp4', 'video/mp4'))
            })
          }
        ]
      }
    }
  }

  return {
    async run(job, request) {
      const failRequested = JSON.stringify(request).includes(MOCK_FAIL_TRIGGER)
      const steps = stepsFor(job, request)

      for (const [index, step] of steps.entries()) {
        await sleep(step.delay)

        // Forced failure: let the first progress event through, then fail instead of continuing.
        const body: EventBody = failRequested && index === 1
          ? { event: 'failed', error: `Mock failure requested (${MOCK_FAIL_TRIGGER})`, files: {} }
          : await step.build()

        const outcome = await options.applyCallback({ jobId: job.id, ...body })
        if (outcome.outcome !== 'applied' || isFinalStatus(outcome.job.status)) return
      }
    }
  }
}
