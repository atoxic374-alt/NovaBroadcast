const { MessageFlags } = require('discord.js');
const config = require('../../../config');
const { canUse } = require('../../core/Access');
const { forEachBot, card, botStatusContainer } = require('../../core/Branding');
const { setActivity, applyTo } = require('../../core/BotState');

const TYPE_CHOICES = ['custom', 'playing', 'streaming', 'listening', 'watching', 'competing']
    .map(t => ({ name: t[0].toUpperCase() + t.slice(1), value: t }));

module.exports = {
    name: 'status',
    data: {
        name: 'status',
        description: 'Show bot status or change activity (owners only)',
        options: [{
            type: 1,
            name: 'bots',
            description: 'Show connection and server status for every bot'
        }, {
            type: 1,
            name: 'all',
            description: 'Set the status of every bot',
            options: [
                { type: 3, name: 'text', description: 'Status text (max 128 chars)', required: true, max_length: 128 },
                { type: 3, name: 'type', description: 'Activity type (default: Custom)', required: false, choices: TYPE_CHOICES }
            ]
        }]
    },

    async run(interaction) {
        if (!canUse(interaction.member)) return;
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'bots') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return interaction.editReply({
                components: [await botStatusContainer(interaction.guild)],
                flags: MessageFlags.IsComponentsV2
            });
        }
        if (subcommand !== 'all') return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const text = interaction.options.getString('text');
        const type = interaction.options.getString('type') || 'custom';

        setActivity(text, type);
        const lines = await forEachBot(client => applyTo(client));

        return interaction.editReply({
            components: [card(interaction.guild, config.colors.success, 'Status Updated', lines)],
            flags: MessageFlags.IsComponentsV2
        });
    }
};
