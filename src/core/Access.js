const { PermissionsBitField } = require('discord.js');

// Who can use the bot in ANY server:
//  - members with Administrator or Manage Server permission (dynamic, no role IDs needed)
//  - members of the optional BC_ROLE_ID role (only if set in env)
//  - user IDs listed in ADMIN_IDS (optional, env, comma separated)
const EXTRA_ROLE_ID = process.env.BC_ROLE_ID || null;
const EXTRA_USER_IDS = (process.env.ADMIN_IDS || '').split(/[\s,]+/).filter(Boolean);

const hasStaffPerms = (member) => {
    const raw = member.permissions;
    if (!raw) return false;
    // GuildMember.permissions is a PermissionsBitField; interaction payloads give a string
    const perms = raw instanceof PermissionsBitField ? raw : new PermissionsBitField(BigInt(raw));
    return perms.has(PermissionsBitField.Flags.Administrator) || perms.has(PermissionsBitField.Flags.ManageGuild);
};

const hasExtraRole = (member) => {
    if (!EXTRA_ROLE_ID) return false;
    if (Array.isArray(member.roles)) return member.roles.includes(EXTRA_ROLE_ID);
    return !!member.roles?.cache?.has(EXTRA_ROLE_ID);
};

const canUse = (member) => {
    if (!member) return false;
    if (EXTRA_USER_IDS.includes(member.id ?? member.user?.id)) return true;
    return hasStaffPerms(member) || hasExtraRole(member);
};

module.exports = { canUse };
