import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  CODE_QUALITY_ANALYZER_DESCRIPTION,
  CODE_QUALITY_ANALYZER_PROMPT
} from '../prompts';

export const codeQualityAnalyzer: AgentDefinition = {
  description: CODE_QUALITY_ANALYZER_DESCRIPTION,
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill', 'mcp__eslint__lint-files'],
  model: 'sonnet'
};