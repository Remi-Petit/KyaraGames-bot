import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, freshStore, makeEvent, stubKyaraMe } from '../helpers.js';

const dirs = [];

beforeEach(() => {
	// Évite que le tick déclenché par `onTokenSaved` (setTimeout 800 ms) ne parte
	// pendant les tests.
	vi.useFakeTimers();
});

afterEach(() => {
	dirs.forEach(cleanup);
	dirs.length = 0;
	vi.useRealTimers();
});

/** Charge un store + les handlers de routes dans la même génération de modules. */
async function setup(options = {}) {
	const s = await freshStore(options);
	dirs.push(s.dir);

	const routes = {
		token: await import('../../src/routes/api/token/+server.js'),
		control: await import('../../src/routes/api/control/+server.js'),
		state: await import('../../src/routes/api/state/+server.js'),
		users: await import('../../src/routes/api/users/+server.js'),
		userById: await import('../../src/routes/api/users/[id]/+server.js')
	};

	return { ...s, routes };
}

async function twoUsers() {
	const s = await setup();
	const admin = s.session.createUser({ username: 'alice', password: 'motdepasse1' }).user;
	const member = s.session.createUser({ username: 'bob', password: 'motdepasse2' }).user;

	s.state.upsertAccount({
		id: 'k-admin',
		ownerId: admin.id,
		token: 'sealed-a',
		account: { pseudo: 'AliceK' }
	});
	s.state.upsertAccount({
		id: 'k-bob',
		ownerId: member.id,
		token: 'sealed-b',
		account: { pseudo: 'BobK' }
	});

	return { ...s, admin, member };
}

/** Vérifie qu'un handler lève bien une HttpError du statut attendu (sync ou async). */
async function expectStatus(handlerOrPromise, status) {
	let caught = null;
	try {
		await (typeof handlerOrPromise === 'function' ? handlerOrPromise() : handlerOrPromise);
	} catch (e) {
		caught = e;
	}
	expect(caught, 'le handler aurait dû refuser').toBeTruthy();
	expect(caught.status).toBe(status);
}

describe('POST /api/token', () => {
	it('refuse d’écraser un compte appartenant à quelqu’un d’autre', async () => {
		const { routes, member } = await twoUsers();
		stubKyaraMe({ id: 'k-admin' });

		await expectStatus(
			routes.token.POST(makeEvent({ user: member, body: { token: 't'.repeat(32) } })),
			403
		);
	});

	it('crée un compte rattaché à l’utilisateur courant', async () => {
		const { routes, member, state } = await twoUsers();
		stubKyaraMe({ id: 'k-new', pseudo: 'Nouveau' });

		const response = await routes.token.POST(
			makeEvent({ user: member, body: { token: 'n'.repeat(32) } })
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.selected.id).toBe('k-new');
		expect(body.selected.owner).toBe('bob');
		expect(state.findAccount('k-new').ownerId).toBe(member.id);
	});

	it('applique le plafond par utilisateur et pas globalement', async () => {
		const { routes, member, state } = await twoUsers();

		for (let i = 0; i < 9; i++) {
			state.upsertAccount({ id: `m${i}`, ownerId: member.id, token: 'x' });
		}

		stubKyaraMe({ id: 'k-new' });
		await expectStatus(
			routes.token.POST(makeEvent({ user: member, body: { token: 'n'.repeat(32) } })),
			400
		);
	});

	it('refuse un token mal formé sans appeler Kyara', async () => {
		const { routes, member } = await twoUsers();
		const me = stubKyaraMe({ id: 'k-new' });
		expect(me.id).toBe('k-new');

		await expectStatus(
			routes.token.POST(makeEvent({ user: member, body: { token: 'court' } })),
			400
		);
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('refuse un 401 renvoyé par Kyara', async () => {
		const { routes, member } = await twoUsers();
		globalThis.fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ error: 'unauthorized' }), {
					status: 401,
					headers: { 'content-type': 'application/json' }
				})
		);

		await expectStatus(
			routes.token.POST(makeEvent({ user: member, body: { token: 'z'.repeat(32) } })),
			401
		);
	});
});

