// J K S TOURISM website + admin server.
// No dependencies: run with `node server.js` (Node 18+). See README.md.
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'jks-tourism');
const ADMIN_FILE = path.join(__dirname, 'admin', 'index.html');
// Hosts that redeploy by replacing the app folder (e.g. Hostinger) need this outside it: DATA_DIR=~/jks-tourism-data
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR.replace(/^~(?=$|[\\/])/, os.homedir()))
  : path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const FILES = {
  site: path.join(DATA_DIR, 'site.json'),
  enquiries: path.join(DATA_DIR, 'enquiries.json'),
  auth: path.join(DATA_DIR, 'auth.json')
};

const CATEGORIES = ['UAE Experiences', 'International', 'Honeymoon', 'Family Holidays', 'Cruises'];
const STATUSES = ['new', 'contacted', 'booked', 'closed'];
const SESSION_HOURS = 12;
const MAX_UPLOAD = 5 * 1024 * 1024;
const DATA_TAG = /(<script id="site-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN'
};

// ---------- Storage ----------
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
// Write to a temp file then rename, so a crash mid-write never leaves a half-written file.
function writeJSON(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
const save = key => writeJSON(FILES[key], db[key]);

// ---------- Validation ----------
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const newId = () => crypto.randomBytes(6).toString('hex');

function cleanImage(v) {
  const s = str(v, 500);
  return /^https:\/\/[^\s"'<>]+$/i.test(s) || /^\/uploads\/[a-f0-9]{24}\.(jpg|png|webp)$/.test(s) ? s : '';
}

function cleanPackage(p, id) {
  const highlights = Array.isArray(p.highlights) ? p.highlights : String(p.highlights || '').split('\n');
  const pkg = {
    id,
    name: str(p.name, 90),
    dest: str(p.dest, 80),
    category: CATEGORIES.includes(p.category) ? p.category : '',
    price: Math.round(Number(p.price)),
    duration: str(p.duration, 40),
    description: str(p.description, 600),
    highlights: highlights.map(h => str(h, 120)).filter(Boolean).slice(0, 10),
    image: cleanImage(p.image),
    badge: str(p.badge, 24),
    published: p.published !== false
  };
  const errors = [];
  if (!pkg.name) errors.push('Add a package title.');
  if (!pkg.dest) errors.push('Add a destination.');
  if (!pkg.category) errors.push('Choose a category.');
  if (!Number.isFinite(pkg.price) || pkg.price < 0 || pkg.price > 10000000) errors.push('Enter a starting price in AED.');
  if (!pkg.description) errors.push('Add a short description.');
  if (str(p.image, 500) && !pkg.image) errors.push('Use a photo uploaded here or an image link starting with https://.');
  return { pkg, errors };
}

function cleanSettings(s) {
  const settings = {
    whatsapp: String(s.whatsapp ?? '').replace(/\D/g, '').slice(0, 15),
    email: str(s.email, 120),
    phone: str(s.phone, 30),
    location: str(s.location, 80),
    licence: str(s.licence, 80),
    priceNote: str(s.priceNote, 300)
  };
  const errors = [];
  if (settings.whatsapp && !/^[1-9]\d{7,14}$/.test(settings.whatsapp)) errors.push('The WhatsApp number needs the country code and 8 to 15 digits, for example 971501234567.');
  if (!isEmail(settings.email)) errors.push('Enter a valid email address.');
  return { settings, errors };
}

function cleanEnquiry(b) {
  const enquiry = {
    name: str(b.name, 80),
    phone: str(b.phone, 30),
    email: str(b.email, 120),
    destination: str(b.destination, 100),
    dates: str(b.dates, 60),
    travellers: str(b.travellers, 4),
    budget: str(b.budget, 40),
    message: str(b.message, 2000),
    packageId: '',
    packageName: ''
  };
  const pkg = db.site.packages.find(p => p.id === str(b.packageId, 40));
  if (pkg) { enquiry.packageId = pkg.id; enquiry.packageName = pkg.name; }
  const errors = [];
  if (!enquiry.name) errors.push('Enter your name.');
  if (enquiry.phone.replace(/\D/g, '').length < 7) errors.push('Enter a phone or WhatsApp number we can reach you on.');
  if (enquiry.email && !isEmail(enquiry.email)) errors.push('Check your email address.');
  if (!enquiry.destination) errors.push('Tell us where you would like to go.');
  return { enquiry, errors };
}

// ---------- Auth ----------
const sessions = new Map();

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function checkPassword(pw) {
  if (!db.auth || typeof pw !== 'string' || !pw) return false;
  const attempt = crypto.scryptSync(pw, db.auth.salt, 64);
  return crypto.timingSafeEqual(attempt, Buffer.from(db.auth.hash, 'hex'));
}
function setPassword(pw) {
  db.auth = hashPassword(pw);
  save('auth');
  sessions.clear();
}
function newSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_HOURS * 3600e3);
  return token;
}
function getCookie(req, name) {
  const found = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return found ? found.slice(name.length + 1) : '';
}
function isAuthed(req) {
  const token = getCookie(req, 'jks_admin');
  const expires = token && sessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) { sessions.delete(token); return false; }
  return true;
}
function sessionCookie(req, value, maxAge) {
  const secure = process.env.SECURE_COOKIES === '1' || req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
  return `jks_admin=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function limiter(max, windowMs) {
  const hits = new Map();
  return key => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { count: 0, reset: now + windowMs }; hits.set(key, h); }
    h.count++;
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return h.count <= max;
  };
}
const loginLimit = limiter(8, 15 * 60e3);
const enquiryLimit = limiter(8, 60 * 60e3);
const clientIp = req => (process.env.TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;

// ---------- HTTP helpers ----------
const httpError = (status, message) => Object.assign(new Error(message), { status });

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
function json(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}
const notFound = res => send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });

function readBody(req, limit, tooLargeMessage) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        req.removeAllListeners('data');
        req.resume();
        reject(httpError(413, tooLargeMessage || 'The request is too large.'));
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJSONBody(req) {
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) throw httpError(415, 'Send the data as JSON.');
  const raw = (await readBody(req, 100e3)).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw httpError(400, 'The data could not be read.'); }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
function serveFile(res, baseDir, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return notFound(res); }
  const file = path.join(baseDir, path.normalize(rel).replace(/^[/\\]+/, ''));
  if (!file.startsWith(baseDir + path.sep)) return notFound(res);
  const type = MIME[path.extname(file).toLowerCase()];
  if (!type) return notFound(res);
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return notFound(res);
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=3600' });
    fs.createReadStream(file).pipe(res);
  });
}

function sniffImage(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
// Remove an uploaded photo once no package uses it any more.
function removeUnusedUpload(url) {
  if (!url || !url.startsWith('/uploads/') || db.site.packages.some(p => p.image === url)) return;
  fs.unlink(path.join(UPLOAD_DIR, path.basename(url)), () => {});
}

const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet apps treating it as a formula
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// ---------- Pages ----------
function publicData() {
  return {
    settings: db.site.settings,
    packages: db.site.packages.filter(p => p.published).map(({ published, ...p }) => p)
  };
}
function renderIndex(res) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const data = JSON.stringify(publicData()).replace(/</g, '\\u003c');
  send(res, 200, html.replace(DATA_TAG, (_, open, __, close) => open + data + close),
    { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
}

// ---------- API ----------
async function login(req, res) {
  if (!loginLimit(clientIp(req))) return json(res, 429, { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
  const { password } = await readJSONBody(req);
  if (!checkPassword(password)) return json(res, 401, { error: 'That password is not correct.' });
  res.setHeader('Set-Cookie', sessionCookie(req, newSession(), SESSION_HOURS * 3600));
  json(res, 200, { ok: true });
}

async function createEnquiry(req, res) {
  const body = await readJSONBody(req);
  if (body.website) return json(res, 201, { ok: true }); // honeypot field: bots fill it, people never see it
  if (!enquiryLimit(clientIp(req))) return json(res, 429, { error: 'Too many enquiries from this connection. Try again in an hour, or email us directly.' });
  const { enquiry, errors } = cleanEnquiry(body);
  if (errors.length) return json(res, 400, { error: errors.join(' ') });
  Object.assign(enquiry, { id: newId(), createdAt: new Date().toISOString(), status: 'new', notes: '' });
  db.enquiries.unshift(enquiry);
  save('enquiries');
  console.log(`[enquiry] ${enquiry.name} — ${enquiry.destination}`);
  json(res, 201, { ok: true });
}

async function adminApi(req, res, route, method) {
  const [resource, id] = route.split('/');
  const site = db.site;

  if (resource === 'me' && method === 'GET') return json(res, 200, { ok: true });

  if (resource === 'logout' && method === 'POST') {
    sessions.delete(getCookie(req, 'jks_admin'));
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    return json(res, 200, { ok: true });
  }

  if (resource === 'site' && method === 'GET') return json(res, 200, { ...site, categories: CATEGORIES });

  if (resource === 'settings' && method === 'PUT') {
    const { settings, errors } = cleanSettings(await readJSONBody(req));
    if (errors.length) return json(res, 400, { error: errors.join(' ') });
    site.settings = settings;
    save('site');
    return json(res, 200, settings);
  }

  if (resource === 'packages' && method === 'POST' && !id) {
    const { pkg, errors } = cleanPackage(await readJSONBody(req), newId());
    if (errors.length) return json(res, 400, { error: errors.join(' ') });
    site.packages.unshift(pkg);
    save('site');
    return json(res, 201, site.packages);
  }

  if (resource === 'packages' && id) {
    const index = site.packages.findIndex(p => p.id === id);
    if (index < 0) return json(res, 404, { error: 'That package no longer exists.' });
    const old = site.packages[index];
    if (method === 'PUT') {
      const { pkg, errors } = cleanPackage(await readJSONBody(req), id);
      if (errors.length) return json(res, 400, { error: errors.join(' ') });
      site.packages[index] = pkg;
      save('site');
      if (old.image !== pkg.image) removeUnusedUpload(old.image);
      return json(res, 200, site.packages);
    }
    if (method === 'DELETE') {
      site.packages.splice(index, 1);
      save('site');
      removeUnusedUpload(old.image);
      return json(res, 200, site.packages);
    }
  }

  if (resource === 'packages-order' && method === 'PUT') {
    const { ids } = await readJSONBody(req);
    const current = site.packages.map(p => p.id);
    if (!Array.isArray(ids) || ids.length !== current.length || [...ids].sort().join() !== [...current].sort().join()) {
      return json(res, 409, { error: 'Packages changed in another window. Reload the page and try again.' });
    }
    site.packages = ids.map(i => site.packages.find(p => p.id === i));
    save('site');
    return json(res, 200, site.packages);
  }

  if (resource === 'uploads' && method === 'POST') {
    const buf = await readBody(req, MAX_UPLOAD, 'That photo is larger than 5 MB. Choose a smaller one.');
    const ext = sniffImage(buf);
    if (!ext) return json(res, 400, { error: 'Upload a JPG, PNG or WebP photo.' });
    const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    return json(res, 201, { url: '/uploads/' + name });
  }

  if (resource === 'enquiries' && method === 'GET' && !id) return json(res, 200, db.enquiries);

  if (resource === 'enquiries.csv' && method === 'GET') {
    const cols = ['createdAt', 'status', 'name', 'phone', 'email', 'destination', 'packageName', 'dates', 'travellers', 'budget', 'message', 'notes'];
    const csv = '﻿' + [cols.join(','), ...db.enquiries.map(e => cols.map(c => csvCell(e[c])).join(','))].join('\r\n');
    return send(res, 200, csv, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="jks-enquiries-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store'
    });
  }

  if (resource === 'enquiries' && id) {
    const enquiry = db.enquiries.find(e => e.id === id);
    if (!enquiry) return json(res, 404, { error: 'That enquiry no longer exists.' });
    if (method === 'PATCH') {
      const body = await readJSONBody(req);
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) return json(res, 400, { error: 'Unknown status.' });
        enquiry.status = body.status;
      }
      if (body.notes !== undefined) enquiry.notes = str(body.notes, 2000);
      save('enquiries');
      return json(res, 200, enquiry);
    }
    if (method === 'DELETE') {
      db.enquiries = db.enquiries.filter(e => e.id !== id);
      save('enquiries');
      return json(res, 200, { ok: true });
    }
  }

  if (resource === 'password' && method === 'POST') {
    const { current, next } = await readJSONBody(req);
    if (!checkPassword(current)) return json(res, 400, { error: 'Your current password is not correct.' });
    if (typeof next !== 'string' || next.length < 8) return json(res, 400, { error: 'Use at least 8 characters for the new password.' });
    setPassword(next); // signs out every other session
    res.setHeader('Set-Cookie', sessionCookie(req, newSession(), SESSION_HOURS * 3600));
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'Not found.' });
}

async function route(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const method = req.method;

  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/site' && method === 'GET') return json(res, 200, publicData());
    if (pathname === '/api/enquiries' && method === 'POST') return createEnquiry(req, res);
    if (pathname === '/api/admin/login' && method === 'POST') return login(req, res);
    if (!pathname.startsWith('/api/admin/')) return json(res, 404, { error: 'Not found.' });
    if (!isAuthed(req)) return json(res, 401, { error: 'Sign in to continue.' });
    // Custom header blocks cross-site form posts; browsers can't add it without our permission.
    if (method !== 'GET' && req.headers['x-jks-admin'] !== '1') return json(res, 403, { error: 'Request blocked.' });
    return adminApi(req, res, pathname.slice('/api/admin/'.length), method);
  }

  if (method !== 'GET' && method !== 'HEAD') return send(res, 405, 'Method not allowed');
  if (pathname === '/' || pathname === '/index.html') return renderIndex(res);
  if (pathname === '/admin' || pathname === '/admin/') {
    return send(res, 200, fs.readFileSync(ADMIN_FILE), {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex'
    });
  }
  if (pathname.startsWith('/uploads/')) return serveFile(res, UPLOAD_DIR, pathname.slice('/uploads/'.length));
  return serveFile(res, PUBLIC_DIR, pathname);
}

// ---------- Start ----------
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = { site: readJSON(FILES.site, null), enquiries: readJSON(FILES.enquiries, []), auth: readJSON(FILES.auth, null) };

if (!db.site) {
  // First run: start from the packages and settings written into index.html.
  const match = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8').match(DATA_TAG);
  if (!match) throw new Error('jks-tourism/index.html is missing its <script id="site-data"> block.');
  const seed = JSON.parse(match[2]);
  db.site = {
    settings: cleanSettings(seed.settings || {}).settings,
    packages: (seed.packages || []).map(p => cleanPackage(p, str(p.id, 40) || newId()).pkg)
  };
  save('site');
}
if (!fs.existsSync(FILES.enquiries)) save('enquiries');

const resetPassword = process.argv.includes('--reset-password');
if (!db.auth || resetPassword) {
  const fromEnv = !resetPassword && process.env.ADMIN_PASSWORD;
  const password = fromEnv || crypto.randomBytes(9).toString('base64url');
  setPassword(password);
  console.log('\n  Admin password ' + (fromEnv ? 'set from ADMIN_PASSWORD.' : 'created: ' + password) +
    '\n  Sign in at /admin and change it under Settings.\n');
}

http.createServer((req, res) => {
  route(req, res).catch(e => {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Something went wrong on the server. Try again.' : e.message });
    else res.end();
  });
}).listen(PORT, HOST, () => {
  console.log(`  Website: http://localhost:${PORT}/\n  Admin:   http://localhost:${PORT}/admin\n  Data:    ${DATA_DIR}`);
});
