const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

const botStatusContainer = async (guild) => {
    const lines = [];
    const inviteRows = [];

    for (const [index, client] of engine.clients.entries()) {
        const user = client?.user;
        if (!user) {
            lines.push(`**Bot ${index + 1}** — 🔴 **Offline** — **Outside server**`);
            continue;
        }

        let member = guild?.members?.cache.get(user.id);
        if (!member && guild?.members) member = await guild.members.fetch(user.id).catch(() => null);
        const connected = typeof client.isReady === 'function'
            ? client.isReady()
            : client.ws?.status === 0;
        const ready = connected && !!member;
        lines.push(`**Bot ${index + 1} — ${user.tag}** — ${ready ? '🟢 **Ready**' : '🔴 **Offline / Problem**'} — ${member ? '**Member**' : '**Outside server**'}`);

        if (!member) {
            const invite = `https://discord.com/oauth2/authorize?client_id=${user.id}&scope=bot%20applications.commands&permissions=0`;
            inviteRows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel(`Add Bot ${index + 1}`)
                    .setURL(invite)
                    .setStyle(ButtonStyle.Link)
            ));
        }
    }

    if (!lines.length) lines.push('No bots loaded.');
    return buildContainer(config.colors.main,
        headerSection(guild, '**## Bot Status**', '**Bot connection and server membership**'),
        sep(false),
        txt(lines.join('\n')),
        ...inviteRows,
        sep()
    );
};

module.exports = { forEachBot, isImage, card, botStatusContainer };
