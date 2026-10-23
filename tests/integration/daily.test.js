import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, freshStore } from '../helpers.js';

const dirs = [];

afterEach(() => {
	dirs.forEach(cleanup);
	dirs.length = 0;
});

/** Un compte nu + un Runner dont le client Kyara est remplaçable. */
async function setup() {
	const s = await freshStore({
		seed: {
			version: 3,
			users: [],
			meta: { regenMs: 600_000, freePacksMax: 10, packs: [] },
			accounts: [{ id: 'k1', token: 'sealed', account: { pseudo: 'Test' } }]
		}
	});
	dirs.push(s.dir);

	const bot = await import('../../src/lib/server/bot.js');
	const runner = new bot.Runner('k1');
	const acct = s.state.findAccount('k1');

	const calls = [];
	runner.client = {
		packState: async () => ({ day: '2026-10-23', limits: { daily: { used: 0, perDay: 1, left: 1 } } }),
		openPack: async (id) => {
			calls.push(id);
			return { cards: [{ name: 'Carte', rarity: 'R' }] };
		}
	};

	return { ...s, runner, acct, calls };
}

describe('pack du jour', () => {
	it('l’ouvre quand il reste une ouverture, et le journalise une fois', async () => {
		const { runner, acct, calls } = await setup();

		await runner.openDaily(acct);

		expect(calls).toEqual(['daily']);
		expect(acct.daily).toMatchObject({ day: '2026-10-23', left: 0 });
		expect(acct.opens[0]).toMatchObject({ packId: 'daily', kind: 'daily' });
		expect(acct.logs.filter((l) => /Pack du jour/.test(l.message))).toHaveLength(1);
	});

	it('signale « déjà pris » une seule fois par jour', async () => {
		const { runner, acct, calls } = await setup();
		runner.client.packState = async () => ({
			day: '2026-10-23',
			limits: { daily: { used: 1, perDay: 1, left: 0 } }
		});

		await runner.openDaily(acct);
		await runner.openDaily(acct);
		await runner.openDaily(acct);

		expect(calls).toEqual([]);
		expect(acct.logs.filter((l) => /déjà pris/.test(l.message))).toHaveLength(1);
		expect(acct.daily).toMatchObject({ day: '2026-10-23', left: 0 });
	});

	it('ne fait rien quand le réglage est désactivé', async () => {
		const { runner, acct, calls } = await setup();
		acct.settings.dailyPack = false;

		await runner.openDaily(acct);

		expect(calls).toEqual([]);
		expect(acct.daily).toBeNull();
		expect(acct.logs).toHaveLength(0);
	});

	it('ignore un « déjà réclamé » renvoyé par l’API sans crier', async () => {
		const { runner, acct } = await setup();
		const { KyaraError } = await import('../../src/lib/server/kyara.js');
		runner.client.openPack = async () => {
			throw new KyaraError(400, 'already_claimed', 'déjà pris');
		};

		await runner.openDaily(acct);

		expect(acct.logs.filter((l) => l.level === 'warn')).toHaveLength(0);
	});

	it('journalise un avertissement pour une vraie erreur', async () => {
		const { runner, acct } = await setup();
		runner.client.packState = async () => {
			throw new Error('réseau');
		};

		await runner.openDaily(acct);

		expect(acct.logs[0].message).toMatch(/Pack du jour : réseau/);
	});

	it('un relevé (sync) rafraîchit l’état du pack du jour sans rien ouvrir', async () => {
		const { runner, acct, calls } = await setup();
		runner.client.me = async () => ({ id: 'x', pseudo: 'Test', freePacks: 2, freePacksMax: 10 });

		await runner.sync();

		expect(calls).toEqual([]);
		expect(acct.daily).toMatchObject({ day: '2026-10-23', left: 1 });
		expect(acct.account).toMatchObject({ pseudo: 'Test', freePacks: 2 });
	});
});
