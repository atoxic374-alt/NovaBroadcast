const { MessageFlags } = require('discord.js');
const config = require('../../../config');
const { canUse } = require('../../core/Access');
const { forEachBot, isImage, card } = require('../../core/Branding');

const ok = (interaction, container) => interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });

module.exports = {
    name: 'avatar',
    data: {
        name: 'avatar',
        description: 'Change the avatar of all bots (owners only)',
        options: [{
            type: 1,
            name: 'all',
            description: 'Set the avatar of every bot',
            options: [{ type: 11, name: 'image', description: 'New avatar image (PNG, JPG, GIF)', required: true }]
        }]
    },

    async run(interaction) {
        if (!canUse(interaction.member)) return;
        if (interaction.options.getSubcommand() !== 'all') return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const image = interaction.options.getAttachment('image');
        if (!isImage(image)) {
            return ok(interaction, card(interaction.guild, config.colors.error, 'Invalid Image', ['- Attach an image file.']));
        }

        const lines = await forEachBot(client => client.user.setAvatar(image.url));
        return ok(interaction, card(interaction.guild, config.colors.success, 'Avatar Updated', lines));
    }
};
