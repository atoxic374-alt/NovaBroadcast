const { buildContainer, txt, sep, headerSection } = require('./Toolkit');
const config = require('../../config');
const engine = require('./BroadcastEngine');

// Runs fn on every loaded bot and returns one status line per bot.
const forEachBot = async (fn) => {
    const lines = [];
    for (const [index, client] of engine.clients.entries()) {
        try {
            await fn(client, index);
            lines.push(`**${client.user.tag}** — `);
        } catch (e) {
            lines.push(`**${client.user.tag}** —  ${String(e.message).slice(0, 80)}`);
        }
    }
    if (!lines.length) lines.push('No bots loaded.');
    return lines;
};

const isImage = (attachment) => !!attachment?.contentType?.startsWith('image/');

const card = (guild, color, title, lines) => buildContainer(color,
    headerSection(guild, `**## ${title}**`),
    sep(false),
    txt(lines.join('\n')),
    sep()
);

module.exports = { forEachBot, isImage, card };
