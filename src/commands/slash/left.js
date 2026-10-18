const { MessageFlags } = require('discord.js');
const { canUse } = require('../../core/Access');
const { createLeftPanel, startLeftCollector } = require('../../core/LeftPanel');

module.exports = {
    name: 'left',
    data: { name: 'left', description: 'Choose a secondary bot to leave or remove all secondary bots' },
    async run(interaction) {
        const engine = require('../../core/BroadcastEngine');
        if (!canUse(interaction.member)) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const guildId = interaction.guild.id;
        const panel = await createLeftPanel(engine.clients, guildId);
        const sentMessage = await interaction.editReply({
            components: [panel.container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
        });
        startLeftCollector(sentMessage, panel.entries, guildId, panel.sessionId);
        return sentMessage;
    }
};
