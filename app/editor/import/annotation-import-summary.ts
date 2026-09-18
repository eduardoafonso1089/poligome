import type { ImageMatchIssue } from "./image-reference-match";

export function summarizeImageIssues(issues: ImageMatchIssue[]) {
  return {
    total: issues.length,
    missing: issues.filter((issue) => issue.reason === "missing").map((issue) => issue.reference),
    ambiguous: issues.filter((issue) => issue.reason === "ambiguous").map((issue) => issue.reference),
    invalid: issues.filter((issue) => issue.reason === "invalid").map((issue) => issue.reference),
  };
}
