import express from 'express';
import * as jobs from './jobs/index.js';
import { dispatch } from './scheduler.js';
import { logger } from './lib/logger.js';
import type { Job } from './types.js';

const jobMap = new Map<string, Job>(
  Object.values(jobs).map((j) => [j.id, j]),
);

export const app = express();

app.get('/api/jobs', (_req, res) => {
  res.json(
    Array.from(jobMap.values()).map((j) => ({
      id: j.id,
      description: j.description,
      schedule: j.schedule,
      enabled: j.enabled,
    })),
  );
});

app.post('/api/jobs/:id/run', async (req, res) => {
  const job = jobMap.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: `Job '${req.params.id}' not found` });
    return;
  }

  const sent = await dispatch(job);
  if (sent === null) {
    res.status(500).json({ error: 'Job failed — check container logs' });
    return;
  }

  res.json({ id: job.id, sent });
});

app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(dashboardHtml());
});

function dashboardHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Harold</title>
  <style>
    :root {
      /* transitions.dev — panel reveal (result box) */
      --panel-open-dur: 400ms;
      --panel-close-dur: 350ms;
      --panel-translate-y: 10px; /* shorter travel than the 100px default — this panel is small */
      --panel-blur: 2px;
      --panel-ease: cubic-bezier(0.22, 1, 0.36, 1);
      /* transitions.dev — text states swap (Run now / Running…) */
      --text-swap-dur: 150ms;
      --text-swap-translate-y: 4px;
      --text-swap-blur: 2px;
      --text-swap-ease: ease-in-out;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0d0d0d;
      color: #d4d4d4;
      padding: 2rem;
      min-height: 100vh;
    }
    header {
      display: flex;
      align-items: baseline;
      gap: 0.75rem;
      margin-bottom: 2rem;
    }
    h1 { font-size: 1.5rem; color: #fff; font-weight: 700; }
    .subtitle { font-size: 0.85rem; color: #555; }
    .jobs { display: grid; gap: 0.75rem; max-width: 680px; }
    .job {
      background: #171717;
      border: 1px solid #262626;
      border-radius: 10px;
      padding: 1.25rem;
    }
    .job-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.4rem;
    }
    .job-id { font-weight: 600; font-size: 0.95rem; color: #fff; }
    .badge {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 9px;
      border-radius: 999px;
      letter-spacing: 0.03em;
    }
    .on  { background: #14532d; color: #86efac; }
    .off { background: #450a0a; color: #fca5a5; }
    .job-desc  { font-size: 0.85rem; color: #737373; margin-bottom: 0.4rem; }
    .job-sched { font-size: 0.78rem; font-family: monospace; color: #525252; margin-bottom: 1rem; }
    .run-btn {
      background: #2563eb;
      color: #fff;
      border: none;
      padding: 0.45rem 1rem;
      border-radius: 6px;
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      /* transitions.dev — text states swap base state, plus the existing hover fade */
      display: inline-block;
      transform: translateY(0);
      filter: blur(0);
      opacity: 1;
      transition:
        background  0.15s,
        transform   var(--text-swap-dur) var(--text-swap-ease),
        filter      var(--text-swap-dur) var(--text-swap-ease),
        opacity     var(--text-swap-dur) var(--text-swap-ease);
      will-change: transform, filter, opacity;
    }
    .run-btn:hover:not(:disabled) { background: #1d4ed8; }
    .run-btn:disabled { background: #262626; color: #525252; cursor: not-allowed; }
    /* transitions.dev — text states swap, applied to .run-btn's own label */
    .run-btn.is-exit {
      transform: translateY(calc(var(--text-swap-translate-y) * -1));
      filter: blur(var(--text-swap-blur));
      opacity: 0;
    }
    .run-btn.is-enter-start {
      transform: translateY(var(--text-swap-translate-y));
      filter: blur(var(--text-swap-blur));
      opacity: 0;
      transition: none;
    }
    /* transitions.dev — panel reveal */
    .result {
      margin-top: 0.75rem;
      padding: 0.75rem;
      background: #0a0a0a;
      border: 1px solid #1f1f1f;
      border-radius: 6px;
      font-size: 0.82rem;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.5;
      transform: translateY(var(--panel-translate-y));
      opacity: 0;
      filter: blur(var(--panel-blur));
      pointer-events: none;
      transition:
        transform var(--panel-close-dur) var(--panel-ease),
        opacity   var(--panel-close-dur) var(--panel-ease),
        filter    var(--panel-close-dur) var(--panel-ease);
      will-change: transform, opacity, filter;
    }
    .result[data-open="true"] {
      transform: translateY(0);
      opacity: 1;
      filter: blur(0);
      pointer-events: auto;
      transition:
        transform var(--panel-open-dur) var(--panel-ease),
        opacity   var(--panel-open-dur) var(--panel-ease),
        filter    var(--panel-open-dur) var(--panel-ease);
    }
    .result.ok  { color: #86efac; border-color: #14532d; }
    .result.err { color: #fca5a5; border-color: #450a0a; }
    .error-state { color: #737373; font-size: 0.9rem; }

    @media (prefers-reduced-motion: reduce) {
      .run-btn, .result { transition: none !important; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Harold</h1>
    <span class="subtitle">personal assistant</span>
  </header>
  <div class="jobs" id="jobs"><p class="error-state">Loading…</p></div>
  <script>
    async function load() {
      const container = document.getElementById('jobs');
      try {
        const res = await fetch('/api/jobs');
        if (!res.ok) throw new Error('Failed to load jobs');
        const jobs = await res.json();
        container.innerHTML = '';
        if (jobs.length === 0) {
          container.innerHTML = '<p class="error-state">No jobs registered.</p>';
          return;
        }
        jobs.forEach(job => container.appendChild(card(job)));
      } catch (e) {
        container.innerHTML = '<p class="error-state">Could not reach Harold API.</p>';
      }
    }

    function card(job) {
      const el = document.createElement('div');
      el.className = 'job';
      el.innerHTML = \`
        <div class="job-header">
          <span class="job-id">\${esc(job.id)}</span>
          <span class="badge \${job.enabled ? 'on' : 'off'}">\${job.enabled ? 'enabled' : 'disabled'}</span>
        </div>
        <div class="job-desc">\${esc(job.description)}</div>
        <div class="job-sched">\${esc(job.schedule)}</div>
        <button class="run-btn" id="btn-\${esc(job.id)}">Run now</button>
        <pre class="result" id="result-\${esc(job.id)}"></pre>
      \`;
      el.querySelector('.run-btn').addEventListener('click', () => run(job.id));
      return el;
    }

    // transitions.dev — text states swap: three-phase text change on any element.
    function swapText(el, next) {
      const dur = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--text-swap-dur'),
      ) || 150;
      el.classList.add('is-exit');
      setTimeout(() => {
        el.textContent = next;
        el.classList.remove('is-exit');
        el.classList.add('is-enter-start');
        void el.offsetHeight; // force reflow so the next change transitions
        el.classList.remove('is-enter-start');
      }, dur);
    }

    async function run(id) {
      const btn = document.getElementById('btn-' + id);
      const out = document.getElementById('result-' + id);
      btn.disabled = true;
      swapText(btn, 'Running…');
      out.className = 'result';
      out.dataset.open = 'true';
      out.textContent = 'Running…';
      try {
        const res = await fetch('/api/jobs/' + id + '/run', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          out.className = 'result ok';
          out.dataset.open = 'true';
          out.textContent = data.sent;
        } else {
          out.className = 'result err';
          out.dataset.open = 'true';
          out.textContent = data.error ?? 'Unknown error';
        }
      } catch (e) {
        out.className = 'result err';
        out.dataset.open = 'true';
        out.textContent = e.message;
      } finally {
        btn.disabled = false;
        swapText(btn, 'Run now');
      }
    }

    function esc(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    load();
  </script>
</body>
</html>`;
}

export function startServer(): void {
  const port = parseInt(process.env.DASHBOARD_PORT ?? '8080', 10);
  app.listen(port, () => {
    logger.info('dashboard', `listening on http://localhost:${port}`);
  });
}
