const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../../config');
const { canUse } = require('../../core/Access');
const { isEnvironmentOwner } = require('../../core/Owners');
const runtime = require('../../core/Runtime');
const { buildContainer, txt, sep, headerSection } = require('../../core/Toolkit');
const { createLogger } = require('../../core/Toolkit');
const { addTokenBatch, formatTokenBatchReport } = require('../../core/TokenBatch');

const logger = createLogger('AddCommand');
const INVITE_PERMISSIONS = '0';

module.exports = {
    name: 'add',
    data: new SlashCommandBuilder()
        .setName('add')
        .setDescription('Manage bots and tokens')
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
        if (!clients || clients.length < 2) {
            return interaction.editReply({
                components: [buildContainer(config.colors.warning,
                    headerSection(interaction.guild, '**## No Secondary Bots**', '- لا توجد بوتات إضافية محملة. استخدم `/add token` لإضافة توكن جديد.')
                )],
                flags: MessageFlags.IsComponentsV2
            });
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
            headerSection(interaction.guild, '**## Bot Invite Links**', '- اضغط على الأزرار أدناه لإضافة البوتات الإضافية إلى خادمك.'),
            sep(false),
            txt(`**البوتات الإضافية (${secondaryClients.length}):**\n${lines.join('\n')}`),
            sep(), ...rows
        );
        logger.info(`/add used by ${interaction.user.tag} — ${secondaryClients.length} bot(s) listed`);
        return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
