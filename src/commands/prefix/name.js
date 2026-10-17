const { MessageFlags } = require('discord.js');
const config = require('../../../config');
const { canUse } = require('../../core/Access');
const { forEachBot, card } = require('../../core/Branding');
const { setNamePrefix, applyName } = require('../../core/BotState');

const reply = (message, container) => message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

module.exports = {
    name: 'name',

    async run(message, args = []) {
        if (!canUse(message.member)) return;
        if (args[0]?.toLowerCase() !== 'all') {
            return reply(message, card(message.guild, config.colors.warning, 'Usage', [`استخدم: \`${config.prefix}name all <name>\``]));
        }

        const prefix = args.slice(1).join(' ').trim().slice(0, 29);
        if (!prefix) {
            return reply(message, card(message.guild, config.colors.warning, 'Usage', ['اكتب الاسم الأساسي بعد الأمر. مثال: `+name all yuno`']));
        }

        setNamePrefix(prefix);
        const lines = await forEachBot(client => applyName(client));
        return reply(message, card(message.guild, config.colors.success, 'Names Updated', lines));
    }
};
