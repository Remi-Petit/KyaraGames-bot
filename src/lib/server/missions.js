/**
 * Missions, série et récompenses de kyara.games.
 *
 * Tout se pilote depuis deux endpoints :
 *   GET  /api/me/progress        → état des quêtes (calculé par le serveur)
 *   POST /api/me/progress/claim  → { kind } ou { kind, id }
 *
 * Les quêtes ne se « valident » pas depuis le client : il faut reproduire
 * l'action réelle (consulter une fiche, mettre en vente, recycler), puis
 * réclamer. `kind` vaut `all` (tout réclamer), `streak` (série de connexion)
 * ou le nom d'une famille + `id` (`daily`, `weekly`, `welcome`, `achievement`,
 * `series`).
 */
import { save } from './state.js';

const MIN = 60_000;

/** Un même compte ne relit `/me/progress` qu'une fois par quart d'heure. */
export const MISSIONS_COOLDOWN = 15 * MIN;

const RARITY_ORDER = ['C', 'U', 'R', 'E', 'L', 'M'];
/** Raretés qu'on accepte de vendre / recycler (jamais Épique ou mieux). */
export const SELLABLE_RARITIES = ['C', 'U', 'R'];
const DEFAULT_MAX_RARITY = 'R';

/** Durée d'une annonce, en heures (valeur constatée sur le marché). */
const LISTING_HOURS = 12;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => min + Math.random() * (max - min);

const dayOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function questIn(list, id) {
	return (Array.isArray(list) ? list : []).find((m) => m?.id === id) ?? null;
}

/** Combien d'actions il reste à faire pour valider une quête. */
function remaining(quest) {
	if (!quest || quest.done || quest.claimed) return 0;
	return Math.max(0, (quest.target ?? 0) - (quest.progress ?? 0));
}

export function canSellRarity(rarity, max = DEFAULT_MAX_RARITY) {
	const cap = RARITY_ORDER.indexOf(max);
	const idx = RARITY_ORDER.indexOf(rarity);
	// Rareté inconnue : on s'abstient. Plafond inconnu : on retombe sur « Rare ».
	if (idx < 0) return false;
	return idx <= (cap < 0 ? RARITY_ORDER.indexOf(DEFAULT_MAX_RARITY) : cap);
}

/** `/me/collection` complet : qty, listable, resaleLocked et prix médians. */
async function loadCollection(client) {
	const col = await client.call('/me/collection');
	return Array.isArray(col) ? col : [];
}

/**
 * Rareté d'un perso. On interroge la fiche publique plutôt que de télécharger
 * le catalogue entier (1,7 Mo pour 6 736 persos).
 */
async function rarityOf(client, id) {
	const c = await client.call(`/characters/${id}`);
	return c?.rarity ?? c?.character?.rarity ?? null;
}

/** Doublons recyclables : au moins deux exemplaires, au moins un disponible. */
function duplicateCandidates(collection) {
	return collection
		.filter((c) => Number(c.qty ?? 0) >= 2 && Number(c.listable ?? 0) > 0 && !c.resaleLocked)
		.sort((a, b) => Number(b.qty ?? 0) - Number(a.qty ?? 0) || Number(a.characterId) - Number(b.characterId));
}

/* ------------------------------------------------------------------ */
/* Actions de quête                                                    */
/* ------------------------------------------------------------------ */

/**
 * `details-3` : consulter N fiches. Le serveur compte les fiches distinctes,
 * donc on mémorise celles déjà ouvertes pour la période en cours.
 */
async function viewFiches(client, acct, count, collection, period) {
	const ids = collection.map((c) => c.characterId).filter((id) => id != null);
	if (!ids.length) return 0;

	if (acct.bot.missionsPeriod !== period) {
		acct.bot.missionsPeriod = period;
		acct.bot.missionsViewed = [];
	}
	const seen = new Set(acct.bot.missionsViewed ?? []);
	const picks = ids.filter((id) => !seen.has(id)).slice(0, count);

	let viewed = 0;
	for (const id of picks) {
		try {
			await client.call(`/characters/${id}/detail`);
			seen.add(id);
			viewed += 1;
			if (viewed < picks.length) {
				await sleep(acct.settings.humanDelay === false ? 0 : rand(1200, 3800));
			}
		} catch {
			/* fiche illisible : on tente la suivante au prochain passage */
		}
	}

	acct.bot.missionsViewed = [...seen].slice(-300);
	return viewed;
}

