import { db } from './state.js';
import { unseal } from './crypto.js';
import { sendNtfy } from './ntfy.js';

/** Raretés qui déclenchent une notification (l'utilisateur peut couper). */
const RARE = new Set(['L', 'M']);

const LABELS = { E: 'Épique', L: 'Légendaire', M: 'Mythique' };

/** Même erreur répétée (site en panne) : une notification par demi-heure suffit. */
const ERROR_COOLDOWN_MS = 30 * 60 * 1000;
/** @type {Map<string, number>} */
const lastErrorAt = new Map();

/** Configuration exploitable d'un utilisateur, ou null. */
export function notifyConfig(user) {
	const n = user?.notify;
	if (!n?.enabled || !String(n.topic ?? '').trim()) return null;
	return {
		url: String(n.url || 'https://ntfy.sh'),
		topic: String(n.topic).trim(),
		token: unseal(n.token),
		username: n.username || null,
		password: unseal(n.password)
	};
}

function cardsLine(cards) {
	const names = (cards ?? []).map((c) => c.name).filter(Boolean);
	if (!names.length) return '';
	const shown = names.slice(0, 5).join(', ');
	return `\n${names.length} carte(s) : ${shown}${names.length > 5 ? '…' : ''}`;
}

/**
 * Ouverture remarquable (légendaire ou mythique).
 * @returns {Promise<boolean>} true si une notification est partie
 */
export async function notifyRare(account, entry) {
	const user = db.users.find((u) => u.id === account?.ownerId);
	const cfg = notifyConfig(user);
	if (!cfg) return false;
	if (user.notify.onRare === false) return false;
	if (!RARE.has(entry?.best)) return false;

	const who = account.account?.pseudo ?? account.label ?? 'Compte';
	const label = LABELS[entry.best] ?? entry.best;
	const golden = entry.golden ? ' · Golden' : '';
	const res = await sendNtfy({
		...cfg,
		title: entry.best === 'M' ? 'Kyara — Mythique !' : 'Kyara — Legendaire',
		message: `${who} · ${entry.packName} ouvert — ${label}${golden}${cardsLine(entry.cards)}`,
		priority: entry.best === 'M' ? 5 : 4,
		tags: entry.best === 'M' ? ['rotating_light', 'sparkles'] : ['tada']
	});
	return res.ok;
}

/**
 * Erreur du bot (clé refusée, réseau, API). Tempérée pour ne pas inonder
 * quand le site est en panne.
 */
export async function notifyError(account, text) {
	const user = db.users.find((u) => u.id === account?.ownerId);
	const cfg = notifyConfig(user);
	if (!cfg) return false;
	if (user.notify.onErrors === false) return false;

	const now = Date.now();
	const last = lastErrorAt.get(account.id) ?? 0;
	if (now - last < ERROR_COOLDOWN_MS) return false;
	lastErrorAt.set(account.id, now);

	const who = account.account?.pseudo ?? account.label ?? 'Compte';
	const res = await sendNtfy({
		...cfg,
		title: 'Kyara — erreur',
		message: `${who} · ${text}`,
		priority: 4,
		tags: ['warning']
	});
	return res.ok;
}

/** Réinitialise le compteur de silence (utile aux tests). */
export function resetNotifyCooldown() {
	lastErrorAt.clear();
}

/* ------------------------------------------------------------------ */
/* Marché : ventes, achats, échanges                                   */
/* ------------------------------------------------------------------ */

/** Types de notification `/me/notifications` qui méritent un push. */
const MARKET_TYPES = new Set([
	'sold',
	'bought',
	'trade_offer',
	'trade_accepted',
	'outbid',
	'auction_won',
	'auction_lost'
]);

const MARKET_TITLES = {
	sold: 'Kyara — vente',
	bought: 'Kyara — achat',
	trade_offer: 'Kyara — échange',
	trade_accepted: 'Kyara — échange accepté',
	outbid: 'Kyara — surenchère',
	auction_won: 'Kyara — enchère gagnée',
	auction_lost: 'Kyara — enchère perdue'
};

const MARKET_TAGS = {
	sold: ['moneybag'],
	bought: ['shopping_cart'],
	trade_offer: ['handshake'],
	trade_accepted: ['handshake'],
	outbid: ['warning'],
	auction_won: ['trophy'],
	auction_lost: ['warning']
};

const fmt = (n) => (Number.isFinite(n) ? `${n} ◆` : 'prix inconnu');

/** Une ligne lisible par type, à partir du `data` renvoyé par Kyara. */
function marketLine(type, data = {}) {
	const name = data.name ?? data.character?.name ?? data.characterName ?? 'une carte';
	switch (type) {
		case 'sold': {
			const net = Number.isFinite(data.net) ? ` (net ${fmt(data.net)})` : '';
			return `Vente · ${name} — ${fmt(data.price)}${net}`;
		}
		case 'bought':
			return `Achat · ${name} — ${fmt(data.price)}`;
		case 'trade_offer':
			return `Échange proposé par ${data.from ?? data.pseudo ?? 'un joueur'}`;
		case 'trade_accepted':
			return `Échange accepté avec ${data.with ?? data.from ?? 'un joueur'}`;
		case 'outbid':
			return `Surenchère · ${name} — ${fmt(data.price)}`;
		case 'auction_won':
			return `Enchère gagnée · ${name} — ${fmt(data.price)}`;
		case 'auction_lost':
			return `Enchère perdue · ${name}`;
		default:
			return type;
	}
}

/**
 * Transaction de marché (vente, achat, échange, enchère) → ntfy.
 * Silencieux si le propriétaire a coupé « achats & ventes ».
 * @returns {Promise<boolean>} true si un push est parti
 */
export async function notifyMarket(account, item) {
	const type = item?.type;
	if (!MARKET_TYPES.has(type)) return false;

	const user = db.users.find((u) => u.id === account?.ownerId);
	const cfg = notifyConfig(user);
	if (!cfg) return false;
	if (user.notify.onMarket === false) return false;

	const who = account.account?.pseudo ?? account.label ?? 'Compte';
	const res = await sendNtfy({
		...cfg,
		title: MARKET_TITLES[type] ?? 'Kyara — marché',
		message: `${who} · ${marketLine(type, item.data)}`,
		priority: 3,
		tags: MARKET_TAGS[type] ?? ['moneybag']
	});
	return res.ok;
}

/** Types pris en charge (exporté pour les tests). */
export const MARKET_NOTIFICATION_TYPES = [...MARKET_TYPES];
