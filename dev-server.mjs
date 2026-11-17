import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import tuuCrearPago from './api/tuu-crear-pago.js';
import tuuWebhook from './api/tuu-webhook.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8080;

// Cargar variables de .env.local en process.env
const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function wrapRes(nodeRes) {
  return {
    status(code) { nodeRes.statusCode = code; return this; },
    json(obj) {
      nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
      nodeRes.end(JSON.stringify(obj));
    }
  };
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath === '/api/tuu-crear-pago' || urlPath === '/api/tuu-webhook') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const ctype = String(req.headers['content-type'] || '').toLowerCase();
    if (ctype.includes('application/x-www-form-urlencoded')) {
      req.body = Object.fromEntries(new URLSearchParams(raw));
    } else {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
    }
    const handler = urlPath === '/api/tuu-crear-pago' ? tuuCrearPago : tuuWebhook;
    return handler(req, wrapRes(res));
  }

  let filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`NICOLE-V2 local server + API running on http://127.0.0.1:${PORT}`);
});
