import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  TEST_COVERAGE_ANALYZER_DESCRIPTION,
  TEST_COVERAGE_ANALYZER_PROMPT
} from '../prompts';

export const testCoverageAnalyzer: AgentDefinition = {
  description: TEST_COVERAGE_ANALYZER_DESCRIPTION,
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  model: 'sonnet'
};