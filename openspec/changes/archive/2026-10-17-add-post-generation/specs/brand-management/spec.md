## MODIFIED Requirements

### Requirement: Delete a brand
`DELETE /api/brands/:id` SHALL remove the brand, its asset rows, its generation rows, the folder `brands/<id>/`, and the folder `generations/<generationId>/` of each of its generations under `mediaDir`, and answer 204. A failure to remove files SHALL be logged but SHALL NOT fail the request. An unknown id SHALL yield 404. Jobs belonging to the brand SHALL NOT be deleted.

#### Scenario: Delete with files
- **WHEN** a brand with a logo, a photo, and a source PDF is deleted
- **THEN** the response is 204, no brand or asset rows remain, and the folder `brands/<id>` no longer exists

#### Scenario: Delete during extraction
- **WHEN** a brand with a running extraction job is deleted
- **THEN** the response is 204 and the job row still exists

#### Scenario: Unknown brand
- **WHEN** an id that does not exist is deleted
- **THEN** the response is 404

#### Scenario: Delete with generations
- **WHEN** a brand with two generations that each have a saved image is deleted
- **THEN** the response is 204, no generation rows remain, the folder `generations/<id>` of each of them no longer exists, and the generations of other brands and their folders are untouched
