/**
 * Prompt used to fetch the list of changed files (and their content) for a PR,
 * via the GitHub MCP server.
 */
export function buildFetchFilesPrompt(owner: string, repo: string, prNumber: number): string {
  return `You are reviewing pull request #${prNumber} in the ${owner}/${repo} GitHub repository.

Use the GitHub MCP tools to:
1. Get the list of files changed in this pull request.
2. For each changed file (skip deleted files, binary files, and lockfiles such as package-lock.json or yarn.lock), fetch its full current content from the PR's head branch/commit.

Return a JSON object with a "files" array. Each entry must have:
- "file": the file's path relative to the repository root
- "content": the full text content of the file

Only include files you were able to successfully fetch. If the PR has no reviewable files, return { "files": [] }.`;
}

/**
 * Prompt used to review a single file. Instructs the model to dispatch the
 * three specialist subagents (via the Task tool) in parallel against this
 * file, then combine their structured results into one object.
 */
export function buildFileReviewPrompt(file: string, content: string): string {
  return `Review the following file as part of a pull request code review.

File: ${file}

\`\`\`
${content}
\`\`\`

Use the Task tool to dispatch all three subagents — codeQualityAnalyzer, testCoverageAnalyzer, and refactoringSuggester — against this file IN PARALLEL (invoke all three Task calls together, not one after another), then combine their individual JSON results into a single object.

Return a single JSON object with exactly these keys:
- "file": "${file}"
- "codeQuality": the codeQualityAnalyzer's full result object
- "testCoverage": the testCoverageAnalyzer's full result object
- "refactorings": the refactoringSuggester's full result object`;
}