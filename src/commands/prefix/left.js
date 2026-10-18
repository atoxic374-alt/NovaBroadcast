const { MessageFlags } = require('discord.js');
const { canUse } = require('../../core/Access');
const { createLeftPanel, startLeftCollector } = require('../../core/LeftPanel');

module.exports = {
    name: 'left',
    async run(message) {
        const engine = require('../../core/BroadcastEngine');
        if (!canUse(message.member)) return;

        const guildId = message.guild.id;
        const panel = await createLeftPanel(engine.clients, guildId);
        const sentMessage = await message.reply({
            components: [panel.container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
        });
        startLeftCollector(sentMessage, panel.entries, guildId, panel.sessionId);
        return sentMessage;
    }
};
