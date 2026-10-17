## ADDED Requirements

### Requirement: Internal-only endpoint
`POST /api/n8n/callback` SHALL answer 404 to any request that carries an `X-Forwarded-Host` header, since n8n calls the app directly over the internal network and never through the public proxy. This check SHALL run before authentication and before the body is read.

#### Scenario: Request through the public proxy
- **WHEN** a request with an `X-Forwarded-Host` header and a valid secret is sent
- **THEN** the response is 404 and no job changes

### Requirement: Shared secret authentication
The endpoint SHALL require the `X-Aladin-Secret` header to equal `runtimeConfig.sharedSecret`, compared in constant time (without revealing the length of the expected value). A missing or wrong secret SHALL yield 401, and the request body SHALL NOT be read in that case.

#### Scenario: Wrong secret
- **WHEN** a request carries a wrong `X-Aladin-Secret`
- **THEN** the response is 401 and no job changes

#### Scenario: Missing secret
- **WHEN** a request has no `X-Aladin-Secret` header
- **THEN** the response is 401

#### Scenario: Secret of different length
- **WHEN** the supplied secret is a prefix of the real secret
- **THEN** the response is 401

### Requirement: Request size limits
The endpoint SHALL answer 413 when `Content-Length` exceeds 130 MB. Within an accepted request, a file larger than its per-file limit (`logo` 10 MB, `image` 20 MB, `storyboard` 20 MB, `video` 100 MB) SHALL make the job `failed` with an `invalid_payload` error that names the file, and the response SHALL still be 200.

#### Scenario: Oversized request
- **WHEN** a request declares a `Content-Length` of 131 MB
- **THEN** the response is 413

#### Scenario: Oversized file in a completed callback
- **WHEN** a `completed` callback for a `post` job carries an `image` larger than 20 MB
- **THEN** the job becomes `failed` with an error containing `invalid_payload` and `image`, and the response is 200

### Requirement: Multipart parsing and field validation
The endpoint SHALL read `multipart/form-data`, treat parts without a filename as text fields and parts with a filename as files, accept only the files `logo`, `image`, `storyboard`, and `video`, and ignore any other file part. Text fields SHALL be validated against the callback fields contract. A request whose fields are invalid, including a missing `job_id` or unknown `event`, SHALL yield 400.

#### Scenario: Invalid event
- **WHEN** a request has `event` `done`
- **THEN** the response is 400

#### Scenario: Unknown file field ignored
- **WHEN** a valid `progress` callback also carries a file named `extra`
- **THEN** the response is 200 and the file is not passed to any handler

### Requirement: Unknown job
A callback for a `job_id` that does not exist SHALL yield 404.

#### Scenario: Unknown job id
- **WHEN** a valid callback names job `job_missing`
- **THEN** the response is 404

### Requirement: Idempotent for final jobs
A callback for a job that is already `completed` or `failed` (including a job that has just timed out) SHALL yield 200 and SHALL NOT change the job or call any result handler.

#### Scenario: Duplicate completed callback
- **WHEN** the same `completed` callback is delivered twice
- **THEN** both responses are 200, the result handler ran exactly once, and the job is `completed`

#### Scenario: Callback after failure
- **WHEN** a `progress` callback arrives for a `failed` job
- **THEN** the response is 200 and the job stays `failed` with its original error

#### Scenario: Callback after timeout
- **WHEN** a `completed` callback arrives for a `post` job that started 6 minutes ago
- **THEN** the response is 200, the job is `failed` with error `timeout`, and no result handler ran

### Requirement: Progress events
A `progress` callback SHALL set the job's `stage` to the supplied value and keep the job non-final, and SHALL pass the stage, the validated payload (when present), and any files to the progress hook of the job type's result handler. A job still `queued` SHALL be accepted and become `running`. A `progress` payload that fails validation for its stage (a video script with `stage` `script`) SHALL make the job `failed` with an `invalid_payload` error.

#### Scenario: Stage update
- **WHEN** a `progress` callback with stage `storyboard` arrives for a running video job
- **THEN** the job's stage is `storyboard` and its status is `running`

#### Scenario: Progress before running
- **WHEN** a `progress` callback arrives for a job that is still `queued`
- **THEN** the job becomes `running` with its stage set

#### Scenario: Progress hook receives files
- **WHEN** a `progress` callback with a `storyboard` file arrives and a progress hook is registered
- **THEN** the hook receives the stage and the storyboard file

### Requirement: Completed events
A `completed` callback SHALL parse `payload` as JSON and validate it against the schema for the job type, check the files required for that type, and then call the result handler registered for the type. If the handler resolves, the job SHALL become `completed` with `stage` unchanged and `finished_at` set. An invalid payload, unparsable JSON, or a missing required file SHALL make the job `failed` with an error starting with `invalid_payload`, and the response SHALL be 200. If the handler throws, the job SHALL become `failed` with an error starting with `handler_failed` and containing the handler's message.

#### Scenario: Successful completion
- **WHEN** a valid `completed` callback arrives for a `post` job with an `image` file and a registered handler
- **THEN** the handler receives the typed payload and the image, the job becomes `completed`, and the response is 200

#### Scenario: Invalid payload
- **WHEN** a `completed` callback for a `post` job has a payload without `caption`
- **THEN** the job becomes `failed` with an error starting with `invalid_payload`, the handler is not called, and the response is 200

#### Scenario: Unparsable payload
- **WHEN** the `payload` field is not valid JSON
- **THEN** the job becomes `failed` with an error starting with `invalid_payload` and the response is 200

#### Scenario: Missing required file
- **WHEN** a `completed` callback for a `video` job carries no `video` file
- **THEN** the job becomes `failed` with an error starting with `invalid_payload` that names `video`

#### Scenario: Handler throws
- **WHEN** the registered handler throws `disk full`
- **THEN** the job becomes `failed` with an error starting with `handler_failed` and containing `disk full`, and the response is 200

### Requirement: Result handler registry
The app SHALL provide a registry where each job type can register at most one result handler with a required completion callback and an optional progress hook. A `completed` callback for a type with no registered handler SHALL make the job `failed` with the error `no_result_handler`.

#### Scenario: No handler registered
- **WHEN** a valid `completed` callback arrives for a type with no handler
- **THEN** the job becomes `failed` with error `no_result_handler`

#### Scenario: Registering twice
- **WHEN** a second handler is registered for the same job type
- **THEN** it replaces the first one

### Requirement: Failed events
A `failed` callback SHALL make the job `failed` with the supplied `error` truncated to 500 characters, or `unknown_error` when none is supplied. The response SHALL be 200.

#### Scenario: Failure with message
- **WHEN** a `failed` callback with error `Gemini quota exceeded` arrives for a running job
- **THEN** the job becomes `failed` with that error

#### Scenario: Failure without message
- **WHEN** a `failed` callback without `error` arrives
- **THEN** the job's error is `unknown_error`

#### Scenario: Long error truncated
- **WHEN** a `failed` callback carries a 2000-character error
- **THEN** the stored error is 500 characters long

### Requirement: Concurrent duplicate completion
While the result handler for a job's `completed` callback is still running, a second `completed` callback for the same job SHALL be answered 200 without calling the handler again.

#### Scenario: Retry during handler execution
- **WHEN** two identical `completed` callbacks are delivered concurrently and the handler takes time
- **THEN** the handler is called exactly once and both responses are 200
