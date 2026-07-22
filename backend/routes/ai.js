// ===== AI ASSISTANT MODULE (Rovo-style wiki intelligence) =====
// A thin server-side proxy to the Anthropic API. The API key never leaves the
// server; the frontend only ever calls these endpoints.
//
// GET  /api/ai/status              - Whether AI is configured (frontend gates UI on this)
// POST /api/ai/summarize           - Summarize a wiki page (page_id) or raw text
// POST /api/ai/write               - Draft or improve prose (action + text/prompt) → HTML
// POST /api/ai/ask                 - Ask a question; answered from wiki content with citations
//
// All calls are non-streaming with modest max_tokens (short, interactive
// responses that stay well under HTTP timeouts). Thinking is left off for
// latency — these are quick assist actions, not long-horizon reasoning.

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const { getDb, queryOne, queryAll } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');
const { sanitizeRichText } = require('../utils/sanitize');

const router = express.Router();

const MODELS = config.ai.models;

let client = null;
function getClient() {
  if (!config.ai.enabled()) return null;
  if (!client) client = new Anthropic({ apiKey: config.ai.apiKey });
  return client;
}

// Guard every AI endpoint: a clear 503 when no key is configured, so the app
// stays fully usable and the UI can hide/disable AI affordances.
function requireAI(req, res, next) {
  if (!config.ai.enabled()) {
    return res.status(503).json({ error: 'AI is not configured. Set ANTHROPIC_API_KEY on the server to enable it.', ai_unconfigured: true });
  }
  next();
}

// Strip HTML tags to plain text for prompting (page bodies are HTML).
function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Pull the first text block out of a Messages response.
function firstText(message) {
  const block = (message.content || []).find((b) => b.type === 'text');
  return block ? block.text.trim() : '';
}

async function complete({ model, system, user, maxTokens }) {
  const c = getClient();
  const message = await c.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (message.stop_reason === 'refusal') {
    const err = new Error('The assistant declined to answer that request.');
    err.status = 422;
    throw err;
  }
  return firstText(message);
}

// GET /api/ai/status
router.get('/ai/status', requireAuth, (req, res) => {
  const on = config.ai.enabled();
  res.json({ enabled: on, model: on ? MODELS.ask : null, models: on ? MODELS : null });
});

// POST /api/ai/summarize  { page_id? , text? }
router.post('/ai/summarize', requireAuth, requireAI, async (req, res) => {
  try {
    let text = req.body.text;
    let title = req.body.title || '';
    if (req.body.page_id) {
      const db = await getDb();
      const page = await queryOne(db, 'SELECT title, body FROM wiki_pages WHERE id = ?', [req.body.page_id]);
      if (!page) return res.status(404).json({ error: 'Page not found' });
      title = page.title;
      text = htmlToText(page.body);
    } else {
      text = htmlToText(text);
    }
    if (!text || text.length < 40) return res.status(400).json({ error: 'Not enough content to summarize' });

    const summary = await complete({
      model: MODELS.summary,
      system: 'You summarize wiki documentation crisply for a busy reader. Reply with 3–5 short bullet points capturing the key takeaways, each on its own line beginning with "- ". No preamble, no heading, no closing remark.',
      user: `Summarize this page${title ? ` titled "${title}"` : ''}:\n\n${text.slice(0, 24000)}`,
      maxTokens: 512,
    });
    res.json({ summary });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    serverError(res, e);
  }
});

// POST /api/ai/write  { action, text?, prompt? }
// action: 'draft' | 'improve' | 'shorten' | 'expand' | 'fix'
const WRITE_ACTIONS = {
  draft: 'Write a first draft of a wiki page for the topic below. Use clear headings (<h2>), short paragraphs, and bullet lists where useful.',
  improve: 'Rewrite the passage below to be clearer and better organized, preserving all facts and meaning. Keep the author\'s intent.',
  shorten: 'Rewrite the passage below to be more concise, keeping every key point.',
  expand: 'Expand the passage below with helpful detail, structure, and examples, without inventing facts.',
  fix: 'Fix spelling, grammar, and punctuation in the passage below. Do not change meaning, tone, or wording beyond what the corrections require.',
};

