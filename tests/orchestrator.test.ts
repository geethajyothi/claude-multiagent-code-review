import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for CodeReviewOrchestrator
 *
 * The Claude Agent SDK's `query()` is mocked so these tests run without
 * real API access. Each mocked call returns an async generator that yields
 * a single `result` message with a `structured_output` payload, mirroring
 * what the real SDK returns when using `outputFormat: { type: 'json_schema' }`.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn()
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { CodeReviewOrchestrator } from '../src/orchestrator';

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;

/** Build an async generator yielding a single successful structured-output result message. */
async function* successResult(structured_output: unknown) {
  yield { type: 'result', subtype: 'success', structured_output };
}

/** Build an async generator that never yields a structured_output result. */
async function* emptyResult() {
  yield { type: 'system', subtype: 'init' };
}

const samplePRFiles = {
  files: [{ file: 'src/index.ts', content: 'export const add = (a: number, b: number) => a + b;' }]
};

const sampleFileReview = {
  file: 'src/index.ts',
  codeQuality: {
    file: 'src/index.ts',
    issues: [],
    overallScore: 95,
    summary: 'Clean, simple file with no issues.'
  },
  testCoverage: {
    file: 'src/index.ts',
    hasTests: false,
    testFiles: [],
    untestedPaths: [
      {
        type: 'function' as const,
        location: 'add()',
        priority: 'medium' as const,
        reasoning: 'No test file found for this function.',
        suggestedTest: "expect(add(1, 2)).toBe(3)"
      }
    ],
    coverageEstimate: 0,
    summary: 'No tests found for this file.'
  },
  refactorings: {
    file: 'src/index.ts',
    suggestions: [],
    summary: 'No refactoring opportunities found.'
  }
};

describe('CodeReviewOrchestrator', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  describe('Configuration', () => {
    it('should initialize with default options', () => {
      const orchestrator = new CodeReviewOrchestrator();
      expect(orchestrator).toBeInstanceOf(CodeReviewOrchestrator);
    });

    it('should accept custom rate limit configuration', () => {
      const orchestrator = new CodeReviewOrchestrator({
        rateLimits: { maxRequestsPerMinute: 10, maxConcurrent: 2 }
      });

      // Rate limiter is private; assert via its public status API instead
      // of reaching into internals directly.
      const status = (orchestrator as any).rateLimiter.getStatus();
      expect(status.availableRequests).toBe(10);
    });
  });

  describe('reviewPullRequest', () => {
    it('should fetch PR files from GitHub MCP', async () => {
      mockedQuery
        .mockImplementationOnce(() => successResult(samplePRFiles))
        .mockImplementationOnce(() => successResult(sampleFileReview));

      const orchestrator = new CodeReviewOrchestrator();
      await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);

      const firstCallOptions = mockedQuery.mock.calls[0]![0].options;
      expect(firstCallOptions.mcpServers).toHaveProperty('github');
      expect(firstCallOptions.allowedTools).toEqual(
        expect.arrayContaining(['mcp__github__get_pull_request_files'])
      );
    });

    it('should spawn all 3 subagents in parallel', async () => {
      mockedQuery
        .mockImplementationOnce(() => successResult(samplePRFiles))
        .mockImplementationOnce(() => successResult(sampleFileReview));

      const orchestrator = new CodeReviewOrchestrator();
      await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);

      const secondCallOptions = mockedQuery.mock.calls[1]![0].options;
      expect(Object.keys(secondCallOptions.agents)).toEqual(
        expect.arrayContaining(['codeQualityAnalyzer', 'testCoverageAnalyzer', 'refactoringSuggester'])
      );
      expect(secondCallOptions.allowedTools).toEqual(expect.arrayContaining(['Task']));
    });

    it('should aggregate results into ReviewReport', async () => {
      mockedQuery
        .mockImplementationOnce(() => successResult(samplePRFiles))
        .mockImplementationOnce(() => successResult(sampleFileReview));

      const orchestrator = new CodeReviewOrchestrator();
      const report = await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);

      expect(report.pullRequest).toEqual({ owner: 'octocat', repo: 'Hello-World', number: 1 });
      expect(report.fileReviews).toHaveLength(1);
      expect(report.summary.totalFiles).toBe(1);
      expect(report.summary.overallScore).toBe(95);
      expect(report.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    it('should validate output with Zod schema', async () => {
      const invalidFileReview = {
        file: 'src/index.ts',
        codeQuality: { file: 'src/index.ts', issues: [], overallScore: 'not-a-number', summary: 'bad' },
        testCoverage: sampleFileReview.testCoverage,
        refactorings: sampleFileReview.refactorings
      };

      mockedQuery
        .mockImplementationOnce(() => successResult(samplePRFiles))
        .mockImplementationOnce(() => successResult(invalidFileReview));

      // maxRetries: 1 avoids the exponential-backoff delay between retries
      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1 });

      await expect(orchestrator.reviewPullRequest('octocat', 'Hello-World', 1)).rejects.toThrow();
    });

    it('throws a clear error when the SDK never produces a structured_output', async () => {
      mockedQuery.mockImplementationOnce(() => emptyResult());

      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1 });

      await expect(orchestrator.reviewPullRequest('octocat', 'Hello-World', 1)).rejects.toThrow(
        /structured/i
      );
    });
  });

  describe('Integration', () => {
    // These tests require actual API keys and should be skipped in CI
    it.skip('should review a real small PR', async () => {
      // NOTE: Only run manually with valid API keys; unmock the SDK first.
      const orchestrator = new CodeReviewOrchestrator();
      const report = await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);
      expect(report.pullRequest.owner).toBe('octocat');
    });
  });
});