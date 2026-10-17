/** Formats Zod issues as `path: message; path: message` for error strings. */
export function describeIssues(issues: { path: PropertyKey[], message: string }[]): string {
  return issues.map(issue => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`).join('; ')
}
