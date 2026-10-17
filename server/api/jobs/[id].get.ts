export default defineEventHandler((event) => {
  return handleJobStatusRequest(event, getJobServices().db)
})
