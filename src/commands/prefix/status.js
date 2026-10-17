const { MessageFlags } = require('discord.js');
const config = require('../../../config');
const { canUse } = require('../../core/Access');
const { forEachBot, card, botStatusContainer } = require('../../core/Branding');
const { setActivity, applyTo, ACTIVITY_TYPES } = require('../../core/BotState');

const reply = (message, container) => message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

module.exports = {
    name: 'status',

    // usage: +status all [type] <text>   type: custom|playing|streaming|listening|watching|competing
    async run(message, args) {
        if (!canUse(message.member)) return;

        const usage = `- \`${config.prefix}status all [type] <text>\`\n- Types: ${ACTIVITY_TYPES.join(', ')}`;
        if (args[0] !== 'all') {
            return message.reply({ components: [await botStatusContainer(message.guild)], flags: MessageFlags.IsComponentsV2 });
        }

        const rest = args.slice(1);
        let type = 'custom';
        if (ACTIVITY_TYPES.includes(rest[0]?.toLowerCase())) type = rest.shift().toLowerCase();
        const text = rest.join(' ').slice(0, 128);
        if (!text) return reply(message, card(message.guild, config.colors.warning, 'Usage', [usage]));

        setActivity(text, type);
        const lines = await forEachBot(client => applyTo(client));
        return reply(message, card(message.guild, config.colors.success, 'Status Updated', lines));
    }
};
