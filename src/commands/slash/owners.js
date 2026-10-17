const { MessageFlags } = require('discord.js');
const config = require('../../../config');
const { buildContainer, txt, sep, headerSection } = require('../../core/Toolkit');
const { canUse } = require('../../core/Access');
const owners = require('../../core/Owners');

const reply = (interaction, color, title, body) => ({
    components: [buildContainer(color, headerSection(interaction.guild, `**## ${config.emojis.dot} ${title}**`, body), sep())],
    flags: MessageFlags.IsComponentsV2
});

module.exports = {
    name: 'owners',
    data: {
        name: 'owners',
        description: 'Manage bot owners (owners only)',
        options: [
            { type: 1, name: 'add', description: 'Add an owner', options: [{ type: 6, name: 'user', description: 'User to add', required: true }] },
            { type: 1, name: 'remove', description: 'Remove an owner', options: [{ type: 6, name: 'user', description: 'User to remove', required: true }] },
            { type: 1, name: 'list', description: 'Show all owners' }
        ]
    },

    async run(interaction) {
        if (!canUse(interaction.member)) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const sub = interaction.options.getSubcommand();
        if (sub === 'list') {
            const lines = owners.list().map(id => `${config.emojis.dot} <@${id}> (\`${id}\`)`).join('\n') || 'None';
            return interaction.editReply(reply(interaction, config.colors.main, 'Owners', lines));
        }

        const user = interaction.options.getUser('user');
        const result = sub === 'add' ? owners.add(user.id) : owners.remove(user.id);
        if (!result.ok) return interaction.editReply(reply(interaction, config.colors.error, 'Failed', `- ${result.reason}`));
        return interaction.editReply(reply(interaction, config.colors.success, sub === 'add' ? 'Owner Added' : 'Owner Removed', `- <@${user.id}> (\`${user.id}\`)`));
    }
};
