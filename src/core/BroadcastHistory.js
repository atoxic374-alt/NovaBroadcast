const fs = require('fs');
const path = require('path');

const FILE = process.env.BROADCAST_HISTORY_FILE
    || path.join(__dirname, '..', '..', 'data', 'broadcast-history.json');
const MAX_ENTRIES = 50;

const read = () => {
    try {
        const value = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
};

const write = entries => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(entries.slice(-MAX_ENTRIES), null, 2));
};

const add = entry => {
    const entries = read();
    entries.push({ ...entry, savedAt: new Date().toISOString() });
    write(entries);
    return entries.at(-1);
};

const list = () => read().reverse();
const latest = () => list()[0] || null;

module.exports = { add, list, latest };
