const { MessageFlags, SectionBuilder, ThumbnailBuilder } = require('discord.js');
const config = require('../../../config');
const { buildContainer, txt, sep } = require('../../core/Toolkit');

module.exports = {
    name: 'help',
    data: { name: 'help', description: 'Show the bot command list' },

    async run(interaction) {
        const guild = interaction.guild;
        const prefix = config.prefix;
        const header = new SectionBuilder()
            .addTextDisplayComponents(txt('**## Help**'));

        if (guild?.iconURL()) {
            header.setThumbnailAccessory(
                new ThumbnailBuilder().setURL(guild.iconURL({ dynamic: true, size: 512 }))
            );
        }

        const container = buildContainer(config.colors.main,
            header,
            txt([
                `**Control Panel**`,
                '',
                `**Bc :** نشر برودكاست ورؤية حالة البوتات`,
                '',
                `**Status :** رؤية حالة البوتات وجاهزيتها`,
                '',
                `**Add :** إنشاء روابط البوتات الفرعية`,
                '',
                `**Left :** إخراج جميع البوتات الفرعية`,
                '',
                `**Avatar all , Banner all , Name all , Status all :** تغيير حالة واسم وأفتار وبنر جميع البوتات`,
                '',
                `Prefix: \`${prefix}\` | Slash: \`/\``
            ].join('\n')),
            sep()
        );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
