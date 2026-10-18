const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../../config');
const { canUse } = require('../../core/Access');
const { isEnvironmentOwner } = require('../../core/Owners');
const runtime = require('../../core/Runtime');
const { buildContainer, txt, sep, headerSection } = require('../../core/Toolkit');
const { createLogger } = require('../../core/Toolkit');
const { addTokenBatch, formatTokenBatchReport } = require('../../core/TokenBatch');

const logger = createLogger('AddCommand');
const inviteLink = client => `https://discord.com/oauth2/authorize?client_id=${client.user.id}&integration_type=0&scope=applications.commands+bot`;

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
        const inviteBots = (clients || []).filter(client => client?.user?.id);
        if (!inviteBots.length) {
            return tokenReply(message, 'No Bots Available', `لا توجد بوتات متصلة لإظهار روابطها. استخدم \`${config.prefix}add token TOKEN\` لإضافة توكن جديد.`, config.colors.warning);
        }

        const lines = inviteBots.map((client, i) => {
            const mainLabel = i === 0 ? ' (البوت الرئيسي)' : '';
            return `**Bot ${i + 1}${mainLabel}:** [${client.user.tag}](${inviteLink(client)})`;
        });
        const buttons = inviteBots.map((client, i) => {
            const label = i === 0 ? 'البوت الرئيسي' : `Add Bot ${i + 1}`;
            return new ButtonBuilder().setLabel(label).setURL(inviteLink(client)).setStyle(ButtonStyle.Link);
        });
        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));

        const container = buildContainer(config.colors.main,
            txt('**## Bot Invite Links**\n- روابط جميع البوتات. البوت الرئيسي موضح بعبارة (البوت الرئيسي).'),
            sep(false),
            txt(`**كل البوتات (${inviteBots.length}):**\n${lines.join('\n')}`),
            sep(), ...rows
        );
        logger.info(`+add used by ${message.author.tag} — ${inviteBots.length} bot(s) listed`);
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
