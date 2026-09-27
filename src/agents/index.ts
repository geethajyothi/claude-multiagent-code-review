/**
 * Subagent exports
 *
 * TODO: Export all your agent definitions here
 *
 * Example:
 * export { codeQualityAnalyzer } from './code-quality-analyzer';
 * export { testCoverageAnalyzer } from './test-coverage-analyzer';
 * export { refactoringSuggester } from './refactoring-suggester';
 */
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  CODE_QUALITY_ANALYZER_DESCRIPTION,
  CODE_QUALITY_ANALYZER_PROMPT,
  TEST_COVERAGE_ANALYZER_DESCRIPTION,
  TEST_COVERAGE_ANALYZER_PROMPT,
  REFACTORING_SUGGESTER_DESCRIPTION,
  REFACTORING_SUGGESTER_PROMPT
} from '../prompts';

/**
 * Subagent definitions
 *
 * These are passed into `query()`'s `options.agents` record. The orchestrator
 * prompt instructs the model to dispatch all three via the Task tool in
 * parallel for each file under review.
 */

export const codeQualityAnalyzer: AgentDefinition = {
  description: CODE_QUALITY_ANALYZER_DESCRIPTION,
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill', 'mcp__eslint__lint-files'],
  model: 'sonnet'
};

export const testCoverageAnalyzer: AgentDefinition = {
  description: TEST_COVERAGE_ANALYZER_DESCRIPTION,
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  tools: ['Read', 'Grep', 'Glob'],
  model: 'sonnet'
};

export const refactoringSuggester: AgentDefinition = {
  description: REFACTORING_SUGGESTER_DESCRIPTION,
  prompt: REFACTORING_SUGGESTER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  model: 'sonnet'
};