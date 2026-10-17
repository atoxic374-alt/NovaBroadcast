const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../../config');
const { canUse } = require('../../core/Access');
const { buildContainer, txt, sep, headerSection } = require('../../core/Toolkit');
const { createLogger } = require('../../core/Toolkit');

const logger = createLogger('AddCommand');

// Secondary bots only send DMs, so they need no server permissions.
const INVITE_PERMISSIONS = '0';

module.exports = {
    name: 'add',
    data: { name: 'add', description: 'Generate invite links for all secondary bots' },

    async run(interaction) {
        const engine = require('../../core/BroadcastEngine');

        if (!canUse(interaction.member)) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const clients = engine.clients;

        if (!clients || clients.length < 2) {
            return interaction.editReply({
                components: [buildContainer(config.colors.warning,
                    headerSection(interaction.guild, `**## No Secondary Bots**`,
                        '- لا توجد بوتات إضافية محملة. تأكد من إضافة التوكنات في `config.json` أو متغيرات البيئة.')
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
            return new ButtonBuilder()
                .setLabel(`Add Bot ${i + 2}`)
                .setURL(link)
                .setStyle(ButtonStyle.Link);
        });

        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
        }

        const container = buildContainer(config.colors.main,
            headerSection(interaction.guild,
                `**## Bot Invite Links**`,
                `- اضغط على الأزرار أدناه لإضافة البوتات الإضافية إلى خادمك. لا توجد صلاحيات خاصة مطلوبة؛ تأكد من اختيار الخادم الصحيح.`
            ),
            sep(false),
            txt(`**البوتات الإضافية (${secondaryClients.length}):**\n${lines.join('\n')}`),
            sep(),
            ...rows
        );

        logger.info(`/add used by ${interaction.user.tag} — ${secondaryClients.length} bot(s) listed`);

        return interaction.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    }
};
