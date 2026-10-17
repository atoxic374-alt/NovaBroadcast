const fs = require('fs');
const path = require('path');

const FILE = process.env.BROADCAST_CHECKPOINT_FILE
    || path.join(__dirname, '..', '..', 'data', 'broadcast-checkpoint.json');

const load = () => {
    try {
        const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        if (!data?.guildId || !Array.isArray(data.memberIds)) return null;
        return data;
    } catch {
        return null;
    }
};

const save = (data) => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const temporary = `${FILE}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, FILE);
};

const clear = () => {
    try { fs.unlinkSync(FILE); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
};

module.exports = { FILE, load, save, clear };
