import { db, findAccount, save, log, pushOpen, profileFromMe } from './state.js';
import { createClient, publicApi, KyaraError } from './kyara.js';
import { unseal } from './crypto.js';

const RARITY_ORDER = ['C', 'U', 'R', 'E', 'L', 'M'];
const MIN = 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => min + Math.random() * (max - min);

/* ------------------------------------------------------------------ */
/* Données publiques partagées (catalogue + cadence de régénération)    */
/* ------------------------------------------------------------------ */

let packsPromise = null;
let configPromise = null;

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

/** Une seule requête à la fois, même si plusieurs comptes démarrent ensemble. */
export async function ensurePacks(force = false) {
	const age = Date.now() - (db.meta.packsFetchedAt || 0);
	if (!force && db.meta.packs && age < 15 * MIN) return db.meta.packs;
	if (packsPromise) return packsPromise;

	packsPromise = (async () => {
		const packs = await publicApi.packs();
		db.meta.packs = (Array.isArray(packs) ? packs : []).map((p) => ({
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
		db.meta.packsFetchedAt = Date.now();
		save();
		return db.meta.packs;
	})().finally(() => {
		packsPromise = null;
	});

	return packsPromise;
}

export async function ensureConfig() {
	if (configPromise) return configPromise;
	configPromise = (async () => {
		try {
			const cfg = await publicApi.config();
			const hours = cfg?.freePacks?.regenHours;
			if (Number.isFinite(hours) && hours > 0) db.meta.regenMs = Math.round(hours * 3_600_000);
			if (Number.isFinite(cfg?.freePacks?.max)) db.meta.freePacksMax = cfg.freePacks.max;
			save();
		} catch {
			/* non bloquant */
		}
	})().finally(() => {
		configPromise = null;
	});
	return configPromise;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function applyMe(acct, me) {
	const profile = profileFromMe(me);
	if (!profile) return;
	acct.account = profile;
	acct.checkedAt = new Date().toISOString();
	db.meta.freePacksMax = me.freePacksMax ?? db.meta.freePacksMax;
	acct.tokenInvalid = false;
	save();
}

/** Round-robin sur les types activés, propre à chaque compte. */
function pickNextPack(acct) {
	const packs = db.meta.packs || [];
	const free = packs.filter((p) => p.free);
	const allowed =
		Array.isArray(acct.settings.types) && acct.settings.types.length
			? free.filter((p) => acct.settings.types.includes(p.id))
			: free;
	const pool = allowed.length ? allowed : free;
	if (!pool.length) return null;

	const last = acct.bot.lastPackId;
	const index = last ? pool.findIndex((p) => p.id === last) : -1;
	return pool[(index + 1) % pool.length];
}

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

function recordOpen(acct, pack, result, kind = 'free') {
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
	pushOpen(acct, entry);

	const best = entry.best;
	const label =
		best === 'M' ? 'MYTHIQUE !' : best === 'L' ? 'Légendaire' : best === 'E' ? 'Épique' : null;
	const variant = entry.divine ? ' · GOD PACK' : entry.golden ? ' · Golden' : '';
	log(
		acct,
		best === 'M' || entry.divine ? 'success' : 'info',
		`${pack.name} ouvert${variant}${label ? ` — ${label}` : ''} · ${cards.length} cartes` +
			(cards.length
				? ` (${cards.map((c) => c.name).slice(0, 3).join(', ')}${cards.length > 3 ? '…' : ''})`
				: '')
	);
	return entry;
}

/* ------------------------------------------------------------------ */
/* Un moteur par compte                                                */
/* ------------------------------------------------------------------ */

/**
 * Prochain réveil pour un compte :
 *  - borne haute = intervalle demandé (90 min par défaut)
 *  - borne de sécurité = instant où le stock atteindrait le plafond
 */
export function computeNextRun(acct, now = Date.now()) {
	const pollMs = Math.max(1, acct.settings.pollMinutes ?? 90) * MIN;
	let next = now + pollMs;

	const profile = acct.account;
	if (acct.settings.smart !== false && profile?.nextFreeAt) {
		const max = profile.freePacksMax ?? db.meta.freePacksMax ?? 10;
		const free = profile.freePacks ?? 0;
		const regen = db.meta.regenMs || 600_000;
		const nextFree = Date.parse(profile.nextFreeAt);
		if (free >= max) {
			next = now;
		} else if (Number.isFinite(nextFree)) {
			const overflow = nextFree + Math.max(0, max - free - 1) * regen;
			if (overflow < next) next = overflow;
		}
	}

	// Garde-fous : jamais deux passages à moins d'une minute, et backoff après erreur.
	if (acct.bot.lastRunAt) {
		const last = Date.parse(acct.bot.lastRunAt);
		if (Number.isFinite(last)) next = Math.max(next, last + MIN);
	}
	if (acct.bot.lastError) next = Math.max(next, now + 5 * MIN);

	const jitter = acct.settings.smart === false ? 0 : rand(0, 45_000);
	return Math.max(next, now + 5000) + jitter;
}

export class Runner {
	constructor(id) {
		this.id = id;
		this.timer = null;
		this.busy = false;
		this.client = createClient(() => unseal(this.acct?.token ?? null));
	}

	get acct() {
		return findAccount(this.id);
	}

	schedule() {
		clearTimeout(this.timer);
		this.timer = null;
		const acct = this.acct;
		if (!acct || !acct.bot.running || !acct.token) {
			if (acct) {
				acct.bot.nextRunAt = null;
				save();
			}
			return;
		}

		const now = Date.now();
		const next = computeNextRun(acct, now);
		acct.bot.nextRunAt = new Date(next).toISOString();
		save();

		this.timer = setTimeout(() => this.tick('schedule'), next - now);
		if (typeof this.timer.unref === 'function') this.timer.unref();
	}

	async tick(reason = 'schedule') {
		const acct = this.acct;
		if (!acct || this.busy) return;
		if (!acct.bot.running) return;
		if (!acct.token) {
			acct.bot.nextRunAt = null;
			save();
			return;
		}

		this.busy = true;
		acct.bot.busy = true;
		acct.bot.lastRunReason = reason;
		save();

		try {
			const me = await this.client.me();
			applyMe(acct, me);

			await ensureConfig();
			await ensurePacks();

			if ((me.freePacks ?? 0) > 0) {
				log(acct, 'info', `Check · ${me.freePacks}/${me.freePacksMax} boosters gratuits`);
			}

			await this.openAllFree(acct);
			await this.openDaily(acct);

			const after = await this.client.me().catch(() => null);
			if (after) applyMe(acct, after);

			acct.bot.lastRunAt = new Date().toISOString();
			acct.bot.lastError = null;
		} catch (e) {
			this.handleError(acct, e, 'cycle');
			acct.bot.lastRunAt = new Date().toISOString();
		} finally {
			this.busy = false;
			acct.bot.busy = false;
			save();
			this.schedule();
		}
	}

	async openAllFree(acct) {
		let pack = pickNextPack(acct);
		if (!pack) {
			log(acct, 'warn', 'Aucun type de booster gratuit activé.');
			return 0;
		}

		let opened = 0;
		let free = acct.account?.freePacks ?? 0;
		const max = acct.settings.maxPerRun ?? 10;

		while (free > 0 && opened < max) {
			try {
				const result = await this.client.openPack(pack.id);
				recordOpen(acct, pack, result);
				acct.bot.lastPackId = pack.id;
				acct.bot.lastOpenedAt = new Date().toISOString();
				opened += 1;

				if (typeof result?.user?.freePacks === 'number') free = result.user.freePacks;
				else free -= 1;
				if (typeof result?.user?.chakra === 'number' && acct.account) {
					acct.account.chakra = result.user.chakra;
				}

				pack = pickNextPack(acct);
				if (!pack) break;
				if (free > 0) await sleep(acct.settings.humanDelay === false ? 400 : rand(2500, 5200));
			} catch (e) {
				this.handleError(acct, e, 'ouverture');
				break;
			}
		}
		return opened;
	}

	async openDaily(acct) {
		if (!acct.settings.dailyPack) return;
		try {
			const limits = await this.client.packState();
			const left = limits?.limits?.daily?.left ?? 1;
			if (left <= 0) return;
			const result = await this.client.openPack('daily');
			recordOpen(acct, { id: 'daily', name: 'Pack du jour' }, result, 'daily');
		} catch (e) {
			if (e instanceof KyaraError && (e.code === 'daily_limit' || e.code === 'already_claimed')) {
				return;
			}
			log(acct, 'warn', `Pack du jour : ${e.message}`);
		}
	}

	handleError(acct, e, context) {
		if (e instanceof KyaraError) {
			if (e.status === 401) {
				acct.tokenInvalid = true;
				acct.bot.running = false;
				acct.bot.lastError = 'Clé refusée (401) — recolle une clé valide depuis kyara.games.';
				log(acct, 'error', `401 sur ${context} : la clé n’est plus valide. Bot mis en pause.`);
				return;
			}
			acct.bot.lastError = `${context} · ${e.code}${e.message ? ` (${e.message})` : ''}`;
			log(acct, 'error', `${context} · ${e.code}${e.message ? ` — ${e.message}` : ''}`);
			return;
		}
		acct.bot.lastError = `${context} · ${e?.message ?? e}`;
		log(acct, 'error', `${context} · ${e?.message ?? e}`);
	}

	/* ---------------- contrôle ---------------- */

	pause() {
		const acct = this.acct;
		if (!acct) return;
		acct.bot.running = false;
		acct.bot.nextRunAt = null;
		clearTimeout(this.timer);
		this.timer = null;
		log(acct, 'warn', 'Bot mis en pause.');
		save();
	}

	resume() {
		const acct = this.acct;
		if (!acct) return;
		acct.bot.running = true;
		acct.tokenInvalid = false;
		log(acct, 'info', 'Bot relancé.');
		save();
		this.schedule();
		if (acct.account) this.tick('resume');
	}

	async runNow(reason = 'manuel') {
		const acct = this.acct;
		if (!acct?.token) throw new Error('Aucune clé enregistrée pour ce compte');
		acct.bot.running = true;
		await this.tick(reason);
	}

	/** Relecture seule : rafraîchit /api/me sans ouvrir de booster. */
	async sync() {
		const acct = this.acct;
		if (!acct?.token) throw new Error('Aucune clé enregistrée pour ce compte');
		if (this.busy) return;
		const me = await this.client.me();
		applyMe(acct, me);
		this.schedule();
	}

	stop() {
		clearTimeout(this.timer);
		this.timer = null;
	}
}

/* ------------------------------------------------------------------ */
/* Registre des moteurs                                                */
/* ------------------------------------------------------------------ */

/** @type {Map<string, Runner>} */
const runners = new Map();

export function runnerFor(id) {
	let runner = runners.get(id);
	if (!runner) {
		runner = new Runner(id);
		runners.set(id, runner);
	}
	return runner;
}

export function dropRunner(id) {
	const runner = runners.get(id);
	if (runner) {
		runner.stop();
		runners.delete(id);
	}
}

let started = false;

export function startEngine() {
	if (started) return;
	started = true;

	// Données publiques : utiles même sans compte configuré.
	ensureConfig().catch(() => {});
	ensurePacks(true).catch(() => {});

	if (!db.accounts.length) {
		console.log('[kyara] démarrage : aucun compte, en attente de connexion');
	}

	for (const acct of db.accounts) {
		if (!acct.token) continue;
		log(acct, 'info', acct.bot.running ? 'Bot démarré.' : 'Compte chargé (en pause).');
		const runner = runnerFor(acct.id);
		runner.schedule();
		// Un GET /me au démarrage : les compteurs affichés repartent à jour.
		if (acct.bot.running) runner.sync().catch(() => {});
	}
}

export function onTokenSaved(id) {
	const runner = runnerFor(id);
	const acct = runner.acct;
	if (!acct) return;
	acct.bot.running = true;
	acct.tokenInvalid = false;
	acct.bot.lastError = null;
	save();
	runner.schedule();
	setTimeout(() => runner.tick('token-saved'), 800);
}

export function onTokenRemoved(id) {
	dropRunner(id);
}

