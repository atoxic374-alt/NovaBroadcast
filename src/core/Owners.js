const fs = require('fs');
const path = require('path');

// Owners are the ONLY users allowed to use the bot (any server).
// Stored in a JSON file (OWNERS_FILE, default ./data/owners.json).
// On Railway mount a volume at /data and set OWNERS_FILE=/data/owners.json so it survives redeploys.
const FILE = process.env.OWNERS_FILE || path.join(__dirname, '..', '..', 'data', 'owners.json');
const SEED = (process.env.OWNER_IDS || '').split(/[\s,]+/).filter(id => /^\d{17,20}$/.test(id));

const read = () => {
    try {
        const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        return Array.isArray(data.owners) ? data.owners.filter(id => /^\d{17,20}$/.test(id)) : [];
    } catch {
        return [];
    }
};

const write = (owners) => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ owners }, null, 2));
};

// Load file and merge seed owners from env (OWNER_IDS) so they always exist.
let owners = [...new Set([...read(), ...SEED])];
write(owners);

const list = () => [...owners];
const isOwner = (id) => !!id && owners.includes(id);

const add = (id) => {
    if (!/^\d{17,20}$/.test(id)) return { ok: false, reason: 'Invalid user ID.' };
    if (owners.includes(id)) return { ok: false, reason: 'Already an owner.' };
    owners = [...owners, id];
    write(owners);
    return { ok: true };
};

const remove = (id) => {
    if (!owners.includes(id)) return { ok: false, reason: 'Not an owner.' };
    if (owners.length === 1) return { ok: false, reason: 'Cannot remove the last owner.' };
    owners = owners.filter(o => o !== id);
    write(owners);
    return { ok: true };
};

module.exports = { list, isOwner, add, remove, FILE };
