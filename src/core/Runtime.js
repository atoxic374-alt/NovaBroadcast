const fs = require('fs');
const path = require('path');

const TOKEN_FILE = process.env.RUNTIME_TOKENS_FILE || path.join(__dirname, '..', '..', 'data', 'tokens.json');
let addTokenHandler = null;
let tokenWriteQueue = Promise.resolve();

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
    const temporaryFile = `${TOKEN_FILE}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporaryFile, `${JSON.stringify({ tokens }, null, 2)}\n`, { mode: 0o600 });
        fs.renameSync(temporaryFile, TOKEN_FILE);
    } catch (error) {
        try { fs.unlinkSync(temporaryFile); } catch {}
        throw error;
    }
};

const savedTokens = () => readTokens();
const rememberToken = (token) => {
    tokenWriteQueue = tokenWriteQueue.catch(() => null).then(() => {
        const tokens = [...new Set([...readTokens(), token])];
        writeTokens(tokens);
    });
    return tokenWriteQueue;
};

const setAddTokenHandler = (handler) => {
    addTokenHandler = handler;
};

const addToken = async (token) => {
    const normalized = String(token || '').trim();
    if (!normalized) return { ok: false, code: 'invalid', reason: 'التوكن فارغ أو غير صالح.' };
    if (!addTokenHandler) return { ok: false, code: 'unavailable', reason: 'خدمة إضافة التوكنات غير جاهزة.' };

    const result = await addTokenHandler(normalized);
    if (!result?.ok) return result || { ok: false, code: 'failed', reason: 'تعذرت إضافة التوكن.' };
    try {
        await rememberToken(normalized);
        return { ...result, persisted: true };
    } catch (error) {
        console.error(`[Runtime] Could not save a newly added token to ${TOKEN_FILE}: ${error.message}`);
        return { ...result, persisted: false, persistError: 'تعذر الحفظ إلى ملف التوكنات.' };
    }
};

module.exports = { TOKEN_FILE, savedTokens, setAddTokenHandler, addToken };
