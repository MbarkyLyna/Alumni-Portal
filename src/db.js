import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', 'data.sqlite');
export const db = new sqlite3.Database(dbPath);

export function initDb(callback) {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS alumni (
            email TEXT PRIMARY KEY,
            name TEXT,
            family_name TEXT,
            linkedin TEXT,
            facebook TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS recent_searches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            time TEXT NOT NULL
        )`);

        if (callback) callback();
    });
}


