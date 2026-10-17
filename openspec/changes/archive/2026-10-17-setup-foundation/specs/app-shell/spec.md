## ADDED Requirements

### Requirement: Dark-only design tokens
The app SHALL define the design tokens of `design.md` Bagian B (`--bg`, `--surface`, `--surface-2`, `--border`, `--border-strong`, `--text`, `--text-muted`, `--text-subtle`, `--accent`, `--accent-gradient`, `--info`, `--success`, `--danger`) as CSS variables on `:root`, with the dark values as the only values. The app SHALL NOT provide a light theme or a theme toggle, and the `<html>` element SHALL carry the `dark` class permanently.

#### Scenario: Tokens are available globally
- **WHEN** any page is rendered
- **THEN** every token listed above resolves to a non-empty value on `:root`
- **AND** the page background is `--bg` (`#0A0A0A`) with the warm radial glow

#### Scenario: No light mode
- **WHEN** the user's operating system prefers a light color scheme
- **THEN** the app still renders with the dark tokens

### Requirement: shadcn-vue components follow the project tokens
The semantic variables used by shadcn-vue components (such as `--background`, `--card`, `--primary`, `--border`, `--input`, `--ring`) SHALL be defined by reference to the project tokens, so components inherit the design system without per-component overrides.

#### Scenario: Primary button style
- **WHEN** a shadcn-vue `Button` with the default variant is rendered
- **THEN** it uses the light `--text` color as background with dark text and a pill shape, per `design.md` Bagian B

### Requirement: Typography
The app SHALL load Geist Sans for text and Geist Mono for code and hex values through `@nuxt/fonts`, with Inter and `system-ui` as fallbacks, and SHALL NOT request font files from external hosts at runtime.

#### Scenario: Fonts are self-served
- **WHEN** a page is loaded in the browser from a production build
- **THEN** the font files are fetched from the app's own origin

### Requirement: Default layout with sidebar
The app SHALL provide a default layout consisting of a 260px sidebar and a main content area. The sidebar SHALL contain the app name "Aladin" and navigation items "Studio" and "Brand DNA", each with a Lucide icon and a 40px height, and SHALL expose a region below the navigation reserved for page-specific content (used later for the Studio history).

#### Scenario: Desktop layout
- **WHEN** the viewport width is 1024px or more
- **THEN** the sidebar is permanently visible at 260px width next to the main content

#### Scenario: Active navigation item
- **WHEN** the current route is `/brand-dna`
- **THEN** the "Brand DNA" item is rendered in the active style and "Studio" is not

### Requirement: Responsive sidebar drawer
Below 1024px the sidebar SHALL be hidden and replaced by a header with a menu button that opens the same navigation in a drawer. Selecting a navigation item SHALL close the drawer.

#### Scenario: Mobile navigation
- **WHEN** the viewport width is below 1024px
- **THEN** the sidebar is not shown and a menu button is visible
- **WHEN** the user taps the menu button and selects "Studio"
- **THEN** the app navigates to `/studio` and the drawer closes

### Requirement: Routes and placeholder pages
The app SHALL provide the routes `/`, `/studio`, and `/brand-dna`. `/` SHALL redirect to `/studio`. `/studio` and `/brand-dna` SHALL render the default layout with a page title ("Studio" and "Brand DNA") and a short placeholder, and no feature content.

#### Scenario: Root redirect
- **WHEN** the user opens `/`
- **THEN** the browser ends on `/studio`

#### Scenario: Placeholder page
- **WHEN** the user opens `/brand-dna`
- **THEN** the page shows the title "Brand DNA" inside the default layout

### Requirement: Client-only rendering
The app SHALL run with `ssr: false` (SPA with a Nitro API) and all UI copy SHALL be in English.

#### Scenario: No server-rendered page content
- **WHEN** a page is requested from the production server
- **THEN** the response is the SPA shell and the page content is rendered by the client