/** `wishlist-3` : ajouter des persos à la wishlist (PUT = ajout). */
async function addWishes(client, acct, count, collection) {
	const wish = await client.call('/me/wishlist').catch(() => []);
	const have = new Set(
		(Array.isArray(wish) ? wish : (wish?.wishlist ?? [])).map((w) => w?.characterId ?? w?.id ?? w)
	);
	const ids = [...new Set(collection.map((c) => c.characterId))].filter(
		(id) => id != null && !have.has(id)
	);

	let added = 0;
	for (const id of ids.slice(0, count)) {
		try {
			await client.call(`/me/wishlist/${id}`, { method: 'PUT' });
			added += 1;
			await sleep(acct.settings.humanDelay === false ? 0 : rand(600, 1600));
		} catch {
			/* ignoré : on réessaiera au prochain passage */
		}
	}
	return added;
}

/** `recycle-1` : recycler un exemplaire en trop (jamais au-dessus de la rareté max). */
async function recycleDuplicate(client, acct, collection, exclude) {
	const max = acct.settings.sellMaxRarity ?? DEFAULT_MAX_RARITY;

	for (const card of duplicateCandidates(collection).slice(0, 8)) {
		if (exclude.has(card.characterId)) continue;
		const rarity = await rarityOf(client, card.characterId).catch(() => null);
		if (!canSellRarity(rarity, max)) continue;
		try {
			await client.call(`/me/collection/${card.characterId}/recycle`, {
				method: 'POST',
				body: { qty: 1 }
			});
			return { characterId: card.characterId, rarity };
		} catch {
			/* verrouillée, déjà recyclée… : candidat suivant */
		}
	}
	return null;
}

/**
 * Prix de l'annonce : le moins cher du marché (ventes immédiates uniquement),
 * sinon la médiane 7 jours, sinon le prix de repli des réglages.
 */
function bestPrice(items, card, floor) {
	const cheapest = (items ?? [])
		.filter((l) => l?.type === 'fixed' && !l.isMine && Number.isFinite(l.price))
		.map((l) => l.price);
	if (cheapest.length) return Math.max(floor, Math.min(...cheapest) - 1);

	const median = card.prices?.median7d ?? card.prices?.median30d ?? null;
	if (Number.isFinite(median) && median > 0) return Math.max(floor, Math.floor(median));
	return floor;
}

/** `list-1` : mettre un doublon en vente à prix fixe. */
async function listDuplicate(client, acct, collection, exclude) {
	const max = acct.settings.sellMaxRarity ?? DEFAULT_MAX_RARITY;
	const floor = Math.max(1, Math.round(acct.settings.sellPrice ?? 1));

	for (const card of duplicateCandidates(collection).slice(0, 8)) {
		if (exclude.has(card.characterId)) continue;
		const rarity = await rarityOf(client, card.characterId).catch(() => null);
		if (!canSellRarity(rarity, max)) continue;

		let items = null;
		try {
			const market = await client.call(
				`/market/listings?characterId=${encodeURIComponent(card.characterId)}&sort=price_asc`
			);
			items = market?.items ?? [];
		} catch {
			/* marché illisible : on retombe sur la médiane */
		}

		// Une annonce à nous est déjà en ligne : inutile d'en empiler une de plus.
		if (Array.isArray(items) && items.some((l) => l?.isMine)) return null;

		const price = bestPrice(items, card, floor);
		try {
			await client.call('/market/listings', {
				method: 'POST',
				body: {
					characterId: card.characterId,
					type: 'fixed',
					price,
					buyoutPrice: null,
					durationHours: LISTING_HOURS
				}
			});
			acct.bot.missionsListed = [
				...(acct.bot.missionsListed ?? []).slice(-19),
				{ characterId: card.characterId, price, at: new Date().toISOString() }
			];
			return { characterId: card.characterId, rarity, price };
		} catch {
			/* prix sous le plancher du marché, accès restreint… : candidat suivant */
		}
	}
	return null;
}

/** Événement « tag » : réclame seulement si le serveur annonce quelque chose. */
async function claimTagEvent(client) {
	const res = await client.call('/me/tag-event');
	const me = res?.me ?? res ?? {};
	const claimable = Boolean(me.claimable ?? me.entry?.claimable ?? me.reward?.claimable);
	if (!claimable) return false;
	await client.call('/me/tag-event/claim', { method: 'POST' });
	return true;
}

