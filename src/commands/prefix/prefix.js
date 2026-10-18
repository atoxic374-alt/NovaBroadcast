const config = require('../../../config');
const { canUse } = require('../../core/Access');
const { setPrefix } = require('../../core/BotState');

module.exports = {
    name: 'prefix',
    async run(message, args) {
        if (!canUse(message.member)) return;
        const nextPrefix = args.join(' ').trim();
        if (!nextPrefix) {
            return message.reply(`البادئة الحالية: \`${config.prefix}\`\nالاستخدام: \`${config.prefix}prefix <بادئة جديدة>\``);
        }
        if (/\s|<|>|@/u.test(nextPrefix) || nextPrefix.length > 8) {
            return message.reply('البادئة يجب أن تكون من 1 إلى 8 أحرف، دون مسافات أو منشنات.');
        }

        const previousPrefix = config.prefix;
        setPrefix(nextPrefix);
        return message.reply(`تم تغيير البادئة من \`${previousPrefix}\` إلى \`${nextPrefix}\`. استخدم \`${nextPrefix}help\` لعرض المساعدة.`);
    }
};
