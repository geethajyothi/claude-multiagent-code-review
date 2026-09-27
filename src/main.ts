import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

import { CodeReviewOrchestrator } from './orchestrator';
import { ReportGenerator, logger } from './utils';

// Load environment variables
dotenv.config();

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 */
async function main() {
  const [owner, repo, prStr] = process.argv.slice(2);

  // ----- Validate command line arguments -----
  if (!owner || !repo || !prStr) {
    console.error('Usage: npm run dev -- <owner> <repo> <pr-number>');
    console.error('Example: npm run dev -- facebook react 12345');
    process.exit(1);
  }

  const prNumber = Number.parseInt(prStr, 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    console.error(`Invalid PR number: "${prStr}". Must be a positive integer.`);
    process.exit(1);
  }

  // ----- Validate authentication (choose ONE method) -----
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasBedrockCreds = Boolean(
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
  );

  if (hasBedrockCreds) {
    if (!process.env.AWS_REGION) {
      console.error('AWS_REGION must be set when using AWS Bedrock authentication.');
      process.exit(1);
    }
    console.log('🔐 Using AWS Bedrock authentication');
  } else if (hasAnthropicKey) {
    console.log('🔐 Using Anthropic API authentication');
  } else {
    console.error(
      'No authentication configured. Set ONE of the following:\n' +
        '  - ANTHROPIC_API_KEY (Anthropic API), or\n' +
        '  - AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION (AWS Bedrock)'
    );
    process.exit(1);
  }

  // ----- Validate ANTHROPIC_MODEL -----
  if (!process.env.ANTHROPIC_MODEL) {
    console.error(
      'ANTHROPIC_MODEL is required. Example values:\n' +
        '  - Anthropic API: claude-sonnet-4-5-20250929\n' +
        '  - AWS Bedrock:   us.anthropic.claude-sonnet-4-5-20250929-v1:0'
    );
    process.exit(1);
  }

  console.log('start here', owner, repo, prStr);

  try {
    const orchestrator = new CodeReviewOrchestrator();
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    const generator = new ReportGenerator();
    const reportsDir = path.join(process.cwd(), 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });

    const baseName = `${owner}_${repo}_${prNumber}`;
    const jsonPath = path.join(reportsDir, `${baseName}.json`);
    const mdPath = path.join(reportsDir, `${baseName}.md`);
    const htmlPath = path.join(reportsDir, `${baseName}.html`);

    fs.writeFileSync(jsonPath, generator.generateJSONReport(report));
    fs.writeFileSync(mdPath, generator.generateMarkdownReport(report));
    fs.writeFileSync(htmlPath, generator.generateHTMLReport(report));

    logger.info('Review complete. Reports saved:');
    logger.info(`  JSON:     ${path.relative(process.cwd(), jsonPath)}`);
    logger.info(`  Markdown: ${path.relative(process.cwd(), mdPath)}`);
    logger.info(`  HTML:     ${path.relative(process.cwd(), htmlPath)}`);
    logger.info(`  Overall score: ${report.summary.overallScore}/100`);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();