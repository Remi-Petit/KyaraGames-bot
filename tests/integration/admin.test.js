import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, freshStore, makeEvent } from '../helpers.js';

const dirs = [];

afterEach(() => {
	dirs.forEach(cleanup);
	dirs.length = 0;
});

async function setup(options = {}) {
	const s = await freshStore(options);
	dirs.push(s.dir);
	const [adminPage, layout] = await Promise.all([
		import('../../src/routes/admin/+page.server.js'),
		import('../../src/routes/+layout.server.js')
	]);
	return { ...s, adminPage, layout };
}

async function caught(fn) {
	try {
		return await fn();
	} catch (e) {
		return e;
	}
}

describe('GET /admin (chargement serveur)', () => {
	it('refuse un membre avec 403', async () => {
		const { adminPage, session } = await setup();
		session.createUser({ username: 'alice', password: 'motdepasse1' });
		const member = session.createUser({ username: 'bob', password: 'motdepasse2' }).user;

		const e = await caught(() => adminPage.load(makeEvent({ user: member, method: 'GET' })));
		expect(e?.status).toBe(403);
	});

	it('sert à l’administrateur la liste des utilisateurs et de tous les comptes', async () => {
		const { adminPage, session, state } = await setup();
		const admin = session.createUser({ username: 'alice', password: 'motdepasse1' }).user;
		const member = session.createUser({ username: 'bob', password: 'motdepasse2' }).user;

		state.upsertAccount({ id: 'k1', ownerId: admin.id, token: 'sealed-a', account: { pseudo: 'AliceK' } });
		state.upsertAccount({ id: 'k2', ownerId: member.id, token: 'sealed-b', account: { pseudo: 'BobK' } });

		const data = await adminPage.load(makeEvent({ user: admin, method: 'GET' }));

		expect(data.open).toBe(false);
		expect(data.users.map((u) => u.username)).toEqual(['alice', 'bob']);
		expect(data.users.find((u) => u.username === 'bob').accounts).toBe(1);
		expect(data.accounts.map((a) => a.owner)).toEqual(['alice', 'bob']);
	});

	it('reste accessible en mode ouvert, pour créer le premier compte', async () => {
		const { adminPage } = await setup();

		const data = await adminPage.load(makeEvent({ method: 'GET' }));

		expect(data.open).toBe(true);
		expect(data.users).toEqual([]);
		expect(data.accounts).toEqual([]);
	});
});

describe('+layout.server.js', () => {
	it('expose l’utilisateur courant et le mode d’authentification', async () => {
		const { layout, session } = await setup();
		const admin = session.createUser({ username: 'alice', password: 'motdepasse1' }).user;

		const data = layout.load(makeEvent({ user: admin, method: 'GET' }));

		expect(data.me).toMatchObject({ username: 'alice', role: 'admin' });
		expect(data.authMode).toBe('users');
	});

	it('renvoie me = null pour un visiteur non connecté', async () => {
		const { layout } = await setup();
		expect(layout.load(makeEvent({ method: 'GET' })).me).toBeNull();
	});
});
