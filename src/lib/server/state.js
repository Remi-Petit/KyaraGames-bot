import fs from 'node:fs';
import { dataFile } from './config.js';
import { publish } from './bus.js';

const FILE = dataFile('state.json');
const LOG_LIMIT = 300;
const OPEN_LIMIT = 60;

/** Nombre maximum de comptes gérés (garde-fou). */
export const MAX_ACCOUNTS = 10;

function defaultSettings() {
	return {
		pollMinutes: 90,
		maxPerRun: 10,
		dailyPack: true,
		/** null = tous les boosters gratuits */
		types: null,
		smart: true,
		humanDelay: true
	};
}

function defaultBot() {
	return {
		running: true,
		busy: false,
		lastRunAt: null,
		lastRunReason: null,
		nextRunAt: null,
		lastError: null,
		lastPackId: null,
		lastOpenedAt: null,
		/** jour dont le pack quotidien a déjà été journalisé (évite une ligne par cycle) */
		dailyLoggedDay: null
	};
}

function defaultStats() {
	return { opened: 0, byRarity: { C: 0, U: 0, R: 0, E: 0, L: 0, M: 0 }, packs: {} };
}

/** Profil public d'un compte, dérivé de GET /api/me. */
export function profileFromMe(me) {
	if (!me || typeof me !== 'object') return null;
	return {
		id: me.id,
		pseudo: me.pseudo,
		discord: me.discord || null,
		chakra: me.chakra ?? 0,
		freePacks: me.freePacks ?? 0,
		freePacksMax: me.freePacksMax ?? 10,
		nextFreeAt: me.nextFreeAt ?? null,
		pity: me.pity ?? 0,
		boostersOpened: me.boostersOpened ?? 0,
		goldenIn: me.goldenIn ?? null,
		createdAt: me.createdAt ?? null,
		marketLimits: me.marketLimits ?? null,
		trust: me.trust ?? null,
		ban: me.ban ?? null
	};
}

export function normalizeAccount(raw, fallbackId = 'compte') {
	const stats = raw?.stats || {};
	const base = defaultStats();
	return {
		id: String(raw?.id ?? fallbackId),
		/** propriétaire (utilisateur du dashboard) — null = héritage v2, réclamé par l'admin */
		ownerId: raw?.ownerId ?? null,
		label: raw?.label ?? null,
		token: raw?.token ?? null,
		tokenSetAt: raw?.tokenSetAt ?? null,
		tokenInvalid: raw?.tokenInvalid ?? false,
		/** dernier GET /api/me réussi : les compteurs affichés datent de là */
		checkedAt: raw?.checkedAt ?? null,
		account: raw?.account ?? null,
		/** dernier constat sur le pack du jour : { day, left, checkedAt } */
		daily: raw?.daily ?? null,
		createdAt: raw?.createdAt ?? new Date().toISOString(),
		bot: { ...defaultBot(), ...(raw?.bot || {}) },
		settings: { ...defaultSettings(), ...(raw?.settings || {}) },
		stats: {
			...base,
			...stats,
			byRarity: { ...base.byRarity, ...(stats.byRarity || {}) },
			packs: { ...(stats.packs || {}) }
		},
		opens: Array.isArray(raw?.opens) ? raw.opens : [],
		logs: Array.isArray(raw?.logs) ? raw.logs : []
	};
}

function defaults() {
	return {
		version: 3,
		users: [],
		meta: { regenMs: 600_000, freePacksMax: 10, packsFetchedAt: null, packs: null },
		accounts: []
	};
}

function normalizeUser(raw) {
	return {
		id: String(raw?.id ?? 'user'),
		username: String(raw?.username ?? 'utilisateur'),
		salt: raw?.salt ?? '',
		hash: raw?.hash ?? '',
		role: raw?.role === 'admin' ? 'admin' : 'member',
		createdAt: raw?.createdAt ?? new Date().toISOString(),
		lastLoginAt: raw?.lastLoginAt ?? null,
		/** incrémenté à chaque changement de mot de passe : invalide les sessions */
		version: Number(raw?.version ?? 1)
	};
}

function migrate(raw) {
	const d = defaults();
	if (!raw || typeof raw !== 'object') return d;

	if (Array.isArray(raw.accounts)) {
		return {
			...d,
			meta: { ...d.meta, ...(raw.meta || {}) },
			users: Array.isArray(raw.users) ? raw.users.map(normalizeUser) : [],
			accounts: raw.accounts.map((a) => normalizeAccount(a))
		};
	}

	// v1 (mono-compte) → v2 : le compte existant devient le premier de la liste.
	if (raw.token || raw.account) {
		const account = normalizeAccount({
			id: raw.account?.id ?? 'compte-1',
			token: raw.token,
			tokenSetAt: raw.tokenSetAt,
			tokenInvalid: raw.tokenInvalid,
			account: raw.account,
			bot: raw.bot,
			settings: raw.settings,
			stats: raw.stats,
			opens: raw.opens,
			logs: raw.logs
		});
		return {
			...d,
			meta: { ...d.meta, ...(raw.meta || {}) },
			accounts: [account]
		};
	}

	return d;
}