/* ------------------------------------------------------------------ */
/* Passage complet                                                     */
/* ------------------------------------------------------------------ */

/**
 * Déroule un passage de missions pour un compte.
 *
 * @param {{ call: (path: string, opts?: object) => Promise<any> }} client
 * @param {object} acct
 * @param {{ now?: number, force?: boolean }} [options]
 * @returns {Promise<null | { chakra: number, claimed: number, actions: string[], warnings: string[], error: string | null }>}
 */
export async function runMissions(client, acct, { now = Date.now(), force = false } = {}) {
	if (!acct?.token) return null;
	const settings = acct.settings ?? {};
	if (settings.missions === false) return null;

	// La réserve pleine réveille le bot toutes les minutes : on garde un plancher.
	const last = Date.parse(acct.bot.lastMissionsAt ?? '');
	if (!force && Number.isFinite(last) && now - last < MISSIONS_COOLDOWN) return null;

	const result = { chakra: 0, claimed: 0, actions: [], warnings: [], error: null };

	try {
		acct.bot.lastMissionsAt = new Date(now).toISOString();
		save();

		let progress = await client.call('/me/progress');

		// --- Quêtes à action (aucune récompense réclamée à ce stade) ---------
		let collection = null;
		const loadCollectionOnce = async () => (collection ??= await loadCollection(client));
		const period = progress?.daily?.period ?? dayOf(now);
		const used = new Set();

		const viewLeft = remaining(questIn(progress?.daily?.missions, 'details-3'));
		if (viewLeft > 0) {
			const n = await viewFiches(client, acct, viewLeft, await loadCollectionOnce(), period);
			if (n) result.actions.push(`${n} fiche(s) consultée(s)`);
		}

		if (remaining(questIn(progress?.welcome?.quests, 'wishlist-3')) > 0) {
			const n = await addWishes(
				client,
				acct,
				remaining(questIn(progress?.welcome?.quests, 'wishlist-3')),
				await loadCollectionOnce()
			);
			if (n) result.actions.push(`${n} perso(s) en wishlist`);
		}

		if (settings.missionsMarket !== false) {
			if (remaining(questIn(progress?.welcome?.quests, 'recycle-1')) > 0) {
				const done = await recycleDuplicate(client, acct, await loadCollectionOnce(), used);
				if (done) {
					used.add(done.characterId);
					result.actions.push(`doublon recyclé (${done.rarity})`);
				} else {
					result.warnings.push('recycle-1 · aucun doublon recyclable');
				}
			}

			if (remaining(questIn(progress?.daily?.missions, 'list-1')) > 0) {
				const done = await listDuplicate(client, acct, await loadCollectionOnce(), used);
				if (done) {
					used.add(done.characterId);
					result.actions.push(`vente ${done.price} ◆ (${done.rarity})`);
				} else {
					result.warnings.push('list-1 · aucune carte à mettre en vente');
				}
			}
		}

		if (settings.missionsEvents !== false) {
			try {
				if (await claimTagEvent(client)) result.actions.push('événement tag');
			} catch (e) {
				result.warnings.push(`events · ${e?.message ?? e}`);
			}
		}

		// --- Récompenses -----------------------------------------------------
		progress = await client.call('/me/progress').catch(() => progress);

		if (progress?.streak && progress.streak.claimedToday === false) {
			try {
				await client.call('/me/progress/claim', { method: 'POST', body: { kind: 'streak' } });
				result.actions.push('série réclamée');
			} catch (e) {
				result.warnings.push(`série · ${e?.message ?? e}`);
			}
		}

		if (Number(progress?.claimable ?? 0) > 0) {
			const pending = Number(progress.claimable);
			try {
				const res = await client.call('/me/progress/claim', {
					method: 'POST',
					body: { kind: 'all' }
				});
				result.claimed = pending;
				result.chakra = Number(res?.gained?.chakra ?? 0);
				if (res?.user?.chakra != null && acct.account) acct.account.chakra = res.user.chakra;
			} catch (e) {
				result.warnings.push(`récompenses · ${e?.message ?? e}`);
			}
		}
	} catch (e) {
		result.error = e?.message ?? String(e);
	} finally {
		save();
	}

	return result;
}
