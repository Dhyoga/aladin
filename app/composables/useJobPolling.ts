import { getCurrentScope, onScopeDispose, readonly, ref } from 'vue'
import { JobDtoSchema, isFinalStatus, type JobDto } from '../../shared/schemas/job'

export interface JobPollingOptions {
  /** 2 s for brand extraction and posts, 4 s for videos (design.md section 2). */
  intervalMs?: number
  /** Replaceable for tests. Defaults to GET /api/jobs/:id. */
  fetchJob?: (jobId: string) => Promise<unknown>
}

/**
 * Polls a job until it is completed or failed, then stops by itself. State is local to
 * each call, so several components can follow different jobs at once. Polling also stops
 * when the owning scope (component) goes away.
 */
export function useJobPolling(options: JobPollingOptions = {}) {
  const intervalMs = options.intervalMs ?? 2000
  // Typed as a plain string: Nitro's generated route types make a template-literal URL too deep to check.
  const fetchJob = options.fetchJob ?? ((jobId: string) => {
    const url: string = `/api/jobs/${jobId}`
    return $fetch<unknown>(url)
  })

  const status = ref<JobDto['status'] | null>(null)
  const stage = ref<string | null>(null)
  const error = ref<string | null>(null)
  const isPolling = ref(false)

  let timer: ReturnType<typeof setTimeout> | undefined
  // Bumped by start() and stop(); a response that belongs to an older run is dropped.
  let run = 0

  function stop() {
    run++
    clearTimeout(timer)
    timer = undefined
    isPolling.value = false
  }

  async function poll(jobId: string, myRun: number) {
    try {
      const job = JobDtoSchema.parse(await fetchJob(jobId))
      if (myRun !== run) return
      status.value = job.status
      stage.value = job.stage
      error.value = job.error
      if (isFinalStatus(job.status)) {
        isPolling.value = false
        return
      }
    } catch {
      if (myRun !== run) return
      // Network blips happen; the next tick tries again. A job that does not exist never will.
      error.value = 'Could not load the job status'
    }
    timer = setTimeout(() => void poll(jobId, myRun), intervalMs)
  }

  function start(jobId: string) {
    stop()
    status.value = null
    stage.value = null
    error.value = null
    isPolling.value = true
    void poll(jobId, run)
  }

  if (getCurrentScope()) onScopeDispose(stop)

  return {
    status: readonly(status),
    stage: readonly(stage),
    error: readonly(error),
    isPolling: readonly(isPolling),
    start,
    stop
  }
}
