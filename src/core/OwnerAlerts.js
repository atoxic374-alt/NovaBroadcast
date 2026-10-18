const { environmentOwnerIds } = require('./Owners');

const pendingAlerts = [];
const recentAlerts = new Map();
const DEDUPE_WINDOW_MS = 60_000;
let warnedMissingOwners = false;

const connectedClients = (clients = []) => clients.filter(client =>
    client?.user && typeof client.isReady === 'function' && client.isReady()
);

const deliver = async (alert, clients) => {
    const online = connectedClients(clients);
    const remaining = [];
    for (const ownerId of alert.ownerIds) {
        let delivered = false;
        for (const client of online) {
            try {
                const owner = await client.users.fetch(ownerId);
                await owner.send(alert.message);
                delivered = true;
                break;
            } catch {
                // Try the next connected bot; the owner may have closed DMs with one bot.
            }
        }
        if (!delivered) remaining.push(ownerId);
    }
    return remaining;
};

const notifyEnvironmentOwners = async (clients, { title, details, dedupeKey } = {}) => {
    const ownerIds = environmentOwnerIds();
    if (!ownerIds.length) {
        if (!warnedMissingOwners) {
            console.warn('[OwnerAlerts] No valid OWNER_IDS are configured; owner alerts are disabled.');
            warnedMissingOwners = true;
        }
        return false;
    }

    const now = Date.now();
    if (dedupeKey && now - (recentAlerts.get(dedupeKey) || 0) < DEDUPE_WINDOW_MS) return false;
    if (dedupeKey) recentAlerts.set(dedupeKey, now);

    const message = [
        `⚠️ **Nova Realm — تنبيه حالة بوت**`,
        `**${title || 'مشكلة في أحد البوتات'}**`,
        details || 'حدثت مشكلة غير محددة.',
        `الوقت: <t:${Math.floor(now / 1000)}:F>`
    ].join('\n');
    const alert = { ownerIds, message };
    const remaining = await deliver(alert, clients);
    if (remaining.length) {
        alert.ownerIds = remaining;
        pendingAlerts.push(alert);
    }
    return remaining.length === 0;
};

const flushPendingOwnerAlerts = async (clients) => {
    if (!pendingAlerts.length || !connectedClients(clients).length) return;
    const queued = pendingAlerts.splice(0, pendingAlerts.length);
    for (const alert of queued) {
        const remaining = await deliver(alert, clients);
        if (remaining.length) {
            alert.ownerIds = remaining;
            pendingAlerts.push(alert);
        }
    }
};

module.exports = { notifyEnvironmentOwners, flushPendingOwnerAlerts };
