const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../../config');
const { canUse } = require('../../core/Access');
const runtime = require('../../core/Runtime');
const { buildContainer, txt, sep, headerSection } = require('../../core/Toolkit');
const { createLogger } = require('../../core/Toolkit');

const logger = createLogger('AddCommand');
const INVITE_PERMISSIONS = '0';

const tokenReply = (message, title, description, color = config.colors.main) => message.reply({
    components: [buildContainer(color, headerSection(message.guild, `**## ${title}**`, `- ${description}`))],
    flags: MessageFlags.IsComponentsV2
});

module.exports = {
    name: 'add',

    async run(message, args = []) {
        if (!canUse(message.member)) return;

        if (args[0]?.toLowerCase() === 'token') {
            const token = args[1];
            await message.delete().catch(() => {});
            if (!token) return tokenReply(message, 'Token Error', 'استخدم الأمر بهذا الشكل: `+add token TOKEN`.', config.colors.error);

            const result = await runtime.addToken(token);
            if (!result.ok) return tokenReply(message, 'Token Error', result.reason, config.colors.error);
            logger.info(`Token added by ${message.author.tag}; total clients: ${result.count}`);
            return tokenReply(message, 'Token Added', `تمت إضافة البوت **${result.tag}** وتشغيله بنجاح. العدد الحالي: **${result.count}**.`);
        }

        const engine = require('../../core/BroadcastEngine');
        const clients = engine.clients;
        if (!clients || clients.length < 2) {
            return tokenReply(message, 'No Secondary Bots', 'لا توجد بوتات إضافية محملة. استخدم `+add token TOKEN` لإضافة توكن جديد.', config.colors.warning);
        }

        const secondaryClients = clients.slice(1);
        const lines = secondaryClients.map((client, i) => {
            const link = `https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot&permissions=${INVITE_PERMISSIONS}`;
            return `**Bot ${i + 2}:** [${client.user.tag}](${link})`;
        });
        const buttons = secondaryClients.map((client, i) => {
            const link = `https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot&permissions=${INVITE_PERMISSIONS}`;
            return new ButtonBuilder().setLabel(`Add Bot ${i + 2}`).setURL(link).setStyle(ButtonStyle.Link);
        });
        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));

        const container = buildContainer(config.colors.main,
            headerSection(message.guild, '**## Bot Invite Links**', '- اضغط على الأزرار أدناه لإضافة البوتات الإضافية إلى خادمك.'),
            sep(false),
            txt(`**البوتات الإضافية (${secondaryClients.length}):**\n${lines.join('\n')}`),
            sep(), ...rows
        );
        logger.info(`+add used by ${message.author.tag} — ${secondaryClients.length} bot(s) listed`);
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
