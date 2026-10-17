const fs = require('fs');
const path = require('path');

const TOKEN_FILE = process.env.RUNTIME_TOKENS_FILE || path.join(__dirname, '..', '..', 'data', 'tokens.json');
let addTokenHandler = null;

const readTokens = () => {
    try {
        const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        return Array.isArray(data.tokens) ? data.tokens.filter(Boolean) : [];
    } catch {
        return [];
    }
};

const writeTokens = (tokens) => {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ tokens }, null, 2), { mode: 0o600 });
};

const savedTokens = () => readTokens();
const rememberToken = (token) => {
    const tokens = [...new Set([...readTokens(), token])];
    writeTokens(tokens);
};

const setAddTokenHandler = (handler) => {
    addTokenHandler = handler;
};

const addToken = async (token) => {
    if (!addTokenHandler) return { ok: false, reason: 'Token service is not ready.' };
    const result = await addTokenHandler(token);
    if (result.ok) rememberToken(token);
    return result;
};

module.exports = { TOKEN_FILE, savedTokens, setAddTokenHandler, addToken };
