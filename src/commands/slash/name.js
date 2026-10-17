const { MessageFlags } = require('discord.js');
const config = require('../../../config');
const { canUse } = require('../../core/Access');
const { forEachBot, card } = require('../../core/Branding');
const { setNamePrefix, applyName } = require('../../core/BotState');

module.exports = {
    name: 'name',
    data: {
        name: 'name',
        description: 'Set the names of all bots (owners only)',
        options: [{
            type: 1,
            name: 'all',
            description: 'Set a numbered name for every bot',
            options: [{
                type: 3,
                name: 'name',
                description: 'Base name, for example yuno',
                required: true,
                max_length: 29
            }]
        }]
    },

    async run(interaction) {
        if (!canUse(interaction.member)) return;
        if (interaction.options.getSubcommand() !== 'all') return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const prefix = interaction.options.getString('name', true).trim().slice(0, 29);
        if (!prefix) return interaction.editReply({ content: '**Usage**\nاكتب اسمًا صحيحًا.' });

        setNamePrefix(prefix);
        const lines = await forEachBot(client => applyName(client));
        return interaction.editReply({
            components: [card(interaction.guild, config.colors.success, 'Names Updated', lines)],
            flags: MessageFlags.IsComponentsV2
        });
    }
};
