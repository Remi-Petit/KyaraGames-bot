import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, freshStore } from '../helpers.js';

const dirs = [];

afterEach(() => {
	dirs.forEach(cleanup);
	dirs.length = 0;
});

async function store(seed) {
	const loaded = await freshStore({ seed });
	dirs.push(loaded.dir);
	return loaded;
}

describe('migration du fichier d’état', () => {
	it('convertit un état mono-compte v1', async () => {
		const { state } = await store({
			version: 1,
			token: 'sealed-v1',
			tokenSetAt: '2026-01-01T00:00:00.000Z',
			tokenInvalid: false,
			account: { id: 'legacy', pseudo: 'Ancien' },
			bot: { running: false, lastPackId: 'shonen' },
			settings: { pollMinutes: 42 },
			stats: { opened: 3, byRarity: { M: 1 } },
			opens: [],
			logs: [{ at: '2026-01-01T00:00:00.000Z', level: 'info', message: 'coucou' }],
			meta: { regenMs: 1234 }
		});

		expect(state.db.version).toBe(3);
		expect(state.db.users).toEqual([]);
		expect(state.db.accounts).toHaveLength(1);

		const account = state.db.accounts[0];
		expect(account.id).toBe('legacy');
		expect(account.token).toBe('sealed-v1');
		expect(account.ownerId).toBeNull();
		expect(account.bot.running).toBe(false);
		expect(account.settings.pollMinutes).toBe(42);
		expect(account.stats.opened).toBe(3);
		expect(account.stats.byRarity.M).toBe(1);
		expect(state.db.meta.regenMs).toBe(1234);
	});

	it('complète un état v2 avec les utilisateurs et le propriétaire', async () => {
		const { state } = await store({
			version: 2,
			meta: { regenMs: 600120, packs: [] },
			accounts: [
				{ id: 'a1', token: 's', bot: {}, settings: {}, stats: {} },
				{ id: 'a2', token: 't', bot: {}, settings: {}, stats: {} }
			]
		});

		expect(state.db.version).toBe(3);
		expect(state.db.users).toEqual([]);
		expect(state.db.accounts.map((a) => a.id)).toEqual(['a1', 'a2']);
		expect(state.db.accounts.every((a) => a.ownerId === null)).toBe(true);
		expect(state.db.accounts[0].bot.running).toBe(true);
		expect(state.db.meta.regenMs).toBe(600120);
	});

	it('repart d’un état vide si le fichier est corrompu', async () => {
		const loaded = await freshStore();
		dirs.push(loaded.dir);

		const fs = await import('node:fs');
		const path = await import('node:path');
		fs.writeFileSync(path.join(loaded.dir, 'state.json'), '{ pas du json');
		loaded.state.flush();

		expect(loaded.state.db.accounts).toEqual([]);
	});
});
