const { MessageFlags } = require('discord.js');
const config = require('../../../config');
const { canUse } = require('../../core/Access');
const { forEachBot, isImage, card } = require('../../core/Branding');

const reply = (message, container) => message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

module.exports = {
    name: 'banner',

    // usage: +banner all  (with an image attached)
    async run(message, args) {
        if (!canUse(message.member)) return;

        if (args[0] !== 'all') {
            return reply(message, card(message.guild, config.colors.warning, 'Usage', [`- \`${config.prefix}banner all\` with an image attached`]));
        }

        const image = message.attachments.first();
        if (!isImage(image)) {
            return reply(message, card(message.guild, config.colors.error, 'Invalid Image', ['- Attach an image file.']));
        }

        const lines = await forEachBot(client => client.user.setBanner(image.url));
        return reply(message, card(message.guild, config.colors.success, 'Banner Updated', lines));
    }
};
