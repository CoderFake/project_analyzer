/**
 * File Parsers — XLSX, DOCX, MD, URL, Redmine → plain text
 */

import { readFileSync } from 'fs';
import { extname } from 'path';
import type { SpecSourceType } from '../types.js';
import { log } from '../utils.js';

export interface ParseResult {
  text: string;
  sourceType: SpecSourceType;
}

/**
 * Detect source type and parse to plain text.
 */
export async function parseInput(input: {
  filePath?: string;
  url?: string;
  text?: string;
  redmineApiKey?: string;
}): Promise<ParseResult> {
  if (input.text) {
    return { text: input.text, sourceType: 'text' };
  }

  if (input.filePath) {
    return parseFile(input.filePath);
  }

  if (input.url) {
    return parseUrl(input.url, input.redmineApiKey);
  }

  throw new Error('No input provided. Provide filePath, url, or text.');
}

// ─── File Parsing ───
async function parseFile(filePath: string): Promise<ParseResult> {
  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case '.md':
    case '.txt':
      return { text: readFileSync(filePath, 'utf-8'), sourceType: 'md' };

    case '.xlsx':
    case '.xls':
      return parseXlsx(filePath);

    case '.docx':
      return parseDocx(filePath);

    default:
      // Try reading as text
      log.warn(`Unknown file extension: ${ext}, trying as text`);
      return { text: readFileSync(filePath, 'utf-8'), sourceType: 'text' };
  }
}

// ─── XLSX ───
async function parseXlsx(filePath: string): Promise<ParseResult> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.readFile(filePath);

  const sheets: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    sheets.push(`## Sheet: ${sheetName}\n\n${csv}`);
  }

  return { text: sheets.join('\n\n---\n\n'), sourceType: 'xlsx' };
}

// ─── DOCX ───
async function parseDocx(filePath: string): Promise<ParseResult> {
  const mammoth = await import('mammoth');
  const buffer = readFileSync(filePath);
  const result = await mammoth.convertToHtml({ buffer });

  if (result.messages.length > 0) {
    log.warn(`DOCX conversion warnings: ${result.messages.map((m: any) => m.message).join(', ')}`);
  }

  // Strip HTML tags to get plain text with structure
  const text = result.value
    .replace(/<h([1-6])[^>]*>/gi, (_, level: string) => '\n' + '#'.repeat(parseInt(level)) + ' ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, sourceType: 'docx' };
}

// ─── URL Parsing ───
async function parseUrl(url: string, redmineApiKey?: string): Promise<ParseResult> {
  // Check if Redmine URL
  const redmineMatch = url.match(/\/issues\/(\d+)/);
  if (redmineMatch && redmineApiKey) {
    return parseRedmine(url, redmineMatch[1], redmineApiKey);
  }

  // Generic URL — fetch and extract text
  return fetchUrlAsText(url);
}

// ─── Redmine ───
async function parseRedmine(
  baseUrl: string,
  issueId: string,
  apiKey: string
): Promise<ParseResult> {
  const urlObj = new URL(baseUrl);
  const apiUrl = `${urlObj.protocol}//${urlObj.host}/issues/${issueId}.json?include=journals,attachments`;

  log.info(`Fetching Redmine issue #${issueId}`);

  const response = await fetch(apiUrl, {
    headers: { 'X-Redmine-API-Key': apiKey },
  });

  if (!response.ok) {
    throw new Error(`Redmine API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as any;
  const issue = data.issue;

  const parts = [
    `# Issue #${issue.id}: ${issue.subject}`,
    `**Status:** ${issue.status?.name}`,
    `**Priority:** ${issue.priority?.name}`,
    `**Assignee:** ${issue.assigned_to?.name ?? 'Unassigned'}`,
    `**Tracker:** ${issue.tracker?.name}`,
    '',
    '## Description',
    issue.description ?? '(no description)',
  ];

  // Include journals (comments)
  if (issue.journals?.length > 0) {
    parts.push('', '## Comments');
    for (const journal of issue.journals) {
      if (journal.notes) {
        parts.push(`\n### ${journal.user?.name} (${journal.created_on})`);
        parts.push(journal.notes);
      }
    }
  }

  return { text: parts.join('\n'), sourceType: 'redmine' };
}

// ─── Generic URL ───
async function fetchUrlAsText(url: string): Promise<ParseResult> {
  log.info(`Fetching URL: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();

  if (contentType.includes('text/html')) {
    // Simple HTML → text extraction (strip tags)
    const text = body
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { text, sourceType: 'url' };
  }

  return { text: body, sourceType: 'url' };
}
