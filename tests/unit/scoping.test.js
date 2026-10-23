import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, freshStore } from '../helpers.js';

const dirs = [];

afterEach(() => {
	dirs.forEach(cleanup);
	dirs.length = 0;
});

async function store(options) {
	const loaded = await freshStore(options);
	dirs.push(loaded.dir);
	return loaded;
}

async function withUsers() {
	const s = await store({});
	const admin = s.session.createUser({ username: 'alice', password: 'motdepasse1' }).user;
	const member = s.session.createUser({ username: 'bob', password: 'motdepasse2' }).user;

	s.state.upsertAccount({ id: 'a1', ownerId: admin.id, token: 'x', account: { pseudo: 'AliceK' } });
	s.state.upsertAccount({ id: 'a2', ownerId: member.id, token: 'y', account: { pseudo: 'BobK' } });

	return { ...s, admin, member };
}

describe('cloisonnement des comptes Kyara', () => {
	it('un membre ne voit que ses comptes, l’admin voit tout', async () => {
		const { state, admin, member } = await withUsers();

		expect(state.visibleAccounts(admin).map((a) => a.id).sort()).toEqual(['a1', 'a2']);
		expect(state.visibleAccounts(member).map((a) => a.id)).toEqual(['a2']);
	});

	it('sans utilisateur (mode ouvert), tout est visible', async () => {
		const { state } = await withUsers();
		expect(state.visibleAccounts(null)).toHaveLength(2);
		expect(state.canAccess(null, state.findAccount('a1'))).toBe(true);
	});

	it('canAccess refuse un compte étranger à un membre', async () => {
		const { state, admin, member } = await withUsers();

		expect(state.canAccess(member, state.findAccount('a1'))).toBe(false);
		expect(state.canAccess(member, state.findAccount('a2'))).toBe(true);
		expect(state.canAccess(admin, state.findAccount('a1'))).toBe(true);
	});

	it('demander un compte interdit retombe sur son propre compte', async () => {
		const { state, member } = await withUsers();

		const view = state.snapshot('a1', member);
		expect(view.selected.id).toBe('a2');
		expect(view.accounts).toHaveLength(1);
	});

	it('expose le propriétaire mais jamais le token', async () => {
		const { state, admin } = await withUsers();

		const view = state.snapshot('a2', admin);
		expect(view.selected.owner).toBe('bob');
		expect(JSON.stringify(view)).not.toContain('"y"');
		expect(view.selected).not.toHaveProperty('token');
	});
});

describe('modèle de compte', () => {
	it('applique les valeurs par défaut', async () => {
		const { state } = await store({});
		const account = state.normalizeAccount({ id: 'x' });

		expect(account.bot.running).toBe(true);
		expect(account.settings.pollMinutes).toBe(90);
		expect(account.settings.maxPerRun).toBe(10);
		expect(account.stats.byRarity).toEqual({ C: 0, U: 0, R: 0, E: 0, L: 0, M: 0 });
		expect(account.ownerId).toBeNull();
		expect(account.opens).toEqual([]);
		expect(account.logs).toEqual([]);
	});
});
