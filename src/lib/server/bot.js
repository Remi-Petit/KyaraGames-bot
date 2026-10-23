import { state, save, log, pushOpen } from './state.js';
import * as kyara from './kyara.js';
import { KyaraError } from './kyara.js';

const RARITY_ORDER = ['C', 'U', 'R', 'E', 'L', 'M'];
const MIN = 60_000;

let timer = null;
let busy = false;
let started = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => min + Math.random() * (max - min);

/* ------------------------------------------------------------------ */
/* Compte                                                              */
/* ------------------------------------------------------------------ */

export function applyMe(me) {
	if (!me || typeof me !== 'object') return;
	state.account = {
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
	state.meta.freePacksMax = me.freePacksMax ?? state.meta.freePacksMax;
	state.tokenInvalid = false;
	save();
}

/* ------------------------------------------------------------------ */
/* Boosters disponibles                                                */
/* ------------------------------------------------------------------ */

function isFreeNow(pack, now = Date.now()) {
	if (!pack || !pack.usesFreePacks || pack.price !== 0 || pack.grantOnly) return false;
	if (pack.schedule) {
		const start = Date.parse(pack.schedule.start);
		const end = Date.parse(pack.schedule.end);
		if (Number.isFinite(start) && now < start) return false;
		if (Number.isFinite(end) && now > end) return false;
	}
	return true;
}

async function refreshPacks(force = false) {
	const age = Date.now() - (state.meta.packsFetchedAt || 0);
	if (!force && state.meta.packs && age < 15 * MIN) return state.meta.packs;
	const packs = await kyara.api.packs();
	state.meta.packs = (Array.isArray(packs) ? packs : []).map((p) => ({
		id: p.id,
		name: p.name,
		kanji: p.kanji ?? null,
		color: p.color ?? null,
		price: p.price,
		usesFreePacks: p.usesFreePacks,
		grantOnly: p.grantOnly,
		schedule: p.schedule ?? null,
		limit: p.limit ?? null,
		free: isFreeNow(p)
	}));
	state.meta.packsFetchedAt = Date.now();
	save();
	return state.meta.packs;
}

async function refreshConfig() {
	try {
		const cfg = await kyara.api.config();
		const hours = cfg?.freePacks?.regenHours;
		if (Number.isFinite(hours) && hours > 0) state.meta.regenMs = Math.round(hours * 3_600_000);
		if (Number.isFinite(cfg?.freePacks?.max)) state.meta.freePacksMax = cfg.freePacks.max;
		save();
	} catch {
		/* non bloquant */
	}
}

/** Round-robin sur les types activés, en repartant après le dernier utilisé. */
function pickNextPack() {
	const packs = state.meta.packs || [];
	const free = packs.filter((p) => p.free);
	const allowed =
		Array.isArray(state.settings.types) && state.settings.types.length
			? free.filter((p) => state.settings.types.includes(p.id))
			: free;
	const pool = allowed.length ? allowed : free;
	if (!pool.length) return null;

	const last = state.bot.lastPackId;
	const index = last ? pool.findIndex((p) => p.id === last) : -1;
	return pool[(index + 1) % pool.length];
}

/* ------------------------------------------------------------------ */
/* Enregistrement d'un booster                                         */
/* ------------------------------------------------------------------ */

function normalizeCards(result) {
	const raw = Array.isArray(result?.cards) ? result.cards : [];
	return raw.map((c) => ({
		id: c.id ?? c.characterId ?? null,
		name: c.name ?? c.character?.name ?? c.title ?? 'Carte',
		rarity: typeof c.rarity === 'string' ? c.rarity : c.character?.rarity ?? null,
		series: c.series ?? c.character?.series ?? null,
		image: c.image ?? c.character?.image ?? null,
		isNew: Boolean(c.isNew)
	}));
}

function bestRarity(cards) {
	let best = null;
	for (const c of cards) {
		if (!c.rarity) continue;
		if (!best || RARITY_ORDER.indexOf(c.rarity) > RARITY_ORDER.indexOf(best)) best = c.rarity;
	}
	return best;
}

function recordOpen(pack, result, kind = 'free') {
	const cards = normalizeCards(result);
	const entry = {
		at: new Date().toISOString(),
		packId: pack.id,
		packName: pack.name,
		kind,
		cards,
		best: bestRarity(cards),
		golden: Boolean(result?.golden),
		divine: Boolean(result?.godPack)
	};
	pushOpen(entry);

	const best = entry.best;
	const label =
		best === 'M' ? 'MYTHIQUE !' : best === 'L' ? 'Légendaire' : best === 'E' ? 'Épique' : null;
	const variant = entry.divine ? ' · GOD PACK' : entry.golden ? ' · Golden' : '';
	log(
		best === 'M' || entry.divine ? 'success' : 'info',
		`${pack.name} ouvert${variant}${label ? ` — ${label}` : ''} · ${cards.length} cartes` +
			(cards.length ? ` (${cards.map((c) => c.name).slice(0, 3).join(', ')}${cards.length > 3 ? '…' : ''})` : '')
	);
	return entry;
}

/* ------------------------------------------------------------------ */
/* Cycle principal                                                     */
/* ------------------------------------------------------------------ */

async function openAllFree() {
	/** @type {{id:string,name:string}|null} */
	let pack = pickNextPack();
	if (!pack) {
		log('warn', 'Aucun type de booster gratuit activé.');
		return 0;
	}

	let opened = 0;
	let free = state.account?.freePacks ?? 0;
	const max = state.settings.maxPerRun ?? 10;

	while (free > 0 && opened < max) {
		try {
			const result = await kyara.api.openPack(pack.id);
			recordOpen(pack, result);
			state.bot.lastPackId = pack.id;
			state.bot.lastOpenedAt = new Date().toISOString();
			opened += 1;

			if (typeof result?.user?.freePacks === 'number') free = result.user.freePacks;
			else free -= 1;
			if (typeof result?.user?.chakra === 'number' && state.account) {
				state.account.chakra = result.user.chakra;
			}

			pack = pickNextPack();
			if (!pack) break;
			if (free > 0) await sleep(state.settings.humanDelay === false ? 400 : rand(2500, 5200));
		} catch (e) {
			handleError(e, 'ouverture');
			break;
		}
	}
	return opened;
}

async function openDaily() {
	if (!state.settings.dailyPack) return;
	try {
		const limits = await kyara.api.packState();
		const left = limits?.limits?.daily?.left ?? 1;
		if (left <= 0) return;
		const result = await kyara.api.openPack('daily');
		const pack = { id: 'daily', name: 'Pack du jour' };
		recordOpen(pack, result, 'daily');
	} catch (e) {
		if (e instanceof KyaraError && (e.code === 'daily_limit' || e.code === 'already_claimed')) {
			return;
		}
		log('warn', `Pack du jour : ${e.message}`);
	}
}

function handleError(e, context) {
	if (e instanceof KyaraError) {
		if (e.status === 401) {
			state.tokenInvalid = true;
			state.bot.running = false;
			state.bot.lastError = 'Clé refusée (401) — recolle une clé valide depuis kyara.games.';
			log('error', `401 sur ${context} : la clé n’est plus valide. Bot mis en pause.`);
			return;
		}
		state.bot.lastError = `${context} · ${e.code}${e.message ? ` (${e.message})` : ''}`;
		log('error', `${context} · ${e.code}${e.message ? ` — ${e.message}` : ''}`);
		return;
	}
	state.bot.lastError = `${context} · ${e?.message ?? e}`;
	log('error', `${context} · ${e?.message ?? e}`);
}

async function tick(reason = 'schedule') {
	if (busy) return;
	if (!state.bot.running) return;
	if (!kyara.token()) {
		state.bot.nextRunAt = null;
		save();
		return;
	}

	busy = true;
	state.bot.busy = true;
	state.bot.lastRunReason = reason;
	save();

	try {
		const me = await kyara.api.me();
		applyMe(me);

		await refreshConfig();
		await refreshPacks();

		if ((me.freePacks ?? 0) > 0) {
			log('info', `Check · ${me.freePacks}/${me.freePacksMax} boosters gratuits`);
		}
		await openAllFree();
		await openDaily();

		const after = await kyara.api.me().catch(() => null);
		if (after) applyMe(after);

		state.bot.lastRunAt = new Date().toISOString();
		state.bot.lastError = null;
	} catch (e) {
		handleError(e, 'cycle');
		state.bot.lastRunAt = new Date().toISOString();
	} finally {
		busy = false;
		state.bot.busy = false;
		save();
		scheduleNext();
	}
}

/* ------------------------------------------------------------------ */
/* Planification                                                       */
/* ------------------------------------------------------------------ */

/**
 * Prochain réveil :
 *  - borne haute = intervalle demandé (90 min par défaut)
 *  - borne de sécurité = instant où le stock atteindrait le plafond (sinon des
 *    boosters seraient perdus)
 */
export function computeNextRun(now = Date.now()) {
	const pollMs = Math.max(1, state.settings.pollMinutes ?? 90) * MIN;
	let next = now + pollMs;

	const acc = state.account;
	if (state.settings.smart !== false && acc?.nextFreeAt) {
		const max = acc.freePacksMax ?? state.meta.freePacksMax ?? 10;
		const free = acc.freePacks ?? 0;
		const regen = state.meta.regenMs || 600_000;
		const nextFree = Date.parse(acc.nextFreeAt);
		if (free >= max) {
			next = now;
		} else if (Number.isFinite(nextFree)) {
			const overflow = nextFree + Math.max(0, max - free - 1) * regen;
			if (overflow < next) next = overflow;
		}
	}

	// Garde-fous : jamais deux passages à moins d'une minute, et backoff après erreur.
	if (state.bot.lastRunAt) {
		const last = Date.parse(state.bot.lastRunAt);
		if (Number.isFinite(last)) next = Math.max(next, last + MIN);
	}
	if (state.bot.lastError) next = Math.max(next, now + 5 * MIN);

	const jitter = state.settings.smart === false ? 0 : rand(0, 45_000);
	return Math.max(next, now + 5000) + jitter;
}

export function scheduleNext() {
	clearTimeout(timer);
	if (!state.bot.running || !kyara.token()) {
		state.bot.nextRunAt = null;
		save();
		return;
	}
	const now = Date.now();
	const next = computeNextRun(now);
	state.bot.nextRunAt = new Date(next).toISOString();
	save();

	timer = setTimeout(() => {
		tick('schedule');
	}, next - now);
	if (typeof timer.unref === 'function') timer.unref();
}

/* ------------------------------------------------------------------ */
/* Contrôle                                                            */
/* ------------------------------------------------------------------ */

export function startEngine() {
	if (started) return;
	started = true;
	// La liste des boosters et la cadence de régénération sont publiques :
	// on les charge même sans clé, pour que l'interface soit immédiatement utile.
	refreshConfig().catch(() => {});
	refreshPacks(true).catch(() => {});

	if (!kyara.token()) {
		log('info', 'Démarrage : aucune clé enregistrée, en attente de connexion.');
	} else if (state.bot.running) {
		log('info', 'Bot démarré.');
	}
	scheduleNext();
}

export function pause() {
	state.bot.running = false;
	state.bot.nextRunAt = null;
	clearTimeout(timer);
	log('warn', 'Bot mis en pause.');
	save();
}

export function resume() {
	state.bot.running = true;
	state.tokenInvalid = false;
	log('info', 'Bot relancé.');
	save();
	scheduleNext();
	if (state.account) tick('resume');
}

export async function runNow(reason = 'manuel') {
	if (!kyara.token()) throw new Error('Aucune clé enregistrée');
	state.bot.running = true;
	await tick(reason);
}

export function onTokenSaved() {
	state.bot.running = true;
	state.tokenInvalid = false;
	scheduleNext();
	setTimeout(() => tick('token-saved'), 800);
}

export function onTokenCleared() {
	clearTimeout(timer);
	state.bot.nextRunAt = null;
	state.account = null;
	state.bot.running = false;
	state.bot.lastError = null;
	save();
}
