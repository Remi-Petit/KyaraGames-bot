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
