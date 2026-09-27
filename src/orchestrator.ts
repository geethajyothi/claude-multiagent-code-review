import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { ReviewReport, ReviewReportSchema } from './types/report-types';
import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema
} from './types/analysis-results';
import { mcpServersConfig } from './config/mcp.config';
import { codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester } from './agents';
import { buildFetchFilesPrompt, buildFileReviewPrompt } from './prompts';
import { RateLimiter, RateLimiterConfig } from './utils/rate-limiter';
import { withRetry, withTimeout, ReviewError, ErrorCodes } from './utils/error-handler';
import {
  logReviewStart,
  logReviewComplete,
  logReviewError,
  logAgentStart,
  logAgentComplete
} from './utils/logger';

/** Files fetched from GitHub for the PR */
const PRFilesSchema = z.object({
  files: z.array(
    z.object({
      file: z.string(),
      content: z.string()
    })
  )
});
type PRFiles = z.infer<typeof PRFilesSchema>;

const toJsonSchema = (schema: z.ZodTypeAny) =>
  (zodToJsonSchema as (s: unknown, options?: unknown) => unknown)(schema, {
    $refStrategy: 'root'
  }) as Record<string, unknown>;

const PRFilesJSONSchema = toJsonSchema(PRFilesSchema);

/** A single file's combined analysis from the 3 subagents */
const FileReviewSchema = z.object({
  file: z.string(),
  codeQuality: CodeQualityResultSchema,
  testCoverage: TestCoverageResultSchema,
  refactorings: RefactoringSuggestionSchema
});
type FileReview = z.infer<typeof FileReviewSchema>;