function load() {
	try {
		return migrate(JSON.parse(fs.readFileSync(FILE, 'utf8')));
	} catch {
		return defaults();
	}
}

export const db = load();

let timer = null;

export function save() {
	if (timer) return;
	timer = setTimeout(() => {
		timer = null;
		try {
			flush();
		} catch {
			/* disque indisponible (volume démonté…) : on réessaiera au prochain save */
		}
		// Prévient les flux SSE qu'un état vient de changer.
		publish();
	}, 150);
	if (typeof timer.unref === 'function') timer.unref();
}

export function flush() {
	const tmp = FILE + '.tmp';
	fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
	fs.renameSync(tmp, FILE);
}

/* ------------------------------------------------------------------ */
/* Comptes                                                             */
/* ------------------------------------------------------------------ */

export function findAccount(id) {
	if (!id) return null;
	return db.accounts.find((a) => a.id === id) ?? null;
}

export function upsertAccount(patch) {
	let account = findAccount(patch.id);
	if (account) {
		Object.assign(account, patch);
	} else {
		account = normalizeAccount(patch);
		db.accounts.push(account);
	}
	save();
	return account;
}

export function removeAccount(id) {
	const index = db.accounts.findIndex((a) => a.id === id);
	if (index === -1) return false;
	db.accounts.splice(index, 1);
	save();
	return true;
}

/* ------------------------------------------------------------------ */
/* Journal / historique                                                */
/* ------------------------------------------------------------------ */

/**
 * @param {any} account
 * @param {'info'|'warn'|'error'|'success'} level
 */
export function log(account, level, message) {
	if (!account) return;
	account.logs.unshift({ at: new Date().toISOString(), level, message: String(message) });
	if (account.logs.length > LOG_LIMIT) account.logs.length = LOG_LIMIT;
	save();
}

export function pushOpen(account, entry) {
	account.opens.unshift(entry);
	if (account.opens.length > OPEN_LIMIT) account.opens.length = OPEN_LIMIT;
	account.stats.opened += 1;
	for (const card of entry.cards) {
		const r = card.rarity;
		if (r) account.stats.byRarity[r] = (account.stats.byRarity[r] || 0) + 1;
	}
	account.stats.packs[entry.packId] = (account.stats.packs[entry.packId] || 0) + 1;
	save();
}

/* ------------------------------------------------------------------ */
/* Vues publiques (le token n'en sort jamais)                          */
/* ------------------------------------------------------------------ */

export function accountSummary(account) {
	return {
		id: account.id,
		ownerId: account.ownerId ?? null,
		owner: account.ownerId
			? (db.users.find((u) => u.id === account.ownerId)?.username ?? null)
			: null,
		pseudo: account.account?.pseudo ?? null,
		avatar: account.account?.discord?.avatar ?? null,
		tokenSet: Boolean(account.token),
		tokenInvalid: account.tokenInvalid,
		running: account.bot.running,
		busy: account.bot.busy,
		checkedAt: account.checkedAt ?? account.bot.lastRunAt ?? null,
		/** { day, left, checkedAt } — null tant que rien n'a été relevé */
		daily: account.daily ?? null,
		freePacks: account.account?.freePacks ?? 0,
		freePacksMax: account.account?.freePacksMax ?? db.meta.freePacksMax,
		nextFreeAt: account.account?.nextFreeAt ?? null,
		nextRunAt: account.bot.nextRunAt,
		lastError: account.bot.lastError
	};
}

export function accountSnapshot(account) {
	return {
		...accountSummary(account),
		tokenSetAt: account.tokenSetAt,
		account: account.account,
		bot: account.bot,
		settings: account.settings,
		stats: account.stats,
		opens: account.opens,
		logs: account.logs
	};
}

/** Comptes visibles pour un utilisateur (admin = tout, membre = les siens). */
export function visibleAccounts(viewer) {
	if (!viewer || viewer.role === 'admin') return db.accounts;
	return db.accounts.filter((a) => a.ownerId === viewer.id);
}

export function canAccess(viewer, account) {
	if (!viewer) return true; // mode ouvert : aucun utilisateur configuré
	if (viewer.role === 'admin') return true;
	return account.ownerId === viewer.id;
}

/** Vue globale + détail du compte demandé (ou du premier visible). */
export function snapshot(accountId = null, viewer = null) {
	const accounts = visibleAccounts(viewer);
	const selected = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;
	return {
		now: Date.now(),
		maxAccounts: MAX_ACCOUNTS,
		meta: {
			regenMs: db.meta.regenMs,
			freePacksMax: db.meta.freePacksMax,
			freeTypes: (db.meta.packs || [])
				.filter((p) => p.free)
				.map((p) => ({ id: p.id, name: p.name, kanji: p.kanji || null }))
		},
		accounts: accounts.map(accountSummary),
		selected: selected ? accountSnapshot(selected) : null
	};
}
