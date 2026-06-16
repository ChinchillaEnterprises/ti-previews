/**
 * Marta UI Watcher - Main Entry Point
 * Orchestrates the complete workflow from transcript to mockup
 */

const fs = require('fs');
const path = require('path');

const { analyzeTranscript, generateChangeSummary, categorizeChanges } = require('./ui-change-detector');
const { generateMockupFromChanges, generateMockupWithAI, getDefaultKPIs } = require('./mockup-generator');
const { startServer } = require('./webhook-server');
const { updateGitHubIssue, addTranscriptToIssue } = require('./github-updater');
const { postToSlack, postSitrep } = require('../shared/slack-poster');

const CONFIG_PATH = path.join(__dirname, '..', 'config');
const ATTENDEES = JSON.parse(fs.readFileSync(path.join(CONFIG_PATH, 'marta-attendees.json'), 'utf-8'));

/**
 * Process a transcript file directly
 */
async function processTranscriptFile(filePath, options = {}) {
  console.log(`[Marta UI Watcher] Processing transcript: ${filePath}`);

  const transcript = fs.readFileSync(filePath, 'utf-8');
  return processTranscript(transcript, options);
}

/**
 * Process transcript text directly
 */
async function processTranscript(transcript, options = {}) {
  const {
    meetingTitle = 'Marta Design Meeting',
    company = 'Beyond',
    persona = 'Customer Sales',
    skipGitHub = false,
    skipSlack = false,
    skipMockup = false,
  } = options;

  console.log(`[Marta UI Watcher] Analyzing transcript...`);

  const analysisResults = analyzeTranscript(transcript);

  console.log(`[Marta UI Watcher] Analysis complete:`);
  console.log(`  - UI Changes Detected: ${analysisResults.hasUIChanges}`);
  console.log(`  - Confidence: ${analysisResults.confidence}%`);
  console.log(`  - Keywords matched: ${analysisResults.matchedKeywords.length}`);
  console.log(`  - Changes extracted: ${analysisResults.extractedChanges.length}`);

  if (!analysisResults.hasUIChanges) {
    console.log(`[Marta UI Watcher] No significant UI changes detected. Skipping mockup generation.`);
    return {
      success: true,
      hasUIChanges: false,
      analysisResults,
    };
  }

  const context = { meetingTitle, company, persona };

  const categories = categorizeChanges(analysisResults);
  console.log(`[Marta UI Watcher] Change categories:`, Object.keys(categories).filter(k => categories[k].length > 0));

  let mockupResult = null;
  if (!skipMockup) {
    console.log(`[Marta UI Watcher] Generating mockup...`);
    mockupResult = await generateMockupFromChanges(analysisResults, context);
    console.log(`[Marta UI Watcher] Mockup saved: ${mockupResult.screenshotPath}`);
  }

  const summary = generateChangeSummary(analysisResults, meetingTitle);

  let githubResult = null;
  if (!skipGitHub) {
    console.log(`[Marta UI Watcher] Updating GitHub...`);
    try {
      githubResult = await updateGitHubIssue({
        summary,
        mockupPath: mockupResult?.screenshotPath,
        analysisResults,
        context,
      });
      console.log(`[Marta UI Watcher] GitHub updated: ${githubResult.url}`);
    } catch (error) {
      console.error(`[Marta UI Watcher] GitHub update failed:`, error.message);
    }
  }

  let slackResult = null;
  if (!skipSlack) {
    console.log(`[Marta UI Watcher] Posting to Slack...`);
    try {
      slackResult = await postToSlack({
        channel: ATTENDEES.integration.slack_channel,
        summary,
        mockupPath: mockupResult?.screenshotPath,
        meetingTitle,
      });
      console.log(`[Marta UI Watcher] Slack notification sent`);
    } catch (error) {
      console.error(`[Marta UI Watcher] Slack notification failed:`, error.message);
    }
  }

  return {
    success: true,
    hasUIChanges: true,
    analysisResults,
    categories,
    mockupResult,
    githubResult,
    slackResult,
    summary,
  };
}

/**
 * Test analysis on sample text
 */
function testAnalysis(sampleText) {
  const results = analyzeTranscript(sampleText);
  const categories = categorizeChanges(results);

  console.log('\n=== Analysis Results ===\n');
  console.log(`UI Changes Detected: ${results.hasUIChanges}`);
  console.log(`Confidence Score: ${results.confidence}%`);
  console.log(`\nMatched Keywords (${results.matchedKeywords.length}):`);
  results.matchedKeywords.slice(0, 10).forEach(k => {
    console.log(`  - ${k.keyword}: ${k.count} occurrences`);
  });

  console.log(`\nMatched Phrases (${results.matchedPhrases.length}):`);
  results.matchedPhrases.forEach(p => console.log(`  - "${p}"`));

  console.log(`\nExtracted Changes (${results.extractedChanges.length}):`);
  results.extractedChanges.slice(0, 5).forEach(c => {
    console.log(`  - ${c.fullMatch}`);
  });

  console.log(`\nCategories:`);
  Object.entries(categories).forEach(([cat, changes]) => {
    if (changes.length > 0) {
      console.log(`  ${cat}: ${changes.length} changes`);
    }
  });

  if (results.negativeIndicators.length > 0) {
    console.log(`\nNegative Indicators: ${results.negativeIndicators.join(', ')}`);
  }

  return results;
}

/**
 * List available personas
 */
function listPersonas() {
  const personas = ['Customer Sales', 'Finance', 'Operations', 'Customer Support', 'Pricing'];

  console.log('\nAvailable Personas:\n');
  personas.forEach(persona => {
    const kpis = getDefaultKPIs(persona);
    console.log(`${persona}:`);
    kpis.forEach(kpi => console.log(`  - ${kpi.label}: ${kpi.value}`));
    console.log('');
  });

  return personas;
}

const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
  case 'server':
    startServer();
    break;

  case 'process':
    if (!arg) {
      console.error('Usage: node index.js process <transcript-file>');
      process.exit(1);
    }
    processTranscriptFile(arg, {
      meetingTitle: process.argv[4] || 'Marta Design Meeting',
      persona: process.argv[5] || 'Customer Sales',
    }).then(result => {
      console.log('\nProcessing complete.');
      if (result.mockupResult) {
        console.log(`Mockup: ${result.mockupResult.screenshotPath}`);
      }
    }).catch(error => {
      console.error('Processing failed:', error);
      process.exit(1);
    });
    break;

  case 'test':
    const sampleText = arg || `
      We should update the dashboard to show the Load Count KPI more prominently.
      Can we add the margin percentage next to the total margin?
      The layout needs to be centered better.
      Let's remove the old chart and add a new trend line.
      Marta should display the RPL value in the chat message.
    `;
    testAnalysis(sampleText);
    break;

  case 'personas':
    listPersonas();
    break;

  case 'help':
  default:
    console.log(`
Marta UI Watcher - Automated UI Change Detection & Mockup Generation

Commands:
  server              Start the webhook server for Fathom integration
  process <file>      Process a transcript file directly
  test [text]         Test the analysis on sample text
  personas            List available personas and their KPIs
  help                Show this help message

Examples:
  node index.js server
  node index.js process ./transcript.txt "Design Review" "Finance"
  node index.js test "We need to update the dashboard layout"
  node index.js personas
`);
}

module.exports = {
  processTranscript,
  processTranscriptFile,
  testAnalysis,
  analyzeTranscript,
  generateMockupFromChanges,
  startServer,
};
