const { MessageFlags, SectionBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ThumbnailBuilder } = require('discord.js');
const config = require('../../../config');
const engine = require('../../core/BroadcastEngine');
const { buildContainer, txt, sep, headerSection } = require('../../core/Toolkit');

module.exports = {
    name: 'help',
    data: { name: 'help', description: 'Show all available commands' },
    async run(interaction) {
        const bots = engine.clients.length;
        const speed = engine.requestsPerSecond * bots;
        const guild = interaction.guild;
        const p = config.prefix;

        const header = new SectionBuilder()
            .addTextDisplayComponents(
                txt('**## Help**'),
                txt('- مرحبًا بك في لوحة المساعدة. ستجد هنا الأوامر المتاحة وإمكانات النظام وطريقة بدء أول حملة إرسال.')
            );
        if (guild?.iconURL()) {
            header.setThumbnailAccessory(
                new ThumbnailBuilder().setURL(guild.iconURL({ dynamic: true, size: 512 }))
            );
        }

        const container = buildContainer(config.colors.main,
            header,
            txt(
                `**Control Panel**\n- Use \`${p}cp\` or \`/cp\` لفتح لوحة التحكم الرئيسية، ومن خلالها يمكنك بدء الإرسال ومراجعة حالة النظام بضغطة واحدة.\n` +
                `**Broadcast**\n- أرسل رسائل مباشرة إلى جميع أعضاء الخادم أو صفِّهم حسب الحالة. يمكنك الاختيار بين رسالة عادية أو Embed.\n` +
                `**Status**\n- اعرض الإحصائيات الفورية، مثل عدد الأعضاء والبوتات النشطة والوقت المتوقع وسرعة الإرسال.\n` +
                `**Bot Management**\n` +
                `**Add Bots** — \`${p}add\` or \`/add\`\n- أنشئ روابط دعوة لجميع البوتات الإضافية لإضافتها بسرعة إلى خادم جديد.\n` +
                `**Remove Bots** — \`${p}left\` or \`/left\`\n- اجعل البوتات الإضافية تغادر الخادم الحالي، بينما يبقى البوت الرئيسي.\n` +
                `**System Info**\n- ${bots} active bots | ~${speed} أعضاء/sec | Engine: discord.js v14.`
            ),
            sep()
        );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
