/**
 * Fathom Webhook Server
 * Receives webhooks from Fathom when meetings are processed
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { analyzeTranscript, generateChangeSummary } = require('./ui-change-detector');
const { generateMockupFromChanges, generateMockupWithAI } = require('./mockup-generator');
const { updateGitHubIssue, createGitHubIssue } = require('./github-updater');
const { postToSlack } = require('../shared/slack-poster');

const CONFIG_PATH = path.join(__dirname, '..', 'config');
const SECRETS = JSON.parse(fs.readFileSync(path.join(CONFIG_PATH, 'secrets.json'), 'utf-8'));
const ATTENDEES = JSON.parse(fs.readFileSync(path.join(CONFIG_PATH, 'marta-attendees.json'), 'utf-8'));

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3847;

/**
 * Verify Fathom webhook signature
 */
function verifyWebhookSignature(payload, signature, secret) {
  if (!secret) return true;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  const expectedSignature = hmac.digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expectedSignature)
  );
}

/**
 * Check if meeting is a Marta design meeting
 */
function isMartaMeeting(meetingData) {
  const { title = '', attendees = [] } = meetingData;
  const lowerTitle = title.toLowerCase();

  for (const pattern of ATTENDEES.meeting_patterns.title_patterns) {
    if (lowerTitle.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  const attendeeEmails = attendees.map(a => (a.email || '').toLowerCase());
  for (const email of attendeeEmails) {
    for (const pattern of ATTENDEES.meeting_patterns.email_patterns) {
      if (email.includes(pattern.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extract context from meeting data
 */
function extractMeetingContext(meetingData) {
  const { title = 'Meeting', attendees = [] } = meetingData;

  let persona = 'Default';
  let company = 'Beyond';

  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes('sales')) persona = 'Customer Sales';
  else if (lowerTitle.includes('finance')) persona = 'Finance';
  else if (lowerTitle.includes('operations') || lowerTitle.includes('ops')) persona = 'Operations';
  else if (lowerTitle.includes('support')) persona = 'Customer Support';
  else if (lowerTitle.includes('pricing')) persona = 'Pricing';

  return {
    meetingTitle: title,
    company,
    persona,
    attendees: attendees.map(a => a.name || a.email).filter(Boolean),
  };
}

/**
 * Process incoming Fathom webhook
 */
async function processFathomWebhook(payload) {
  const { event, data } = payload;

  console.log(`[Webhook] Received event: ${event}`);

  if (event !== 'call.processed' && event !== 'recording.processed') {
    console.log(`[Webhook] Ignoring event type: ${event}`);
    return { processed: false, reason: 'Not a processed call event' };
  }

  const meetingData = data.call || data.recording || data;

  if (!isMartaMeeting(meetingData)) {
    console.log(`[Webhook] Not a Marta meeting: ${meetingData.title}`);
    return { processed: false, reason: 'Not a Marta design meeting' };
  }

  console.log(`[Webhook] Processing Marta meeting: ${meetingData.title}`);

  const transcript = meetingData.transcript || '';
  if (!transcript) {
    console.log(`[Webhook] No transcript available`);
    return { processed: false, reason: 'No transcript' };
  }

  const analysisResults = analyzeTranscript(transcript);
  console.log(`[Webhook] Analysis complete. UI Changes: ${analysisResults.hasUIChanges}, Confidence: ${analysisResults.confidence}%`);

  if (!analysisResults.hasUIChanges) {
    console.log(`[Webhook] No UI changes detected`);
    return {
      processed: true,
      uiChanges: false,
      confidence: analysisResults.confidence,
    };
  }

  const context = extractMeetingContext(meetingData);

  const mockupResult = await generateMockupFromChanges(analysisResults, context);
  console.log(`[Webhook] Mockup generated: ${mockupResult.screenshotPath}`);

  const summary = generateChangeSummary(analysisResults, context.meetingTitle);

  try {
    const githubResult = await updateGitHubIssue({
      summary,
      mockupPath: mockupResult.screenshotPath,
      analysisResults,
      context,
    });
    console.log(`[Webhook] GitHub updated: ${githubResult.url}`);
  } catch (error) {
    console.error(`[Webhook] GitHub update failed:`, error.message);
  }

  try {
    await postToSlack({
      channel: ATTENDEES.integration.slack_channel,
      summary,
      mockupPath: mockupResult.screenshotPath,
      meetingTitle: context.meetingTitle,
    });
    console.log(`[Webhook] Slack notification sent`);
  } catch (error) {
    console.error(`[Webhook] Slack notification failed:`, error.message);
  }

  return {
    processed: true,
    uiChanges: true,
    confidence: analysisResults.confidence,
    mockupPath: mockupResult.screenshotPath,
    changesDetected: analysisResults.extractedChanges.length,
  };
}

app.post('/webhook/fathom', async (req, res) => {
  const signature = req.headers['x-fathom-signature'];

  if (SECRETS.fathom.webhook_secret) {
    if (!verifyWebhookSignature(req.body, signature, SECRETS.fathom.webhook_secret)) {
      console.log('[Webhook] Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  try {
    const result = await processFathomWebhook(req.body);
    res.json(result);
  } catch (error) {
    console.error('[Webhook] Processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'marta-ui-watcher' });
});

app.post('/test', async (req, res) => {
  const { transcript, meetingTitle = 'Test Meeting' } = req.body;

  if (!transcript) {
    return res.status(400).json({ error: 'Transcript required' });
  }

  const analysisResults = analyzeTranscript(transcript);
  const summary = generateChangeSummary(analysisResults, meetingTitle);

  res.json({
    analysisResults,
    summary,
  });
});

function startServer() {
  app.listen(PORT, () => {
    console.log(`[Marta UI Watcher] Server running on port ${PORT}`);
    console.log(`[Marta UI Watcher] Webhook endpoint: http://localhost:${PORT}/webhook/fathom`);
    console.log(`[Marta UI Watcher] Health check: http://localhost:${PORT}/health`);
  });
}

module.exports = {
  app,
  startServer,
  processFathomWebhook,
  isMartaMeeting,
};

if (require.main === module) {
  startServer();
}