const FileReviewJSONSchema = toJsonSchema(FileReviewSchema);

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
  /** Override rate limiter defaults (requests/min, tokens/min, concurrency) */
  rateLimits?: Partial<RateLimiterConfig>;
  /** Anthropic model to use; falls back to ANTHROPIC_MODEL env var */
  model?: string;
  /** Max retry attempts per SDK call (fetch files / per-file review) */
  maxRetries?: number;
  /** Timeout (ms) per SDK call */
  agentTimeoutMs?: number;
  /** Project root containing .claude/skills; falls back to PROJECT_ROOT env var */
  projectRoot?: string;
}

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  private rateLimiter: RateLimiter;
  private model: string;
  private maxRetries: number;
  private agentTimeoutMs: number;
  private projectRoot: string;

  constructor(options: OrchestratorOptions = {}) {
    this.rateLimiter = new RateLimiter(options.rateLimits ?? {});
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929';
    this.maxRetries = options.maxRetries ?? 3;
    this.agentTimeoutMs = options.agentTimeoutMs ?? 120_000;
    this.projectRoot = options.projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd();
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startTime = Date.now();
    logReviewStart(owner, repo, prNumber);

    try {
      const { files } = await this.fetchPRFiles(owner, repo, prNumber);

      const fileReviews = await Promise.all(
        files.map((f) => this.reviewFile(f.file, f.content))
      );

      const report = this.aggregateResults(owner, repo, prNumber, fileReviews, startTime);
      const validated = ReviewReportSchema.parse(report);

      logReviewComplete(
        owner,
        repo,
        prNumber,
        validated.summary.overallScore,
        validated.metadata.duration
      );

      return validated;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logReviewError(owner, repo, prNumber, err);
      throw error;
    }
  }

  /**
   * Fetch the PR's changed files and their content via the GitHub MCP server.
   */
  private async fetchPRFiles(owner: string, repo: string, prNumber: number): Promise<PRFiles> {
    return withRetry(
      () =>
        withTimeout(
          () => this.runFetchFilesQuery(owner, repo, prNumber),
          this.agentTimeoutMs,
          `Fetching PR files for ${owner}/${repo}#${prNumber} timed out`
        ),
      this.maxRetries
    );
  }

  private async runFetchFilesQuery(owner: string, repo: string, prNumber: number): Promise<PRFiles> {
    await this.rateLimiter.acquire();
    try {
      const prompt = buildFetchFilesPrompt(owner, repo, prNumber);

      for await (const message of query({
        prompt,
        options: {
          model: this.model,
          mcpServers: { github: mcpServersConfig.github },
          allowedTools: [
            'mcp__github__get_pull_request_files',
            'mcp__github__get_pull_request',
            'mcp__github__get_file_contents'
          ],
          settingSources: [],
          outputFormat: { type: 'json_schema', schema: PRFilesJSONSchema }
        }
      }) as AsyncIterable<any>) {
        if (message.type === 'result' && message.subtype === 'success' && message.structured_output) {
          return PRFilesSchema.parse(message.structured_output);
        }
        if (message.type === 'result' && message.subtype !== 'success') {
          throw new ReviewError(
            `GitHub MCP query failed: ${message.subtype}`,
            ErrorCodes.GITHUB_API_ERROR,
            { owner, repo, prNumber }
          );
        }
      }

      throw new ReviewError(
        'GitHub MCP did not return structured PR file data',
        ErrorCodes.STRUCTURED_OUTPUT_FAILED,
        { owner, repo, prNumber }
      );
    } finally {
      this.rateLimiter.release();
    }
  }

  /**
   * Review a single file by spawning all 3 subagents (via the Task tool) in
   * parallel and combining their structured results.
   */
  private async reviewFile(file: string, content: string): Promise<FileReview> {
    logAgentStart('multi-agent-review', file);
    const start = Date.now();

    const result = await withRetry(
      () =>
        withTimeout(
          () => this.runFileReviewQuery(file, content),
          this.agentTimeoutMs,
          `Review of ${file} timed out`
        ),
      this.maxRetries
    );

    logAgentComplete('multi-agent-review', file, Date.now() - start);
    return result;
  }

  private async runFileReviewQuery(file: string, content: string): Promise<FileReview> {
    // Larger token estimate: this call covers 3 subagents' worth of analysis.
    await this.rateLimiter.acquire(4000);
    try {
      const prompt = buildFileReviewPrompt(file, content);

      for await (const message of query({
        prompt,
        options: {
          model: this.model,
          cwd: this.projectRoot,
          settingSources: ['project'],
          mcpServers: { eslint: mcpServersConfig.eslint },
          agents: {
            codeQualityAnalyzer,
            testCoverageAnalyzer,
            refactoringSuggester
          },
          allowedTools: ['Task', 'Read', 'Grep', 'Glob', 'Skill'],
          outputFormat: { type: 'json_schema', schema: FileReviewJSONSchema }
        }
      }) as AsyncIterable<any>) {
        if (message.type === 'result' && message.subtype === 'success' && message.structured_output) {
          return FileReviewSchema.parse(message.structured_output);
        }
        if (message.type === 'result' && message.subtype !== 'success') {
          throw new ReviewError(
            `Subagent review failed for ${file}: ${message.subtype}`,
            ErrorCodes.AGENT_FAILED,
            { file }
          );
        }
      }

      throw new ReviewError(
        `No structured output returned for file ${file}`,
        ErrorCodes.STRUCTURED_OUTPUT_FAILED,
        { file }
      );
    } finally {
      this.rateLimiter.release();
    }
  }

  /**
   * Aggregate per-file subagent results into the final ReviewReport shape.
   */
  private aggregateResults(
    owner: string,
    repo: string,
    prNumber: number,
    fileReviews: FileReview[],
    startTime: number
  ): ReviewReport {
    const totalFiles = fileReviews.length;

    const overallScore =
      totalFiles === 0
        ? 100
        : Math.round(
            fileReviews.reduce((sum, r) => sum + r.codeQuality.overallScore, 0) / totalFiles
          );

    const criticalIssues = fileReviews.reduce(
      (sum, r) => sum + r.codeQuality.issues.filter((i) => i.severity === 'critical').length,
      0
    );

    const highPriorityTests = fileReviews.reduce(
      (sum, r) =>
        sum +
        r.testCoverage.untestedPaths.filter((p) => p.priority === 'critical' || p.priority === 'high')
          .length,
      0
    );

    const refactoringOpportunities = fileReviews.reduce(
      (sum, r) => sum + r.refactorings.suggestions.length,
      0
    );

    return {
      pullRequest: { owner, repo, number: prNumber },
      fileReviews,
      summary: {
        totalFiles,
        overallScore,
        criticalIssues,
        highPriorityTests,
        refactoringOpportunities
      },
      recommendations: this.buildRecommendations(fileReviews),
      metadata: {
        analyzedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
        agentVersions: {
          orchestrator: '1.0.0',
          codeQualityAnalyzer: '1.0.0',
          testCoverageAnalyzer: '1.0.0',
          refactoringSuggester: '1.0.0'
        }
      }
    };
  }

  private buildRecommendations(fileReviews: FileReview[]): ReviewReport['recommendations'] {
    const recommendations: ReviewReport['recommendations'] = [];

    for (const review of fileReviews) {
      const criticalIssues = review.codeQuality.issues.filter((i) => i.severity === 'critical');
      if (criticalIssues.length > 0) {
        recommendations.push({
          priority: 'critical',
          category: 'code-quality',
          description: `${criticalIssues.length} critical issue(s) found: ${criticalIssues[0]!.description}`,
          files: [review.file]
        });
      }

      const highPriorityTests = review.testCoverage.untestedPaths.filter(
        (p) => p.priority === 'critical' || p.priority === 'high'
      );
      if (highPriorityTests.length > 0) {
        recommendations.push({
          priority: 'high',
          category: 'test-coverage',
          description: `${highPriorityTests.length} high-priority test gap(s): ${highPriorityTests[0]!.reasoning}`,
          files: [review.file]
        });
      }

      const highImpactRefactors = review.refactorings.suggestions.filter((s) => s.impact === 'high');
      if (highImpactRefactors.length > 0) {
        recommendations.push({
          priority: 'medium',
          category: 'refactoring',
          description: highImpactRefactors[0]!.description,
          files: [review.file]
        });
      }
    }

    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return recommendations.sort((a, b) => priorityOrder[a.priority]! - priorityOrder[b.priority]!);
  }
}