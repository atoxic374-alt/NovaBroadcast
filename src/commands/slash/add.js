const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../../config');
const { canUse } = require('../../core/Access');
const { isEnvironmentOwner } = require('../../core/Owners');
const runtime = require('../../core/Runtime');
const { buildContainer, txt, sep, headerSection } = require('../../core/Toolkit');
const { createLogger } = require('../../core/Toolkit');
const { addTokenBatch, formatTokenBatchReport } = require('../../core/TokenBatch');

const logger = createLogger('AddCommand');
const inviteLink = client => `https://discord.com/oauth2/authorize?client_id=${client.user.id}&integration_type=0&scope=applications.commands+bot`;

module.exports = {
    name: 'add',
    data: new SlashCommandBuilder()
        .setName('add')
        .setDescription('Show bot invite links or add bot tokens')
        .addSubcommand(sub => sub
            .setName('links')
            .setDescription('Show invite links for the main and secondary bots'))
        .addSubcommand(sub => sub
            .setName('token')
            .setDescription('Add and start a bot token')
            .addStringOption(option => option
                .setName('token')
                .setDescription('Paste one or more tokens separated by spaces, commas, |, or new lines')
                .setRequired(true))),

    async run(interaction) {
        if (!canUse(interaction.member)) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (interaction.options.getSubcommand() === 'token') {
            if (!isEnvironmentOwner(interaction.user.id)) {
                return interaction.editReply({ content: '**Permission Denied**\nهذا الأمر متاح فقط للمالكين الموجودين في متغير `OWNER_IDS`.' });
            }
            const input = interaction.options.getString('token', true);
            const result = await addTokenBatch(input, runtime);
            if (!result.total) {
                return interaction.editReply({ content: 'لم أجد أي توكن. افصل التوكنات بمسافة أو فاصلة أو `|` أو سطر جديد.' });
            }
            const color = result.added.length
                ? (result.failed.length ? config.colors.warning : config.colors.success)
                : (result.failed.length ? config.colors.error : config.colors.warning);
            logger.info(`Token batch by ${interaction.user.tag}: ${result.added.length} added, ${result.duplicates.length} duplicate, ${result.failed.length} failed`);
            return interaction.editReply({
                components: [buildContainer(color,
                    headerSection(interaction.guild, '**## Token Batch Results**', formatTokenBatchReport(result))
                )],
                flags: MessageFlags.IsComponentsV2
            });
        }

        const engine = require('../../core/BroadcastEngine');
        const clients = engine.clients;
        const inviteBots = (clients || []).filter(client => client?.user?.id);
        if (!inviteBots.length) {
            return interaction.editReply({
                components: [buildContainer(config.colors.warning,
                    headerSection(interaction.guild, '**## No Bots Available**', '- لا توجد بوتات متصلة لإظهار روابطها. استخدم `/add token` لإضافة توكن جديد.')
                )],
                flags: MessageFlags.IsComponentsV2
            });
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
        logger.info(`/add used by ${interaction.user.tag} — ${inviteBots.length} bot(s) listed`);
        return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
