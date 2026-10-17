const { isOwner } = require('./Owners');

// Only bot owners (src/core/Owners.js) can use the bot, in any server.
const canUse = (member) => {
    if (!member) return false;
    return isOwner(member.id ?? member.user?.id);
};

module.exports = { canUse };
