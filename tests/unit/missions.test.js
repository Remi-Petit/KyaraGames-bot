import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dirs = [];

/** Module `missions.js` neuf, sur un dossier de données isolé (comme le reste des tests). */
async function load() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kyara-missions-'));
	dirs.push(dir);
	process.env.KYARA_DATA_DIR = dir;
	process.env.DASHBOARD_PASSWORD = '';
	vi.resetModules();
	const missions = await import('../../src/lib/server/missions.js');
	return missions;
}

function account(patch = {}) {
	const base = {
		token: 'jeton',
		settings: {
			humanDelay: false,
			missions: true,
			missionsMarket: true,
			missionsEvents: false,
			sellMaxRarity: 'R',
			sellPrice: 1
		},
		bot: {
			lastMissionsAt: null,
			missionsPeriod: null,
			missionsViewed: [],
			missionsListed: []
		},
		account: { chakra: 0 }
	};

	return {
		...base,
		...patch,
		settings: { ...base.settings, ...(patch.settings || {}) },
		bot: { ...base.bot, ...(patch.bot || {}) },
		account: { ...base.account, ...(patch.account || {}) }
	};
}

/** Client Kyara factice : enregistre les appels et sert les réponses d'un routeur. */
function client(router) {
	const calls = [];
	return {
		calls,
		async call(pathname, opts = {}) {
			calls.push({ path: pathname, method: opts.method ?? 'GET', body: opts.body });
			return (await router(pathname, opts)) ?? {};
		}
	};
}

const progress = (over = {}) => ({
	claimable: 0,
	welcome: { quests: [] },
	daily: { period: '2026-10-24', missions: [] },
	weekly: { period: '2026-10-19', missions: [] },
	streak: { claimedToday: true },
	...over
});

const quest = (id, over = {}) => ({ id, target: 1, progress: 0, done: false, claimed: false, ...over });

afterEach(() => {
	dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
	dirs.length = 0;
});

describe('raretés vendables', () => {
	let missions;

	beforeEach(async () => {
		missions = await load();
	});

	it('accepte Commune, Peu commune et Rare', () => {
		expect(missions.canSellRarity('C')).toBe(true);
		expect(missions.canSellRarity('U')).toBe(true);
		expect(missions.canSellRarity('R')).toBe(true);
	});

	it('refuse Épique et au-dessus, ainsi qu’une rareté inconnue', () => {
		expect(missions.canSellRarity('E')).toBe(false);
		expect(missions.canSellRarity('L')).toBe(false);
		expect(missions.canSellRarity('M')).toBe(false);
		expect(missions.canSellRarity(null)).toBe(false);
	});

	it('respecte un plafond plus strict', () => {
		expect(missions.canSellRarity('R', 'U')).toBe(false);
		expect(missions.canSellRarity('U', 'U')).toBe(true);
	});
});

