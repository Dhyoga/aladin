## ADDED Requirements

### Requirement: Serve runtime media files
The app SHALL serve files stored under `runtimeConfig.mediaDir` at `GET /media/<path>`, where `<path>` is relative to `mediaDir`. Files SHALL NOT be served from `public/`.

#### Scenario: Existing file
- **WHEN** a client requests `/media/brands/b1/logo-x.png` and that file exists under `mediaDir`
- **THEN** the response is 200 with the file contents and the correct `Content-Length`

#### Scenario: Missing file
- **WHEN** a client requests a path that does not exist under `mediaDir`
- **THEN** the response is 404

#### Scenario: Directory
- **WHEN** a client requests a path that resolves to a directory
- **THEN** the response is 404

### Requirement: Path traversal protection
The route SHALL reject any path that, after decoding, contains a null byte or a `..` segment, or whose resolved location lies outside `mediaDir`, with status 400 and without reading the filesystem outside `mediaDir`.

#### Scenario: Plain traversal
- **WHEN** a client requests `/media/../../etc/passwd`
- **THEN** the response is 400

#### Scenario: Encoded traversal
- **WHEN** a client requests `/media/..%2F..%2Fetc%2Fpasswd`
- **THEN** the response is 400

#### Scenario: Null byte
- **WHEN** a client requests a path containing `%00`
- **THEN** the response is 400

#### Scenario: Sibling directory with shared prefix
- **WHEN** `mediaDir` is `/data/media` and a path resolves to `/data/media-secret/file.txt`
- **THEN** the response is 400

### Requirement: Content type
The route SHALL set `Content-Type` from the file extension for `png`, `jpg`/`jpeg`, `webp`, `mp4`, and `pdf`, and `application/octet-stream` for any other extension. Every file response SHALL include `X-Content-Type-Options: nosniff`.

#### Scenario: Known extension
- **WHEN** a client requests `/media/generations/g1/video.mp4`
- **THEN** the response has `Content-Type: video/mp4`

#### Scenario: Unknown extension
- **WHEN** a client requests a file with extension `.xyz`
- **THEN** the response has `Content-Type: application/octet-stream`

### Requirement: HTTP Range support
Every successful file response SHALL include `Accept-Ranges: bytes`. For a request with a single valid `Range` header (`bytes=a-b`, `bytes=a-`, or `bytes=-n`) the route SHALL respond 206 with the matching bytes, `Content-Range: bytes <start>-<end>/<size>`, and a `Content-Length` equal to the number of bytes returned. A range that cannot be satisfied SHALL yield 416 with `Content-Range: bytes */<size>`. A `Range` header that is malformed or specifies multiple ranges SHALL be ignored and the full file returned with 200.

#### Scenario: Bounded range
- **WHEN** a client requests a 1000-byte file with `Range: bytes=0-99`
- **THEN** the response is 206 with 100 bytes and `Content-Range: bytes 0-99/1000`

#### Scenario: Open-ended range
- **WHEN** a client requests a 1000-byte file with `Range: bytes=900-`
- **THEN** the response is 206 with 100 bytes and `Content-Range: bytes 900-999/1000`

#### Scenario: Suffix range
- **WHEN** a client requests a 1000-byte file with `Range: bytes=-100`
- **THEN** the response is 206 with the last 100 bytes and `Content-Range: bytes 900-999/1000`

#### Scenario: End beyond file size is clamped
- **WHEN** a client requests a 1000-byte file with `Range: bytes=900-5000`
- **THEN** the response is 206 with `Content-Range: bytes 900-999/1000`

#### Scenario: Unsatisfiable range
- **WHEN** a client requests a 1000-byte file with `Range: bytes=2000-3000`
- **THEN** the response is 416 with `Content-Range: bytes */1000`

#### Scenario: Multiple ranges
- **WHEN** a client sends `Range: bytes=0-10,20-30`
- **THEN** the response is 200 with the full file

#### Scenario: Malformed range
- **WHEN** a client sends `Range: bytes=abc`
- **THEN** the response is 200 with the full file

### Requirement: Streamed responses and short caching
The route SHALL stream file contents instead of loading whole files into memory, and SHALL send `Last-Modified` and `Cache-Control: private, max-age=300`.

#### Scenario: Caching headers
- **WHEN** a client requests an existing file
- **THEN** the response includes `Last-Modified` and `Cache-Control: private, max-age=300`
