const splitTokenInput = (value) => String(value || '')
    .replace(/```(?:[A-Za-z0-9_-]+)?/g, '')
    .trim()
    .split(/[\s,;|،؛]+/u)
    .map(token => token.trim().replace(/^["'`<]+|["'`>]+$/g, ''))
    .filter(Boolean);

const addTokenBatch = async (value, runtime) => {
    const tokens = splitTokenInput(value);
    const result = { total: tokens.length, added: [], duplicates: [], failed: [] };
    const seen = new Set();

    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        const number = index + 1;
        if (seen.has(token)) {
            result.duplicates.push({ number, reason: 'مكرر ضمن القائمة' });
            continue;
        }
        seen.add(token);

        try {
            const outcome = await runtime.addToken(token);
            if (outcome?.ok) {
                result.added.push({ number, tag: outcome.tag || 'تم تشغيل البوت', persisted: outcome.persisted !== false });
            } else if (outcome?.code === 'duplicate' || /already added|مضاف مسبقًا|مكرر/i.test(outcome?.reason || '')) {
                result.duplicates.push({ number, reason: 'مضاف مسبقًا' });
            } else {
                result.failed.push({ number, reason: outcome?.reason || 'تعذر تسجيل الدخول بهذا التوكن.' });
            }
        } catch (error) {
            result.failed.push({ number, reason: 'حدث خطأ أثناء التحقق أو الحفظ.' });
        }
    }
    return result;
};

const formatTokenBatchReport = (result) => {
    const lines = [
        `**النتائج:** ${result.total} توكن`,
        `✅ **نجح (${result.added.length}):** ${result.added.length ? result.added.slice(0, 15).map(item => `#${item.number} ${item.tag}`).join('، ') : 'لا يوجد'}`,
        `⏭ **تخطي مكرر (${result.duplicates.length}):** ${result.duplicates.length ? result.duplicates.slice(0, 15).map(item => `#${item.number}`).join('، ') : 'لا يوجد'}`,
        `❌ **خطأ (${result.failed.length}):** ${result.failed.length ? result.failed.slice(0, 10).map(item => `#${item.number}: ${item.reason}`).join('\n') : 'لا يوجد'}`
    ];
    const notPersisted = result.added.filter(item => !item.persisted).length;
    if (notPersisted) lines.push(`⚠️ تعذر حفظ ${notPersisted} من التوكنات في ملف التخزين؛ البوتات قد تعمل حتى إعادة التشغيل.`);
    if (result.added.length > 15 || result.duplicates.length > 15 || result.failed.length > 10) {
        lines.push('*تم اختصار بعض التفاصيل لتناسب الرسالة؛ الترقيم يشير إلى ترتيب التوكنات المُدخلة.*');
    }
    return lines.join('\n');
};

module.exports = { splitTokenInput, addTokenBatch, formatTokenBatchReport };
