## ADDED Requirements

### Requirement: Production container image
The repository SHALL provide a `Dockerfile` that builds a production image of the app. The build stage and the runtime stage SHALL use the same Debian-based Node 22 base image (`node:22-slim`). The runtime image SHALL contain the Nitro output (`.output/`), the Drizzle migrations folder at `/app/server/db/migrations`, and the mock fixtures at `/app/server/fixtures` (mock mode reads them relative to the working directory), SHALL run as the non-root user with uid 1000, and SHALL start the server with `node .output/server/index.mjs` listening on `0.0.0.0:3000`.

#### Scenario: Image starts and migrates an empty database
- **WHEN** a container is started from the image with an empty, writable `/app/data` and a valid production configuration
- **THEN** the server starts, the Drizzle migrations are applied to `/app/data/aladin.db`, and the log shows no migration or native-module error

#### Scenario: Native module loads
- **WHEN** the container opens the SQLite database
- **THEN** `better-sqlite3` loads without a compilation or architecture error

#### Scenario: Runs as non-root
- **WHEN** the running container's process user is inspected
- **THEN** it is uid 1000 and not root

#### Scenario: Build context excludes local state
- **WHEN** the image is built
- **THEN** the build context does not include `.env`, `data/`, `node_modules/`, `.git/`, or other local build output, as listed in `.dockerignore`

### Requirement: Fail-fast production configuration
The compose service SHALL map the production configuration to `NUXT_`-prefixed environment variables (`NUXT_DATABASE_PATH`, `NUXT_MEDIA_DIR`, `NUXT_N8N_MODE`, `NUXT_N8N_BASE_URL`, `NUXT_APP_INTERNAL_URL`, `NUXT_SHARED_SECRET`). `docker compose` SHALL refuse to start the service when `SHARED_SECRET` or `BASIC_AUTH_USERS` is missing or empty, with a message naming the variable. The n8n mode SHALL be taken from `N8N_MODE` in the environment file, and the first deployment SHALL use `mock`.

#### Scenario: Missing BasicAuth users
- **WHEN** `docker compose up` is run and `BASIC_AUTH_USERS` is empty or unset
- **THEN** compose fails before creating the container, with a message naming `BASIC_AUTH_USERS`

#### Scenario: Missing shared secret
- **WHEN** `docker compose up` is run and `SHARED_SECRET` is empty or unset
- **THEN** compose fails before creating the container, with a message naming `SHARED_SECRET`

#### Scenario: First deployment is in mock mode
- **WHEN** the service is deployed with `N8N_MODE=mock`
- **THEN** the app's `n8nMode` is `mock` and no request is made to n8n

### Requirement: Service behind Traefik with BasicAuth and TLS
The `aladin` service SHALL join the external Docker network `n8n-compose_default` under the service name `aladin`, SHALL NOT publish any port on the host, and SHALL be exposed only through the Traefik router for `aladin.serdadu.dev` with TLS (certresolver `mytlschallenge`) and a BasicAuth middleware that is attached to that router.

#### Scenario: Valid certificate
- **WHEN** a client requests `https://aladin.serdadu.dev`
- **THEN** the TLS handshake succeeds with a valid certificate for that host

#### Scenario: BasicAuth required
- **WHEN** a client requests `https://aladin.serdadu.dev/` without credentials
- **THEN** the response is 401 with a `WWW-Authenticate` header for Basic auth

#### Scenario: Valid credentials reach the app
- **WHEN** a client requests `https://aladin.serdadu.dev/` with the configured username and password
- **THEN** the app's page is returned

#### Scenario: No host port
- **WHEN** the host's listening ports are inspected after deployment
- **THEN** no new port is bound for the `aladin` service

### Requirement: Persistent data
The service SHALL mount `./data` from the project directory at `/app/data` so that the SQLite database and media files persist across container recreation, and the directory SHALL be writable by uid 1000.

#### Scenario: Data survives recreation
- **WHEN** a brand is created, the container is recreated (`docker compose up -d --force-recreate`), and the app is opened again
- **THEN** the brand and its files are still present

### Requirement: Isolation from other services on the shared server
Deployment and verification SHALL only create, change, or remove the `aladin` compose project (its container, image, and files under `~/aladin`). Traefik, n8n, and other projects on the server SHALL NOT be restarted, reconfigured, or have their files modified.