describe('DELETE /api/token', () => {
	it('refuse le compte d’un autre utilisateur', async () => {
		const { routes, member } = await twoUsers();

		await expectStatus(
			routes.token.DELETE(makeEvent({ user: member, body: { accountId: 'k-admin' } })),
			403
		);
	});

	it('supprime son propre compte', async () => {
		const { routes, member, state } = await twoUsers();

		const response = await routes.token.DELETE(
			makeEvent({ user: member, body: { accountId: 'k-bob' } })
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(state.findAccount('k-bob')).toBeNull();
		// Le membre ne voit que ses comptes : il n'en a plus aucun.
		expect(body.accounts).toEqual([]);
		// Le compte de l'admin n'a pas été touché.
		expect(state.findAccount('k-admin')).toBeTruthy();
	});
});

describe('POST /api/control', () => {
	it('refuse une action sur le compte d’un autre', async () => {
		const { routes, member } = await twoUsers();

		await expectStatus(
			routes.control.POST(
				makeEvent({ user: member, body: { action: 'pause', accountId: 'k-admin' } })
			),
			403
		);
	});

	it('accepte une action sur son propre compte', async () => {
		const { routes, member } = await twoUsers();

		const response = await routes.control.POST(
			makeEvent({ user: member, body: { action: 'pause', accountId: 'k-bob' } })
		);

		expect(response.status).toBe(200);
		expect((await response.json()).selected.bot.running).toBe(false);
	});
});

describe('GET /api/state', () => {
	it('ne renvoie que les comptes du membre', async () => {
		const { routes, member } = await twoUsers();

		const response = routes.state.GET(
			makeEvent({ user: member, url: 'http://localhost/api/state' })
		);
		const body = await response.json();

		expect(body.accounts.map((a) => a.id)).toEqual(['k-bob']);
		expect(JSON.stringify(body)).not.toContain('sealed-a');
	});

	it('expose tous les comptes à l’administrateur', async () => {
		const { routes, admin } = await twoUsers();

		const response = routes.state.GET(
			makeEvent({ user: admin, url: 'http://localhost/api/state' })
		);
		const body = await response.json();

		expect(body.accounts.map((a) => a.id).sort()).toEqual(['k-admin', 'k-bob']);
	});
});

describe('gestion des utilisateurs', () => {
	it('réserve la liste et la création à l’administrateur', async () => {
		const { routes, member } = await twoUsers();

		await expectStatus(() => routes.users.GET(makeEvent({ user: member })), 403);
		await expectStatus(
			routes.users.POST(makeEvent({ user: member, body: { username: 'carol' } })),
			403
		);
	});

	it('liste les utilisateurs pour l’administrateur, sans hash', async () => {
		const { routes, admin } = await twoUsers();

		const response = routes.users.GET(makeEvent({ user: admin }));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.users.map((u) => u.username)).toEqual(['alice', 'bob']);
		expect(JSON.stringify(body)).not.toContain('"hash"');
		expect(JSON.stringify(body)).not.toContain('"salt"');
	});

	it('crée le premier utilisateur en mode ouvert et ouvre sa session', async () => {
		const { routes, session } = await setup();

		const event = makeEvent({ body: { username: 'alice' } });
		const response = await routes.users.POST(event);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.user.role).toBe('admin');
		expect(body.loggedIn).toBe(true);
		expect(body.password).toHaveLength(18);

		const cookie = event.jar.get('kyara_session');
		expect(session.currentUser(cookie).username).toBe('alice');
	});

	it('refuse de supprimer son propre compte', async () => {
		const { routes, admin } = await twoUsers();

		await expectStatus(
			routes.userById.DELETE(makeEvent({ user: admin, params: { id: admin.id } })),
			400
		);
	});

	it('refuse de supprimer un utilisateur qui a des comptes Kyara', async () => {
		const { routes, admin, member, state } = await twoUsers();

		await expectStatus(
			routes.userById.DELETE(makeEvent({ user: admin, params: { id: member.id } })),
			400
		);
		expect(state.db.users.find((u) => u.id === member.id)).toBeTruthy();
	});

	it('supprime un utilisateur sans compte', async () => {
		const { routes, admin, session, state } = await twoUsers();
		const carol = session.createUser({ username: 'carol' }).user;

		const response = await routes.userById.DELETE(
			makeEvent({ user: admin, params: { id: carol.id } })
		);

		expect(response.status).toBe(200);
		expect(state.db.users.find((u) => u.id === carol.id)).toBeUndefined();
	});

	it('réinitialiser un mot de passe invalide la session en cours', async () => {
		const { routes, admin, member, session } = await twoUsers();
		const cookie = session.makeSessionCookie(member);
		expect(session.currentUser(cookie)).toBeTruthy();

		const response = await routes.userById.PATCH(
			makeEvent({ user: admin, params: { id: member.id }, body: { resetPassword: true } })
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.password).toHaveLength(18);
		expect(session.currentUser(cookie)).toBeNull();
	});
});
