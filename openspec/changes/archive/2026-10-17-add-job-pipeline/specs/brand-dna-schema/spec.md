## ADDED Requirements

### Requirement: Brand DNA structure
The shared Zod schema `BrandDNA` SHALL describe the groups `identity`, `audience`, `voice`, `offer`, `visual`, `social`, and an optional free-text `notes`, with the fields of `design.md` §5.2. Logo and product photos SHALL NOT be part of this schema.

#### Scenario: Minimal valid Brand DNA
- **WHEN** a Brand DNA with only `identity.name`, `identity.summary`, `audience.targetAudience`, `voice.toneOfVoice`, and empty `offer`, `visual`, `social` objects is parsed
- **THEN** parsing succeeds

#### Scenario: Missing required field
- **WHEN** a Brand DNA without `identity.name` is parsed
- **THEN** parsing fails with an issue at path `identity.name`

### Requirement: Required text must not be empty
`identity.name` SHALL be a non-empty string. `identity.summary`, `audience.targetAudience`, and `voice.toneOfVoice` SHALL be strings.

#### Scenario: Empty name
- **WHEN** `identity.name` is an empty string
- **THEN** parsing fails

### Requirement: Defaults
Fields declared with defaults SHALL be filled when absent: `voice.addressing` = `kamu`, `voice.contentLanguage` = `id`, `voice.emojiLevel` = `light`, and every list field (`audience.painPoints`, `voice.wordsToUse`, `voice.wordsToAvoid`, `offer.keyBenefits`, `offer.features`, `visual.colors`, `visual.fonts`, `visual.styleKeywords`, `visual.avoid`, `social.defaultHashtags`) = `[]`.

#### Scenario: Defaults applied
- **WHEN** a minimal Brand DNA is parsed
- **THEN** `voice.addressing` is `kamu`, `voice.contentLanguage` is `id`, `voice.emojiLevel` is `light`, and all list fields are empty arrays

### Requirement: Constrained values
`voice.addressing` MUST be one of `kamu`, `Anda`, `kalian`, `lo`. `voice.contentLanguage` MUST be `id` or `en`. `voice.emojiLevel` MUST be `none`, `light`, or `heavy`. Each `offer.features[].tier` MUST be `anchor`, `supporting`, or `variety`. Each `visual.colors` entry MUST be a 6-digit hex color with a leading `#`. `identity.website`, when present, MUST be a valid URL.

#### Scenario: Invalid tier
- **WHEN** a feature has tier `premium`
- **THEN** parsing fails with an issue at path `offer.features.0.tier`

#### Scenario: Invalid color
- **WHEN** `visual.colors` contains `red` or `#fff`
- **THEN** parsing fails

#### Scenario: Valid color and URL
- **WHEN** `visual.colors` contains `#F97316` and `identity.website` is `https://example.com`
- **THEN** parsing succeeds

#### Scenario: Invalid website
- **WHEN** `identity.website` is `not a url`
- **THEN** parsing fails with an issue at path `identity.website`
