# media-storage Specification

## Purpose
Defines safe file writing and removal under the media directory with path traversal protection, and file type detection from content rather than from client-supplied names or MIME types.

## Requirements
### Requirement: Safe writing under the media directory
The app SHALL write files into `runtimeConfig.mediaDir` only through a function that takes a path relative to `mediaDir`, resolves it with the same traversal rules as media serving (no null bytes, no `..` segments, result inside `mediaDir`), creates missing parent folders, and writes the given bytes.

#### Scenario: Nested path is created
- **WHEN** a file is saved at `brands/b1/products/x.png` and the folders do not exist
- **THEN** the folders are created and the file contains exactly the given bytes

#### Scenario: Traversal is rejected
- **WHEN** saving at `../outside.txt`, `brands/../../outside.txt`, or a path containing a null byte
- **THEN** the operation fails with a path error and nothing is written outside `mediaDir`

#### Scenario: Overwrite
- **WHEN** a file is saved at a path that already holds a file
- **THEN** the file is replaced by the new bytes

### Requirement: Safe removal under the media directory
The app SHALL remove a file or a whole folder under `mediaDir` through a function that applies the same path rules. Removing a path that does not exist SHALL succeed without error. The function SHALL refuse to remove `mediaDir` itself.

#### Scenario: Remove a file
- **WHEN** an existing file is removed
- **THEN** the file no longer exists

#### Scenario: Remove a folder recursively
- **WHEN** `brands/b1` is removed and it contains nested folders and files
- **THEN** the whole folder is gone and sibling folders such as `brands/b2` are untouched

#### Scenario: Missing path
- **WHEN** a path that does not exist is removed
- **THEN** the call succeeds

#### Scenario: Refuses the root and traversal
- **WHEN** removal is requested for an empty path, `.`, `/`, or a path with `..`
- **THEN** the operation fails with a path error and `mediaDir` is untouched

### Requirement: File type detection from content
The app SHALL determine the type of an uploaded or delivered file from its first bytes and never from the client-supplied name or MIME type. It SHALL recognize PNG (`89 50 4E 47 0D 0A 1A 0A`), JPEG (`FF D8 FF`), WebP (`RIFF`, four size bytes, `WEBP`), PDF (`%PDF-`), and MP4 (the ASCII text `ftyp` in bytes 4 to 8), and report anything else as unknown. For each recognized type it SHALL provide the canonical MIME type and file extension (`image/png`/`png`, `image/jpeg`/`jpg`, `image/webp`/`webp`, `application/pdf`/`pdf`, `video/mp4`/`mp4`). Only PNG, JPEG, and WebP SHALL count as images; PDF and MP4 SHALL NOT.

#### Scenario: Each supported type
- **WHEN** buffers that start with the PNG, JPEG, WebP, PDF, and MP4 signatures are inspected
- **THEN** the results are `png`, `jpeg`, `webp`, `pdf`, and `mp4` with the canonical MIME types and extensions

#### Scenario: MP4 is not an image
- **WHEN** an MP4 buffer is checked for being an image
- **THEN** it is not an image, and neither is a PDF

#### Scenario: Disguised file
- **WHEN** a buffer containing HTML is inspected
- **THEN** the result is unknown

#### Scenario: Too short or empty
- **WHEN** an empty buffer or a buffer shorter than the signature is inspected
- **THEN** the result is unknown

#### Scenario: Other containers
- **WHEN** a WebM buffer (`1A 45 DF A3`) or an AVI buffer (`RIFF` with `AVI `) is inspected
- **THEN** the result is unknown
