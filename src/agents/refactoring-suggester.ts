import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  REFACTORING_SUGGESTER_DESCRIPTION,
  REFACTORING_SUGGESTER_PROMPT
} from '../prompts';

export const refactoringSuggester: AgentDefinition = {
  description: REFACTORING_SUGGESTER_DESCRIPTION,
  prompt: REFACTORING_SUGGESTER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  model: 'sonnet'
};