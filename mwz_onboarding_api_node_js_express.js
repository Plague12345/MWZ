// MWZ Onboarding API — Node.js/Express
// Purpose: accept onboarding JSON from the frontend and commit it to a GitHub repo
// Endpoints:
//   POST /save   -> { profile, checks }  => commits saves/<slug>.json (upsert)
//   GET  /load/:slug  -> returns saved JSON from repo
//
// Security: keep the GitHub token server-side only. Optionally set API_KEY to require a shared secret.
//
// Usage:
//   1) Set env vars (see below).
//   2) `npm i express node-fetch@3 cors`  (or use axios if preferred)
//   3) `node server.js`
//   4) In the frontend, POST to https://<your-host>/save and GET https://<your-host>/load/<slug>

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

// ----- Config via environment variables -----
const {
  PORT = 8787,
  API_KEY = '', // optional. If set, clients must pass header: x-api-key: <API_KEY>
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH = 'main',
  GITHUB_DIR = 'saves', // folder in repo where files are written
} = process.env;

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.error('Missing required env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Optional shared-secret middleware
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const key = req.header('x-api-key');
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

// Helpers
const ghBase = 'https://api.github.com';
const repoPath = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;

function slugify(input) {
  const s = String(input || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '') || 'player';
  return s;
}

async function githubGetContent(path) {
  const url = `${ghBase}${repoPath}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'mwz-onboarding-api' } });
  if (resp.status === 404) return null; // file not found
  if (!resp.ok) throw new Error(`GitHub GET failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function githubUpsertFile(path, contentJson, message) {
  // Get current sha if file exists
  let sha = null;
  const existing = await githubGetContent(path);
  if (existing && existing.sha) sha = existing.sha;

  const url = `${ghBase}${repoPath}/contents/${encodeURIComponent(path)}`;
  const body = {
    message: message || `Update ${path}`,
    content: Buffer.from(JSON.stringify(contentJson, null, 2)).toString('base64'),
    branch: GITHUB_BRANCH,
    ...(sha ? { sha } : {}),
  };
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'User-Agent': 'mwz-onboarding-api',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`GitHub PUT failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

// Routes
app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/save', async (req, res) => {
  try {
    const { profile, checks } = req.body || {};
    if (!profile || !checks) return res.status(400).json({ error: 'Missing profile or checks' });
    const slug = slugify(profile.discord);
    const path = `${GITHUB_DIR}/${slug}.json`;
    const payload = { profile, checks, savedAt: new Date().toISOString(), version: 1 };
    const result = await githubUpsertFile(path, payload, `Onboarding save for ${profile.discord || slug}`);
    res.json({ ok: true, path, commit: result.commit?.sha || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get('/load/:slug', async (req, res) => {
  try {
    const slug = slugify(req.params.slug);
    const path = `${GITHUB_DIR}/${slug}.json`;
    const data = await githubGetContent(path);
    if (!data) return res.status(404).json({ error: 'Not found' });
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    res.setHeader('Content-Type', 'application/json');
    res.send(content);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`MWZ Onboarding API listening on :${PORT}`);
});

/*
Env vars example (Render/Heroku/.env):
PORT=8787
API_KEY=some-shared-secret                # optional
GITHUB_TOKEN=ghp_************************ # repo scope
GITHUB_OWNER=YourGitHubUserOrOrg
GITHUB_REPO=your-repo-name
GITHUB_BRANCH=main
GITHUB_DIR=saves
*/
