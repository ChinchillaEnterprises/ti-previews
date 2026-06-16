/**
 * Mockup Generator
 * Creates UI mockups based on detected changes
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { generateDashboardHTML, BRAND } = require('../shared/design-system');
const { screenshotHTML } = require('../shared/puppeteer-utils');

const SECRETS_PATH = path.join(__dirname, '..', 'config', 'secrets.json');
const SECRETS = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf-8'));

/**
 * Generate a mockup based on UI change analysis
 */
async function generateMockupFromChanges(analysisResults, context = {}) {
  const {
    meetingTitle = 'Meeting',
    company = 'Beyond',
    persona = 'Default',
  } = context;

  // Extract KPI changes from analysis
  const kpiChanges = extractKPIChanges(analysisResults);
  const layoutChanges = extractLayoutChanges(analysisResults);

  // Determine mockup configuration
  const mockupConfig = {
    title: 'Marta',
    company,
    persona,
    kpis: kpiChanges.length > 0 ? kpiChanges : getDefaultKPIs(persona),
    chatMessage: generateChatMessage(analysisResults),
    accentColor: getPersonaColor(persona),
  };

  // Generate HTML
  const html = generateDashboardHTML(mockupConfig);

  // Take screenshot
  const filename = `mockup-${Date.now()}-${sanitizeFilename(meetingTitle)}.png`;
  const screenshotPath = await screenshotHTML(html, { filename });

  // Also save the HTML for reference
  const htmlPath = path.join(__dirname, '..', 'output', filename.replace('.png', '.html'));
  fs.writeFileSync(htmlPath, html);

  return {
    screenshotPath,
    htmlPath,
    config: mockupConfig,
  };
}

/**
 * Generate mockup using Chinchilla API for more complex designs
 */
async function generateMockupWithAI(prompt, context = {}) {
  const { CHINCHILLA_API_URL = 'https://claude.chinchilla-ai.com/query' } = SECRETS.chinchilla_api || {};

  const fullPrompt = `You are a frontend design expert. Generate a complete, production-ready HTML file with embedded CSS for the following mockup request. Use a dark theme with purple/blue accents. Make it visually striking and modern.

Request: ${prompt}

Context:
- Company: ${context.company || 'Beyond'}
- Persona: ${context.persona || 'User'}
- Style: Dark mode, glassmorphism, modern SaaS aesthetic

Requirements:
1. Complete HTML with embedded CSS (no external files)
2. Responsive grid layout
3. KPI cards with values and change indicators
4. Chart placeholder section
5. AI chat message section at bottom
6. Use colors: primary purple (#8b5cf6), background (#0f0a1e), cards (rgba(30,27,46,0.8))

Return ONLY the HTML code, no explanations.`;

  try {
    const response = await fetch(CHINCHILLA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: fullPrompt }),
    });

    const data = await response.json();
    const html = extractHTMLFromResponse(data.claude_response || data.response || '');

    if (html) {
      const filename = `ai-mockup-${Date.now()}.png`;
      const screenshotPath = await screenshotHTML(html, { filename });

      const htmlPath = path.join(__dirname, '..', 'output', filename.replace('.png', '.html'));
      fs.writeFileSync(htmlPath, html);

      return { screenshotPath, htmlPath, html };
    }
  } catch (error) {
    console.error('AI mockup generation failed:', error.message);
  }

  // Fallback to template-based generation
  return generateMockupFromChanges({ extractedChanges: [] }, context);
}

/**
 * Extract HTML from AI response
 */
function extractHTMLFromResponse(response) {
  // Try to find HTML in code blocks
  const htmlMatch = response.match(/```html?\s*([\s\S]*?)```/i);
  if (htmlMatch) {
    return htmlMatch[1].trim();
  }

  // Try to find raw HTML
  if (response.includes('<!DOCTYPE') || response.includes('<html')) {
    const start = response.indexOf('<!DOCTYPE') !== -1 ? response.indexOf('<!DOCTYPE') : response.indexOf('<html');
    const end = response.lastIndexOf('</html>') + 7;
    if (end > start) {
      return response.substring(start, end);
    }
  }

  return null;
}

