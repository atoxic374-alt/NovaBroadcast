const fs = require('fs');
const path = require('path');

const COOLDOWN_MS = 90 * 60 * 1000;
const FILE = process.env.BROADCAST_COOLDOWN_FILE
    || path.join(__dirname, '..', '..', 'data', 'broadcast-cooldown.json');

const read = () => {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; }
    catch { return {}; }
};

const write = (data) => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const temporary = `${FILE}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, FILE);
};

const remaining = (guildId) => {
    if (!guildId) return 0;
    const until = Number(read()[guildId] || 0);
    return Math.max(0, until - Date.now());
};

const claim = (guildId) => {
    if (!guildId) return { claimed: true, remaining: 0 };
    const data = read();
    const now = Date.now();
    const current = Number(data[guildId] || 0);
    if (current > now) return { claimed: false, remaining: current - now };
    data[guildId] = now + COOLDOWN_MS;
    write(data);
    return { claimed: true, remaining: COOLDOWN_MS };
};

module.exports = { COOLDOWN_MS, FILE, remaining, claim };
