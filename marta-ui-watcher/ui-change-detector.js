/**
 * UI Change Detector
 * Analyzes transcripts for UI/design changes
 */

const fs = require('fs');
const path = require('path');

// Load keywords
const keywordsPath = path.join(__dirname, '..', 'config', 'ui-keywords.json');
const KEYWORDS = JSON.parse(fs.readFileSync(keywordsPath, 'utf-8'));

// Flatten all positive keywords into a single array
const ALL_POSITIVE_KEYWORDS = [
  ...KEYWORDS.component_references,
  ...KEYWORDS.design_terms,
  ...KEYWORDS.action_terms,
  ...KEYWORDS.marta_phrases,
  ...KEYWORDS.feature_terms,
  ...KEYWORDS.data_display_terms,
];

const NEGATIVE_KEYWORDS = KEYWORDS.negative_indicators;

/**
 * Analyze transcript for UI changes
 */
function analyzeTranscript(transcript) {
  const lowerTranscript = transcript.toLowerCase();
  const lines = transcript.split('\n');

  const results = {
    hasUIChanges: false,
    confidence: 0,
    matchedKeywords: [],
    matchedPhrases: [],
    extractedChanges: [],
    negativeIndicators: [],
    relevantSegments: [],
  };

  // Check for negative indicators first
  for (const negative of NEGATIVE_KEYWORDS) {
    if (lowerTranscript.includes(negative.toLowerCase())) {
      results.negativeIndicators.push(negative);
    }
  }

  // Count keyword matches
  const keywordCounts = {};
  for (const keyword of ALL_POSITIVE_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'gi');
    const matches = lowerTranscript.match(regex);
    if (matches && matches.length > 0) {
      keywordCounts[keyword] = matches.length;
      results.matchedKeywords.push({ keyword, count: matches.length });
    }
  }

  // Check for Marta-specific phrases
  for (const phrase of KEYWORDS.marta_phrases) {
    if (lowerTranscript.includes(phrase.toLowerCase())) {
      results.matchedPhrases.push(phrase);
    }
  }

  // Extract relevant segments (lines containing UI keywords)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    const matchedInLine = [];

    for (const keyword of ALL_POSITIVE_KEYWORDS) {
      if (line.includes(keyword.toLowerCase())) {
        matchedInLine.push(keyword);
      }
    }

    if (matchedInLine.length >= 2) {
      // Line has multiple UI-related keywords
      results.relevantSegments.push({
        lineNumber: i + 1,
        text: lines[i],
        keywords: matchedInLine,
      });
    }
  }

  // Extract specific change requests
  const changePatterns = [
    /(?:can we|let's|we should|need to|want to)\s+(add|remove|change|update|fix|move|hide|show)\s+(.+?)(?:\.|$)/gi,
    /(?:remove|delete|add|change)\s+(?:the|this|that)?\s*(.+?)(?:\.|$)/gi,
    /(metrics|KPI|KPIs|card|cards|button|header|layout|colors?)\s+(?:should|need to|will)\s+(.+?)(?:\.|$)/gi,
  ];

  for (const pattern of changePatterns) {
    let match;
    while ((match = pattern.exec(transcript)) !== null) {
      results.extractedChanges.push({
        fullMatch: match[0].trim(),
        action: match[1] || 'change',
        target: match[2] || match[1],
      });
    }
  }

  // Calculate confidence score
  const keywordScore = results.matchedKeywords.length * 2;
  const phraseScore = results.matchedPhrases.length * 5;
  const segmentScore = results.relevantSegments.length * 3;
  const changeScore = results.extractedChanges.length * 10;
  const negativeScore = results.negativeIndicators.length * -15;

  const totalScore = keywordScore + phraseScore + segmentScore + changeScore + negativeScore;

  // Normalize to 0-100
  results.confidence = Math.min(100, Math.max(0, totalScore));

  // Determine if UI changes detected (threshold: 20)
  results.hasUIChanges = results.confidence >= 20 && results.negativeIndicators.length === 0;

  return results;
}

/**
 * Generate a summary of UI changes for GitHub/Slack
 */
function generateChangeSummary(analysisResults, meetingTitle = 'Meeting') {
  if (!analysisResults.hasUIChanges) {
    return null;
  }

  let summary = `## UI Changes Detected: ${meetingTitle}\n\n`;
  summary += `**Confidence:** ${analysisResults.confidence}%\n\n`;

  if (analysisResults.extractedChanges.length > 0) {
    summary += `### Specific Changes Mentioned\n`;
    for (const change of analysisResults.extractedChanges.slice(0, 10)) {
      summary += `- ${change.fullMatch}\n`;
    }
    summary += '\n';
  }

  if (analysisResults.matchedPhrases.length > 0) {
    summary += `### Key Phrases\n`;
    for (const phrase of analysisResults.matchedPhrases.slice(0, 5)) {
      summary += `- "${phrase}"\n`;
    }
    summary += '\n';
  }

  if (analysisResults.relevantSegments.length > 0) {
    summary += `### Relevant Discussion Segments\n`;
    for (const segment of analysisResults.relevantSegments.slice(0, 5)) {
      summary += `> ${segment.text.substring(0, 200)}${segment.text.length > 200 ? '...' : ''}\n\n`;
    }
  }

  const topKeywords = analysisResults.matchedKeywords
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map(k => `${k.keyword} (${k.count})`)
    .join(', ');

  if (topKeywords) {
    summary += `### Top Keywords\n${topKeywords}\n`;
  }

  return summary;
}

/**
 * Categorize UI changes by type
 */
function categorizeChanges(analysisResults) {
  const categories = {
    layout: [],
    styling: [],
    components: [],
    data: [],
    features: [],
    other: [],
  };

  const layoutKeywords = ['layout', 'centered', 'spacing', 'alignment', 'position', 'grid', 'flex'];
  const stylingKeywords = ['color', 'font', 'style', 'theme', 'dark', 'light', 'shadow', 'border'];
  const componentKeywords = ['button', 'card', 'header', 'modal', 'table', 'chart', 'input'];
  const dataKeywords = ['metrics', 'KPI', 'data', 'numbers', 'statistics', 'percentage'];
  const featureKeywords = ['add', 'remove', 'export', 'filter', 'search', 'pin'];

  for (const change of analysisResults.extractedChanges) {
    const lowerChange = change.fullMatch.toLowerCase();

    if (layoutKeywords.some(k => lowerChange.includes(k))) {
      categories.layout.push(change);
    } else if (stylingKeywords.some(k => lowerChange.includes(k))) {
      categories.styling.push(change);
    } else if (componentKeywords.some(k => lowerChange.includes(k))) {
      categories.components.push(change);
    } else if (dataKeywords.some(k => lowerChange.includes(k))) {
      categories.data.push(change);
    } else if (featureKeywords.some(k => lowerChange.includes(k))) {
      categories.features.push(change);
    } else {
      categories.other.push(change);
    }
  }

  return categories;
}

module.exports = {
  analyzeTranscript,
  generateChangeSummary,
  categorizeChanges,
  KEYWORDS,
};
