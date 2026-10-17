const { buildContainer, txt, sep, headerSection } = require('./Toolkit');
const config = require('../../config');
const engine = require('./BroadcastEngine');

// Runs fn on every loaded bot and returns one status line per bot.
const forEachBot = async (fn) => {
    const lines = [];
    for (const client of engine.clients) {
        try {
            await fn(client);
            lines.push(`${config.emojis.dot} **${client.user.tag}** — ✅`);
        } catch (e) {
            lines.push(`${config.emojis.dot} **${client.user.tag}** — ❌ ${String(e.message).slice(0, 80)}`);
        }
    }
    if (!lines.length) lines.push('No bots loaded.');
    return lines;
};

const isImage = (attachment) => !!attachment?.contentType?.startsWith('image/');

const card = (guild, color, title, lines) => buildContainer(color,
    headerSection(guild, `**## ${config.emojis.dot} ${title}**`),
    sep(false),
    txt(lines.join('\n')),
    sep()
);

module.exports = { forEachBot, isImage, card };