router.post('/ai/write', requireAuth, requireAI, async (req, res) => {
  try {
    const action = String(req.body.action || 'improve');
    const instruction = WRITE_ACTIONS[action];
    if (!instruction) return res.status(400).json({ error: 'Unknown action' });

    const source = action === 'draft' ? (req.body.prompt || '') : htmlToText(req.body.text || '');
    if (!source.trim()) return res.status(400).json({ error: action === 'draft' ? 'Describe what to write about' : 'No text provided' });

    const html = await complete({
      model: MODELS.write,
      system: 'You are a writing assistant embedded in a wiki editor. Reply with clean semantic HTML only — use <h2>/<h3>, <p>, <ul>/<ol>/<li>, <strong>, <em>, <blockquote>, <pre><code>. Do not wrap the output in <html> or <body>, do not use markdown fences, and add no commentary before or after the content.',
      user: `${instruction}\n\n---\n${source.slice(0, 24000)}`,
      maxTokens: 2048,
    });
    // Same sanitising path as any user-authored wiki HTML.
    res.json({ html: sanitizeRichText(html) });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    serverError(res, e);
  }
});

// POST /api/ai/ask  { question, space_id? }
// Retrieves the most relevant wiki pages (keyword overlap) and answers from them.
router.post('/ai/ask', requireAuth, requireAI, async (req, res) => {
  try {
    const question = String(req.body.question || '').trim();
    if (question.length < 3) return res.status(400).json({ error: 'Ask a question' });

    const db = await getDb();
    // Candidate pages, optionally scoped to a space. Rank by keyword overlap of
    // the question terms against title + body, then take the top few as context.
    const params = [];
    let sql = "SELECT id, title, body, space_id FROM wiki_pages WHERE status = 'current'";
    if (req.body.space_id) { sql += ' AND space_id = ?'; params.push(req.body.space_id); }
    const pages = await queryAll(db, sql, params);

    const terms = question.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
    const scored = pages.map((p) => {
      const hay = `${p.title} ${htmlToText(p.body)}`.toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += hay.split(t).length - 1;
      // Title hits weigh more.
      const titleLc = p.title.toLowerCase();
      for (const t of terms) if (titleLc.includes(t)) score += 5;
      return { p, score };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);

    if (scored.length === 0) {
      return res.json({ answer: "I couldn't find anything about that in the wiki.", sources: [] });
    }

    const context = scored.map(({ p }, i) =>
      `[${i + 1}] ${p.title}\n${htmlToText(p.body).slice(0, 4000)}`).join('\n\n---\n\n');

    const answer = await complete({
      model: MODELS.ask,
      system: 'You answer questions using ONLY the provided wiki excerpts. Cite the sources you used inline as [1], [2], etc. If the excerpts do not contain the answer, say so plainly. Be concise and direct.',
      user: `Question: ${question}\n\nWiki excerpts:\n\n${context}`,
      maxTokens: 1024,
    });

    res.json({
      answer,
      sources: scored.map(({ p }, i) => ({ index: i + 1, id: p.id, title: p.title, space_id: p.space_id })),
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    serverError(res, e);
  }
});

module.exports = router;
// Exported so other routes can make a model call without duplicating the
// client, the refusal handling, or model selection. Same shape as
// routes/wiki.js exporting pageAccess and routes/workflows.js exporting
// projectStatuses — routes sharing helpers with routes, rather than a util
// requiring a route (which is what forced the in-function require in
// utils/insight-origin.js).
module.exports.complete = complete;
module.exports.aiEnabled = () => config.ai.enabled();
module.exports.MODELS = MODELS;
