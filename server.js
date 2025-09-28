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
        
        // Also delete from recent searches
        db.run('DELETE FROM recent_searches WHERE email = ?', [email], (err2) => {
            if (err2) {
                console.error('Delete from recent searches error:', err2);
                // Don't fail the request if this fails, just log it
            }
            res.json({ ok: true, message: 'Alumni deleted successfully' });
        });
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

// API: Clear recent searches (admin only)
app.post('/api/clear-searches', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    db.run('DELETE FROM recent_searches', [], function (err) {
        if (err) return res.status(500).json({ error: 'DB error' });
        res.json({ ok: true });
    });
});

// API: Bulk delete alumni (admin only)
app.post('/api/alumni/bulk-delete', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { emails } = req.body;
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: 'No emails provided' });
    }
    
    const placeholders = emails.map(() => '?').join(',');
    db.run(`DELETE FROM alumni WHERE email IN (${placeholders})`, emails, function (err) {
        if (err) {
            console.error('Bulk delete error:', err);
            return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        
        // Also delete from recent searches
        db.run(`DELETE FROM recent_searches WHERE email IN (${placeholders})`, emails, (err2) => {
            if (err2) {
                console.error('Bulk delete from recent searches error:', err2);
                // Don't fail the request if this fails, just log it
            }
            res.json({ ok: true, deleted: this.changes });
        });
    });
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
        
        // Extract names from email if not provided
        let finalName = name;
        let finalFamilyName = familyName;
        
        if (!finalName || !finalFamilyName) {
            const extracted = extractFromEspritEmail(email);
            if (extracted) {
                finalName = finalName || extracted.name;
                finalFamilyName = finalFamilyName || extracted.familyName;
            }
        }
        
        // Generate social links if not provided
        let finalLinkedin = linkedin;
        let finalFacebook = facebook;
        
        if (!finalLinkedin || !finalFacebook) {
            const guessed = guessSocialFromEmail(email);
            finalLinkedin = finalLinkedin || guessed.linkedin;
            finalFacebook = finalFacebook || guessed.facebook;
        }
        
        stmt.run([email.toLowerCase(), finalName, finalFamilyName, finalLinkedin, finalFacebook]);
        
        // Record each email as a recent search
        recordRecentSearch(email.toLowerCase());
        
        results.push({ 
            email, 
            name: finalName, 
            familyName: finalFamilyName, 
            linkedin: finalLinkedin, 
            facebook: finalFacebook 
        });
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

// API: Get all admins
app.get('/api/admins', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    
    db.all('SELECT id, email FROM admins ORDER BY email', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(rows);
    });
});

// API: Add admin
app.post('/api/add-admin', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
        
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
        
        const bcrypt = await import('bcrypt');
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run('INSERT INTO admins (email, password_hash) VALUES (?, ?)', 
            [email, hashedPassword], 
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: 'Admin with this email already exists' });
                    }
                    return res.status(500).json({ error: 'Database error' });
                }
                res.json({ success: true, message: 'Admin added successfully' });
            }
        );
    } catch (e) {
        res.status(500).json({ error: 'Server error', details: String(e) });
    }
});

// API: Update admin
app.post('/api/update-admin', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    
    const { id, email, password } = req.body;
    if (!id || !email) return res.status(400).json({ error: 'ID and email required' });
    
    try {
        if (password && password.trim() !== '') {
            // Update both email and password
            const bcrypt = await import('bcrypt');
            const hashedPassword = await bcrypt.hash(password, 10);
            
            db.run('UPDATE admins SET email = ?, password_hash = ? WHERE id = ?', 
                [email, hashedPassword, id], 
                function(err) {
                    if (err) {
                        if (err.message.includes('UNIQUE constraint failed')) {
                            return res.status(400).json({ error: 'Admin with this email already exists' });
                        }
                        return res.status(500).json({ error: 'Database error' });
                    }
                    if (this.changes === 0) {
                        return res.status(404).json({ error: 'Admin not found' });
                    }
                    res.json({ success: true, message: 'Admin updated successfully' });
                }
            );
        } else {
            // Update only email
            db.run('UPDATE admins SET email = ? WHERE id = ?', [email, id], function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: 'Admin with this email already exists' });
                    }
                    return res.status(500).json({ error: 'Database error' });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Admin not found' });
                }
                res.json({ success: true, message: 'Admin updated successfully' });
            });
        }
    } catch (e) {
        res.status(500).json({ error: 'Server error', details: String(e) });
    }
});

// API: Delete admin
app.post('/api/delete-admin', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID required' });
    
    db.run('DELETE FROM admins WHERE id = ?', [id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Admin not found' });
        }
        res.json({ success: true, message: 'Admin deleted successfully' });
    });
});

// Admin database page placeholder (protect)
app.get('/database', (req, res) => {
    if (!req.session.userId) return res.redirect('/auth/login');
    res.sendFile(path.join(__dirname, 'static', 'database.html'));
});

// Frontoffice page
app.get('/frontoffice', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'frontoffice.html'));
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