#### Scenario: Traefik and n8n are untouched
- **WHEN** the deployment has completed
- **THEN** the start times of the Traefik and n8n containers are the same as before the deployment started

#### Scenario: Rollback is limited to Aladin
- **WHEN** the deployment is rolled back with `docker compose down` in `~/aladin`
- **THEN** only the `aladin` container is removed and `data/`, Traefik, and n8n are unaffected

### Requirement: Secrets are handled out of band
The deployment SHALL keep secrets out of the repository and out of conversation text. `~/aladin/.env` SHALL have mode 600 and SHALL NOT be tracked by git. The BasicAuth password SHALL be hashed by the user on the server, and only the resulting hash SHALL be transferred. Secret values SHALL NOT be printed in command output.

#### Scenario: Environment file protected
- **WHEN** `~/aladin/.env` is inspected after deployment
- **THEN** its mode is 600, and `git ls-files .env` lists nothing

#### Scenario: Only the hash is transferred
- **WHEN** `BASIC_AUTH_USERS` is added to `.env`
- **THEN** the value is an `$apr1$` hash written via standard input, and the plain password is never part of a command or message

### Requirement: Internal endpoints reachable by n8n only
The app SHALL be reachable from inside the Docker network at `http://aladin:3000`. `/api/n8n/callback` and `/api/internal/*` SHALL answer 401 for a missing or wrong `X-Aladin-Secret` when called directly over the Docker network, and SHALL answer 404 for any request that carries an `X-Forwarded-Host` header (that is, one that came through Traefik).

#### Scenario: Reachable from the n8n network
- **WHEN** a temporary container on `n8n-compose_default` sends a request to `http://aladin:3000/`
- **THEN** the app responds

#### Scenario: Wrong secret on the callback
- **WHEN** a request to `http://aladin:3000/api/n8n/callback` carries a wrong `X-Aladin-Secret`
- **THEN** the response is 401

#### Scenario: Missing secret on internal assets
- **WHEN** a request to `http://aladin:3000/api/internal/assets/<id>` carries no `X-Aladin-Secret`
- **THEN** the response is 401

#### Scenario: Request through Traefik is hidden
- **WHEN** a request to `/api/n8n/callback` or `/api/internal/assets/<id>` carries an `X-Forwarded-Host` header
- **THEN** the response is 404 regardless of the secret

### Requirement: Mock flows work in the production container
With `N8N_MODE=mock`, the production container SHALL complete the brand extraction, post generation, and video generation flows using the fixtures, and SHALL serve the resulting media through `/media` with HTTP Range support.

#### Scenario: Mock pipeline end to end
- **WHEN** a user creates a brand from a URL, generates a post, and generates a video through the UI at `https://aladin.serdadu.dev`
- **THEN** each job reaches `completed` with the fixture results, without any request to n8n

#### Scenario: Video can be seeked
- **WHEN** a client requests the generated video through `/media` with `Range: bytes=0-9`
- **THEN** the response is 206 with `Content-Type: video/mp4`

### Requirement: Build memory safety on the shared server
The production image build SHALL cap the Node heap in the build stage (`--max-old-space-size=1536`). Before building on the server, the available memory SHALL be checked, and the build SHALL NOT start when it is clearly insufficient. If the build cannot complete on the server, the image SHALL be buildable elsewhere and loadable on the server without a registry.

#### Scenario: Build completes without disturbing other services
- **WHEN** the image is built on the server
- **THEN** the build succeeds and the Traefik and n8n containers do not restart

#### Scenario: Fallback to a locally built image
- **WHEN** the on-server build runs out of memory
- **THEN** the image can be built on the laptop and transferred with `docker save` piped to `docker load` over SSH, then started with `docker compose up -d` without `--build`

### Requirement: Documented deployment configuration
`.env.example` SHALL document the production variables (`SHARED_SECRET`, `BASIC_AUTH_USERS` with the single-quote requirement and how to create the hash with `openssl passwd -apr1`, `N8N_MODE`), SHALL show `mock` for the first deployment, and SHALL state that the mode is switched to `live` only when the n8n workflows exist.

#### Scenario: Example matches compose
- **WHEN** `.env.example` is compared with the variables referenced in `docker-compose.yml`
- **THEN** every required production variable is present with an explanatory comment
