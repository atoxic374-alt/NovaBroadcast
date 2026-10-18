const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../../config');
const { canUse } = require('../../core/Access');
const { isEnvironmentOwner } = require('../../core/Owners');
const runtime = require('../../core/Runtime');
const { buildContainer, txt, sep, headerSection } = require('../../core/Toolkit');
const { createLogger } = require('../../core/Toolkit');
const { addTokenBatch, formatTokenBatchReport } = require('../../core/TokenBatch');

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
            if (!isEnvironmentOwner(message.author.id)) {
                return tokenReply(message, 'Permission Denied', 'هذا الأمر متاح فقط للمالكين الموجودين في متغير `OWNER_IDS`.', config.colors.error);
            }
            const input = args.slice(1).join(' ');
            if (!input.trim()) return tokenReply(message, 'Token Error', 'استخدم `+add token TOKEN1 TOKEN2` أو افصل التوكنات بفاصلة أو `|` أو سطر جديد.', config.colors.error);

            const deleted = await message.delete().then(() => true).catch(() => false);
            if (!deleted) {
                return tokenReply(message, 'Token Input Not Removed', 'لم أتمكن من حذف رسالة التوكنات؛ لم أبدأ المعالجة لحماية أسرارك. احذف الرسالة يدويًا، ثم استخدم الأمر slash الخاص بـ `/add token` أو امنح البوت صلاحية Manage Messages.', config.colors.error);
            }
            const result = await addTokenBatch(input, runtime);
            if (!result.total) return tokenReply(message, 'Token Error', 'لم أجد أي توكن في الرسالة. افصل التوكنات بمسافة أو فاصلة أو `|` أو سطر جديد.', config.colors.error);
            const color = result.added.length
                ? (result.failed.length ? config.colors.warning : config.colors.success)
                : (result.failed.length ? config.colors.error : config.colors.warning);
            logger.info(`Token batch by ${message.author.tag}: ${result.added.length} added, ${result.duplicates.length} duplicate, ${result.failed.length} failed`);
            return tokenReply(message, 'Token Batch Results', formatTokenBatchReport(result), color);
        }

        const engine = require('../../core/BroadcastEngine');
        const clients = engine.clients;
        if (!clients || clients.length < 2) {
            return tokenReply(message, 'No Secondary Bots', `لا توجد بوتات إضافية محملة. استخدم \`${config.prefix}add token TOKEN\` لإضافة توكن جديد.`, config.colors.warning);
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