/**
 * Extract KPI changes from analysis
 */
function extractKPIChanges(analysisResults) {
  const kpis = [];
  const kpiKeywords = ['load count', 'margin', 'mpl', 'rpl', 'customer count', 'revenue', 'cost'];

  for (const change of analysisResults.extractedChanges || []) {
    const lower = change.fullMatch.toLowerCase();
    for (const keyword of kpiKeywords) {
      if (lower.includes(keyword)) {
        kpis.push({
          label: keyword.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          value: '---',
          change: 'Updated',
          changeType: 'neutral',
        });
        break;
      }
    }
  }

  return kpis;
}

/**
 * Extract layout changes from analysis
 */
function extractLayoutChanges(analysisResults) {
  const layoutKeywords = ['layout', 'centered', 'spacing', 'grid', 'position', 'alignment'];
  const changes = [];

  for (const change of analysisResults.extractedChanges || []) {
    const lower = change.fullMatch.toLowerCase();
    if (layoutKeywords.some(k => lower.includes(k))) {
      changes.push(change);
    }
  }

  return changes;
}

/**
 * Get default KPIs for a persona
 */
function getDefaultKPIs(persona) {
  const personaKPIs = {
    'Customer Sales': [
      { label: 'Load Count', value: '1,247', change: '+8%', changeType: 'up' },
      { label: 'Margin', value: '$186,420', change: '+12%', changeType: 'up' },
      { label: 'MPL', value: '$149.50', change: 'No change', changeType: 'neutral' },
      { label: 'Margin %', value: '18.4%', change: '+1.2%', changeType: 'up' },
      { label: 'RPL', value: '$812', change: '-2%', changeType: 'down' },
      { label: 'Customer Count', value: '43', change: '+3', changeType: 'up' },
    ],
    'Finance': [
      { label: 'Total Revenue', value: '$2.4M', change: '+6%', changeType: 'up' },
      { label: 'Total Margin', value: '$412K', change: '+9%', changeType: 'up' },
      { label: 'DSO', value: '34 days', change: '+2 days', changeType: 'down' },
      { label: 'AR Aging', value: '$89K', change: '3 overdue', changeType: 'down' },
      { label: 'Cost Per Load', value: '$662', change: '-3%', changeType: 'up' },
      { label: 'Profit Trend', value: '+$48K', change: 'On track', changeType: 'up' },
    ],
    'Operations': [
      { label: 'On-Time Delivery', value: '94.2%', change: 'Above target', changeType: 'up' },
      { label: 'Tender Acceptance', value: '87%', change: '-4%', changeType: 'down' },
      { label: 'Avg Transit Time', value: '2.3 days', change: 'Within target', changeType: 'neutral' },
      { label: 'Carrier Compliance', value: '91%', change: '+2%', changeType: 'up' },
      { label: 'Claims Rate', value: '0.8%', change: 'Below 1%', changeType: 'up' },
      { label: 'Capacity Utilization', value: '78%', change: 'Room to grow', changeType: 'neutral' },
    ],
  };

  return personaKPIs[persona] || personaKPIs['Customer Sales'];
}

/**
 * Get accent color for persona
 */
function getPersonaColor(persona) {
  const colors = {
    'Customer Sales': '#7c3aed',
    'Finance': '#059669',
    'Operations': '#2563eb',
    'Customer Support': '#db2777',
    'Pricing': '#d97706',
  };

  return colors[persona] || BRAND.colors.purple.medium;
}

/**
 * Generate chat message based on analysis
 */
function generateChatMessage(analysisResults) {
  if (analysisResults.extractedChanges && analysisResults.extractedChanges.length > 0) {
    const topChanges = analysisResults.extractedChanges.slice(0, 2).map(c => c.fullMatch).join('. ');
    return `Based on the recent meeting, I've updated the dashboard to reflect: ${topChanges}`;
  }

  return "Good morning! Your dashboard has been updated with the latest data and UI improvements discussed in the meeting.";
}

/**
 * Sanitize filename
 */
function sanitizeFilename(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50);
}

module.exports = {
  generateMockupFromChanges,
  generateMockupWithAI,
  getDefaultKPIs,
  getPersonaColor,
};