describe('runMissions', () => {
	let missions;

	beforeEach(async () => {
		missions = await load();
	});

	it('ne fait rien quand l’option est coupée', async () => {
		const acct = account({ settings: { missions: false } });
		const kc = client(() => progress());
		expect(await missions.runMissions(kc, acct)).toBeNull();
		expect(kc.calls).toHaveLength(0);
	});

	it('respecte le plancher de 15 minutes entre deux passages', async () => {
		const acct = account({ bot: { lastMissionsAt: new Date().toISOString() } });
		const kc = client(() => progress());
		expect(await missions.runMissions(kc, acct)).toBeNull();
		expect(kc.calls).toHaveLength(0);
	});

	it('réclame la série puis toutes les récompenses en attente', async () => {
		const acct = account();
		const kc = client((pathname, opts) => {
			if (pathname === '/me/progress') {
				return progress({ claimable: 2, streak: { claimedToday: false } });
			}
			if (pathname === '/me/progress/claim') {
				const chakra = opts.body?.kind === 'streak' ? 20 : 45;
				return { gained: { chakra }, user: { chakra: 399 } };
			}
			return {};
		});

		const res = await missions.runMissions(kc, acct, { force: true });

		const claims = kc.calls.filter((c) => c.path === '/me/progress/claim');
		expect(claims.map((c) => c.body)).toEqual([{ kind: 'streak' }, { kind: 'all' }]);
		expect(res.claimed).toBe(2);
		expect(res.chakra).toBe(65); // série 20 + récompenses 45
		expect(acct.account.chakra).toBe(399);
	});

	it('ne réclame rien quand tout est déjà pris', async () => {
		const acct = account();
		const kc = client(() => progress());
		const res = await missions.runMissions(kc, acct, { force: true });
		expect(res.claimed).toBe(0);
		expect(kc.calls.filter((c) => c.path === '/me/progress/claim')).toHaveLength(0);
	});

	it('réclame quand même une quête que « all » aurait laissée de côté', async () => {
		const acct = account();
		let reads = 0;
		const kc = client((pathname, opts) => {
			if (pathname === '/me/progress') {
				reads += 1;
				// Au second relevé, le haut fait `sold-1` est terminé mais pas réclamé.
				return reads === 1
					? progress({ claimable: 1 })
					: progress({
							claimable: 1,
							achievements: [{ id: 'sold-1', done: true, claimed: false }]
						});
			}
			if (pathname === '/me/progress/claim') {
				const chakra = opts.body?.kind === 'all' ? 20 : 10;
				return { gained: { chakra }, user: { chakra: 500 } };
			}
			return {};
		});

		const res = await missions.runMissions(kc, acct, { force: true });

		const claims = kc.calls.filter((c) => c.path === '/me/progress/claim').map((c) => c.body);
		expect(claims).toEqual([{ kind: 'all' }, { kind: 'achievement', id: 'sold-1' }]);
		expect(res.claimed).toBe(2);
		expect(res.chakra).toBe(30);
		expect(acct.account.chakra).toBe(500);
	});

	it('consulte exactement le nombre de fiches manquantes, sans répéter les mêmes', async () => {
		const acct = account();
		const kc = client((pathname) => {
			if (pathname === '/me/progress') {
				return progress({
					daily: {
						period: '2026-10-24',
						missions: [quest('details-3', { target: 3, progress: 1 })]
					}
				});
			}
			if (pathname === '/me/collection') {
				return [
					{ characterId: 25, qty: 1, listable: 1 },
					{ characterId: 91, qty: 1, listable: 1 },
					{ characterId: 126, qty: 1, listable: 1 }
				];
			}
			if (pathname.startsWith('/characters/') && pathname.endsWith('/detail')) return null;
			return {};
		});

		await missions.runMissions(kc, acct, { force: true });
		const details = kc.calls.filter((c) => c.path.endsWith('/detail')).map((c) => c.path);
		expect(details).toEqual(['/characters/25/detail', '/characters/91/detail']);
		expect(acct.bot.missionsViewed).toEqual([25, 91]);
		expect(acct.bot.missionsPeriod).toBe('2026-10-24');
	});

	it('met un doublon en vente au prix le plus bas du marché, moins un', async () => {
		const acct = account();
		const kc = client((pathname) => {
			if (pathname === '/me/progress') {
				return progress({
					daily: { period: '2026-10-24', missions: [quest('list-1')] }
				});
			}
			if (pathname === '/me/collection') {
				return [{ characterId: 25, qty: 2, listable: 2, prices: { median7d: 7 } }];
			}
			if (pathname === '/characters/25') return { id: 25, rarity: 'U' };
			if (pathname.startsWith('/market/listings?')) {
				return {
					items: [
						{ type: 'auction', price: 1, isMine: false },
						{ type: 'fixed', price: 9, isMine: false }
					]
				};
			}
			return {};
		});

		const res = await missions.runMissions(kc, acct, { force: true });

		const listing = kc.calls.find((c) => c.path === '/market/listings');
		expect(listing.body).toEqual({
			characterId: 25,
			type: 'fixed',
			price: 8,
			buyoutPrice: null,
			durationHours: 12
		});
		expect(res.actions).toContain('vente 8 ◆ (U)');
		expect(acct.bot.missionsListed).toHaveLength(1);
	});

	it('n’empile pas une annonce quand une des nôtres est déjà en ligne', async () => {
		const acct = account();
		const kc = client((pathname) => {
			if (pathname === '/me/progress') {
				return progress({
					daily: { period: '2026-10-24', missions: [quest('list-1')] }
				});
			}
			if (pathname === '/me/collection') {
				return [{ characterId: 25, qty: 2, listable: 2, prices: { median7d: 7 } }];
			}
			if (pathname === '/characters/25') return { id: 25, rarity: 'U' };
			if (pathname.startsWith('/market/listings?')) {
				return { items: [{ type: 'fixed', price: 9, isMine: true }] };
			}
			return {};
		});

		await missions.runMissions(kc, acct, { force: true });
		expect(kc.calls.filter((c) => c.path === '/market/listings')).toHaveLength(0);
	});

	it('ne met jamais en vente une carte Épique ou mieux', async () => {
		const acct = account();
		const kc = client((pathname) => {
			if (pathname === '/me/progress') {
				return progress({
					daily: { period: '2026-10-24', missions: [quest('list-1')] }
				});
			}
			if (pathname === '/me/collection') {
				return [{ characterId: 25, qty: 2, listable: 2, prices: { median7d: 40 } }];
			}
			if (pathname === '/characters/25') return { id: 25, rarity: 'E' };
			return {};
		});

		await missions.runMissions(kc, acct, { force: true });
		expect(kc.calls.filter((c) => c.path === '/market/listings')).toHaveLength(0);
		expect(acct.bot.missionsListed).toEqual([]);
	});

	it('recycle un seul exemplaire en trop, et jamais au-dessus du plafond', async () => {
		const acct = account();
		const kc = client((pathname) => {
			if (pathname === '/me/progress') {
				return progress({ welcome: { quests: [quest('recycle-1')] } });
			}
			if (pathname === '/me/collection') {
				return [
					{ characterId: 25, qty: 3, listable: 3 },
					{ characterId: 91, qty: 2, listable: 2 }
				];
			}
			if (pathname === '/characters/25') return { id: 25, rarity: 'L' };
			if (pathname === '/characters/91') return { id: 91, rarity: 'C' };
			return {};
		});

		await missions.runMissions(kc, acct, { force: true });

		const recycle = kc.calls.filter((c) => c.path.endsWith('/recycle'));
		expect(recycle).toHaveLength(1);
		expect(recycle[0].path).toBe('/me/collection/91/recycle');
		expect(recycle[0].body).toEqual({ qty: 1 });
	});

	it('ajoute à la wishlist des persos non possédés, pris sur le marché', async () => {
		const acct = account();
		const kc = client((pathname) => {
			if (pathname === '/me/progress') {
				return progress({ welcome: { quests: [quest('wishlist-3', { target: 3 })] } });
			}
			if (pathname === '/me/collection') {
				return [{ characterId: 25 }, { characterId: 91 }];
			}
			if (pathname === '/me/wishlist') return [];
			if (pathname === '/market/listings?sort=newest') {
				return {
					items: [
						{ character: { id: 25 } },
						{ character: { id: 91 } },
						{ character: { id: 126 } },
						{ character: { id: 127 } },
						{ character: { id: 128 } }
					]
				};
			}
			return {};
		});

		await missions.runMissions(kc, acct, { force: true });

		const wishes = kc.calls.filter((c) => c.path.startsWith('/me/wishlist/'));
		expect(wishes.map((c) => c.path)).toEqual([
			'/me/wishlist/126',
			'/me/wishlist/127',
			'/me/wishlist/128'
		]);
		expect(wishes.every((c) => c.method === 'PUT')).toBe(true);
	});

	it('ne relance pas une action déjà validée', async () => {
		const acct = account();
		const kc = client((pathname) => {
			if (pathname === '/me/progress') {
				return progress({
					daily: {
						period: '2026-10-24',
						missions: [quest('details-3', { target: 3, progress: 3, done: true }), quest('list-1', { done: true })]
					}
				});
			}
			return {};
		});

		await missions.runMissions(kc, acct, { force: true });
		expect(kc.calls.map((c) => c.path)).toEqual(['/me/progress', '/me/progress']);
	});
});
