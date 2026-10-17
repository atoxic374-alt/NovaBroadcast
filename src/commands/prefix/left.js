const { MessageFlags } = require('discord.js');
const config = require('../../../config');
const { canUse } = require('../../core/Access');
const { buildContainer, txt, sep, headerSection, createLogger } = require('../../core/Toolkit');

const logger = createLogger('LeftCommand');

module.exports = {
    name: 'left',

    async run(message) {
        const engine = require('../../core/BroadcastEngine');

        if (!canUse(message.member)) return;

        const clients = engine.clients;
        const guildId = message.guild.id;

        const results = [];

        // Skip the main bot (clients[0]) so the control panel keeps working.
        for (const client of clients.slice(1)) {
            try {
                const guild = client.guilds.cache.get(guildId)
                    ?? await client.guilds.fetch(guildId).catch(() => null);

                if (!guild) {
                    results.push({ tag: client.user.tag, status: 'ليس في الخادم' });
                    continue;
                }

                await guild.leave();
                results.push({ tag: client.user.tag, status: 'غادر بنجاح' });
                logger.info(`${client.user.tag} left guild ${guildId}`);
            } catch (e) {
                results.push({ tag: client.user.tag, status: `فشل: ${e.message.slice(0, 50)}` });
                logger.error(`${client.user.tag} failed to leave: ${e.message}`);
            }
        }

        const lines = results.map(r => `**${r.tag}** — ${r.status}`).join('\n');

        return message.reply({
            components: [buildContainer(config.colors.error,
                headerSection(message.guild,
                    `**## Bots Left Server**`,
                    `- All secondary bots have been instructed to leave the server. The main bot stays.`
                ),
                sep(false),
                txt(`**النتائج:**\n${lines}`),
                sep()
            )],
            flags: MessageFlags.IsComponentsV2
        });
    }
};
