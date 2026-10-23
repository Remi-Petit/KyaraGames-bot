import fs from 'node:fs';
import { dataFile } from './config.js';

const FILE = dataFile('state.json');
const LOG_LIMIT = 400;
const OPEN_LIMIT = 80;

function defaults() {
	return {
		version: 1,
		/** sealed token (AES-256-GCM, base64) — never leaves the server */
		token: null,
		tokenSetAt: null,
		tokenInvalid: false,
		account: null,
		bot: {
			running: true,
			busy: false,
			lastRunAt: null,
			lastRunReason: null,
			nextRunAt: null,
			lastError: null,
			lastPackId: null,
			lastOpenedAt: null
		},
		settings: {
			pollMinutes: 90,
			maxPerRun: 10,
			dailyPack: true,
			/** null = tous les boosters gratuits */
			types: null,
			smart: true,
			humanDelay: true
		},
		stats: { opened: 0, byRarity: { C: 0, U: 0, R: 0, E: 0, L: 0, M: 0 }, packs: {} },
		opens: [],
		logs: [],
		meta: { regenMs: 600_000, freePacksMax: 10, packsFetchedAt: null, packs: null }
	};
}

function load() {
	try {
		const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
		const base = defaults();
		return {
			...base,
			...raw,
			bot: { ...base.bot, ...(raw.bot || {}) },
			settings: { ...base.settings, ...(raw.settings || {}) },
			stats: {
				...base.stats,
				...(raw.stats || {}),
				byRarity: { ...base.stats.byRarity, ...(raw.stats?.byRarity || {}) },
				packs: { ...(raw.stats?.packs || {}) }
			},
			meta: { ...base.meta, ...(raw.meta || {}) }
		};
	} catch {
		return defaults();
	}
}

export const state = load();

let timer = null;

export function save() {
	if (timer) return;
	timer = setTimeout(() => {
		timer = null;
		flush();
	}, 150);
	if (typeof timer.unref === 'function') timer.unref();
}

export function flush() {
	const tmp = FILE + '.tmp';
	fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
	fs.renameSync(tmp, FILE);
}

/**
 * @param {'info'|'warn'|'error'|'success'} level
 */
export function log(level, message) {
	state.logs.unshift({ at: new Date().toISOString(), level, message: String(message) });
	if (state.logs.length > LOG_LIMIT) state.logs.length = LOG_LIMIT;
	save();
}

export function resetAccount() {
	state.account = null;
	state.tokenInvalid = false;
}

/** Public snapshot for the dashboard: the token itself is never exposed. */
export function snapshot() {
	return {
		now: Date.now(),
		tokenSet: Boolean(state.token),
		tokenHint: state.token ? 'clé enregistrée' : null,
		tokenSetAt: state.tokenSetAt,
		tokenInvalid: state.tokenInvalid,
		account: state.account,
		bot: state.bot,
		settings: state.settings,
		stats: state.stats,
		opens: state.opens,
		logs: state.logs,
		meta: {
			regenMs: state.meta.regenMs,
			freePacksMax: state.meta.freePacksMax,
			freeTypes: (state.meta.packs || [])
				.filter((p) => p.free)
				.map((p) => ({ id: p.id, name: p.name, kanji: p.kanji || null }))
		}
	};
}

export function pushOpen(entry) {
	state.opens.unshift(entry);
	if (state.opens.length > OPEN_LIMIT) state.opens.length = OPEN_LIMIT;
	state.stats.opened += 1;
	for (const card of entry.cards) {
		const r = card.rarity;
		if (r) state.stats.byRarity[r] = (state.stats.byRarity[r] || 0) + 1;
	}
	state.stats.packs[entry.packId] = (state.stats.packs[entry.packId] || 0) + 1;
	save();
}
