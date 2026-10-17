const { MessageFlags, SectionBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ThumbnailBuilder } = require('discord.js');
const config = require('../../../config');
const { buildContainer, txt, sep } = require('../../core/Toolkit');

module.exports = {
    name: 'cp',
    data: { name: 'cp', description: 'Broadcast hub — all commands in one panel' },
    async run(interaction) {
        const guild = interaction.guild;
        const e = config.emojis;
        const header = new SectionBuilder()
            .addTextDisplayComponents(
                txt('**## Control Panel**'),
                txt('**التحكم الكامل في بوتات البرودكاست**')
        )
            ;
        if (guild?.iconURL()) {
            header.setThumbnailAccessory(
                new ThumbnailBuilder().setURL(guild.iconURL({ dynamic: true, size: 512 }))
            );
        }

        const container = buildContainer(config.colors.main,
            header,
            txt('**Broadcast**\n\n** ارسال برودكاست باكثر من طريقه وبسرعه عالية **'),
            sep(false),
            txt('**Status**\n\n**رؤية تفاصيل بوتات البرود**'),
            sep(),

            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('cp_bc')
                    .setEmoji(e.broadcast)
                    .setLabel('Broadcast')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('cp_Nova_Realm')
                    .setEmoji(e.search)
                    .setLabel('Status')
                    .setStyle(ButtonStyle.Secondary)
            )
        );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
