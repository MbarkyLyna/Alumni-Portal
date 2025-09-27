import express from 'express';
import bcrypt from 'bcrypt';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../../src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const authRouter = express.Router();

// Serve static admin pages
authRouter.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'static', 'admin', 'login.html'));
});

// Signup disabled per requirements

authRouter.post('/login', express.json(), (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    db.get('SELECT * FROM admins WHERE email = ?', [email.toLowerCase()], async (err, row) => {
        if (err || !row) return res.status(401).json({ error: 'Invalid credentials' });
        const ok = await bcrypt.compare(password, row.password_hash);
        if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
        req.session.userId = row.id;
        res.json({ ok: true });
    });
});

authRouter.post('/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

authRouter.get('/me', (req, res) => {
    if (!req.session.userId) return res.json({ loggedIn: false });
    db.get('SELECT email FROM admins WHERE id = ?', [req.session.userId], (err, row) => {
        if (err || !row) return res.json({ loggedIn: false });
        res.json({ loggedIn: true, email: row.email });
    });
});


