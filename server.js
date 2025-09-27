import express from 'express';
import session from 'express-session';
import dotenv from 'dotenv';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, db } from './src/db.js';
import { GeminiAI } from './src/gemini.js';
import { authRouter } from './src/routes/auth.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'dev-secret',
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 1000 * 60 * 60 * 8 }
    })
);

// Static files
app.use('/', express.static(path.join(__dirname, 'static')));

// Auth routes
app.use('/auth', authRouter);

// Middleware to record recent searches
function recordRecentSearch(email) {
    db.run(
        'INSERT INTO recent_searches (email, time) VALUES (?, ?)',
        [email, new Date().toISOString()],
        () => {}
    );
}

function guessSocialFromEmail(email) {
    const m = /^([A-Za-z]+)\.([A-Za-z]+)@/i.exec(email || '');
    if (!m) return { linkedin: null, facebook: null };
    const first = m[1].toLowerCase();
    const last = m[2].toLowerCase();
    return {
        linkedin: `https://www.linkedin.com/in/${first}-${last}`,
        facebook: `https://www.facebook.com/${first}.${last}`
    };
}

// Improve name extraction fallback from esprit email
function extractFromEspritEmail(email) {
    const m = /^([A-Za-z]+)\.([A-Za-z]+)@esprit\.tn$/.exec(email || '');
    if (!m) return null;
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    return { name: cap(m[1]), familyName: cap(m[2]) };
}

// API: Search alumni
app.get('/api/search', (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email required' });

    db.get('SELECT * FROM alumni WHERE email = ?', [email], (err, row) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        if (!row) {
            const fallback = extractFromEspritEmail(email);
            if (fallback) {
                recordRecentSearch(email);
                const guessed = guessSocialFromEmail(email);
                // Upsert guessed profile so backoffice sees it
                db.run(
                    'INSERT OR REPLACE INTO alumni (email, name, family_name, linkedin, facebook) VALUES (?, ?, ?, ?, ?)',
                    [email, fallback.name, fallback.familyName, guessed.linkedin, guessed.facebook],
                    () => {}
                );
                return res.json({ email, ...fallback, ...guessed, time: new Date().toLocaleString() });
            }
            return res.status(404).json({ error: 'Not found' });
        }

        recordRecentSearch(email);
        res.json({
            email: row.email,
            name: row.name,
            familyName: row.family_name,
            linkedin: row.linkedin,
            facebook: row.facebook,
            time: new Date().toLocaleString()
        });
    });
});

// API: Recent searches
app.get('/api/recent', (req, res) => {
    db.all(
        'SELECT email, time FROM recent_searches ORDER BY id DESC LIMIT 20',
        [],
        (err, rows) => {
            if (err) return res.json([]);
            const items = rows.map((r) => ({ email: r.email, time: r.time }));
            res.json(items);
        }
    );
});

// API: Delete alumni (admin only)
app.delete('/api/alumni/:email', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const email = String(req.params.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email required' });
    
    db.run('DELETE FROM alumni WHERE email = ?', [email], function (err) {
        if (err) {
            console.error('Delete alumni error:', err);
            return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        if (this.changes === 0) return res.status(404).json({ error: 'Alumni not found' });
        res.json({ ok: true, message: 'Alumni deleted successfully' });
    });
});

// API: Admin list alumni
app.get('/api/alumni', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    db.all('SELECT email, name, family_name as familyName, linkedin, facebook FROM alumni ORDER BY email ASC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        res.json(rows);
    });
});

// API: Admin get one alumni
app.get('/api/alumni/:email', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const email = String(req.params.email || '').toLowerCase();
    db.get('SELECT email, name, family_name as familyName, linkedin, facebook FROM alumni WHERE email = ?', [email], (err, row) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        if (!row) return res.status(404).json({ error: 'Not found' });
        res.json(row);
    });
});

// API: Admin update alumni
app.put('/api/alumni/:email', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const email = String(req.params.email || '').toLowerCase();
    const { name, familyName, linkedin, facebook } = req.body || {};
    db.run(
        'UPDATE alumni SET name = ?, family_name = ?, linkedin = ?, facebook = ? WHERE email = ?',
        [name || null, familyName || null, linkedin || null, facebook || null, email],
        function (err) {
            if (err) return res.status(500).json({ error: 'DB error' });
            if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
            res.json({ ok: true });
        }
    );
});

// API: Admin create alumni (insert or replace)
app.post('/api/alumni', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { email, name, familyName, linkedin, facebook } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email required' });
    db.run(
        'INSERT OR REPLACE INTO alumni (email, name, family_name, linkedin, facebook) VALUES (?, ?, ?, ?, ?)',
        [String(email).toLowerCase(), name || null, familyName || null, linkedin || null, facebook || null],
        function (err) {
            if (err) return res.status(500).json({ error: 'DB error' });
            res.json({ ok: true });
        }
    );
});

// API: Alumni connect (public)
app.post('/api/connect', (req, res) => {
    const { email, name, familyName, linkedin, facebook, jobTitle, notes } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email required' });
    db.run(
        'INSERT OR REPLACE INTO alumni (email, name, family_name, linkedin, facebook) VALUES (?, ?, ?, ?, ?)',
        [String(email).toLowerCase(), name || null, familyName || null, linkedin || null, facebook || null],
        (err) => {
            if (err) return res.status(500).json({ error: 'DB error' });
            // Optionally store notes/jobTitle in a separate table later
            res.json({ ok: true });
        }
    );
});

// API: Bulk upload CSV/TXT (admin only)
app.post('/api/bulk-upload', upload.single('file'), (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!req.file) return res.status(400).json({ error: 'File required' });

    const content = req.file.buffer.toString('utf8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    const results = [];

    const stmt = db.prepare(
        'INSERT OR REPLACE INTO alumni (email, name, family_name, linkedin, facebook) VALUES (?, ?, ?, ?, ?)'
    );
    for (const line of lines) {
        // Expected CSV: email,name,familyName,linkedin,facebook
        const [email, name, familyName, linkedin, facebook] = line.split(',').map((s) => (s || '').trim());
        if (!email) continue;
        stmt.run([email.toLowerCase(), name, familyName, linkedin, facebook]);
        results.push({ email });
    }
    stmt.finalize(() => res.json({ results }));
});

// API: Gemini chat
app.post('/api/chat', async (req, res) => {
    try {
        const message = String((req.body && req.body.message) || '').trim();
        if (!message) return res.status(400).json({ error: 'Message required' });
        const gemini = new GeminiAI(process.env.GEMINI_API_KEY);
        const responseText = await gemini.generate(message);
        res.json({ response: responseText || 'No response received from Gemini.' });
    } catch (e) {
        res.status(500).json({ error: 'Gemini error', details: String(e && e.message || e) });
    }
});

// Admin database page placeholder (protect)
app.get('/database', (req, res) => {
    if (!req.session.userId) return res.redirect('/auth/login');
    res.sendFile(path.join(__dirname, 'static', 'database.html'));
});

// Gemini AI page
app.get('/gemini', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'gemini.html'));
});

// Initialize DB and start server
const PORT = process.env.PORT || 3000;
initDb(() => {
    app.listen(PORT, () => {
        console.log(`Server listening on http://localhost:${PORT}`);
    });
});


