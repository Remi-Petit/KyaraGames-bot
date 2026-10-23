import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, freshStore, makeEvent } from '../helpers.js';

const dirs = [];

afterEach(() => {
	dirs.forEach(cleanup);
	dirs.length = 0;
});

async function setup() {
	const s = await freshStore();
	dirs.push(s.dir);
	const routes = {
		users: await import('../../src/routes/api/users/+server.js'),
		userById: await import('../../src/routes/api/users/[id]/+server.js')
	};
	const admin = s.session.createUser({ username: 'alice', password: 'motdepasse1' }).user;
	const member = s.session.createUser({ username: 'bob', password: 'motdepasse2' }).user;
	return { ...s, routes, admin, member };
}

async function caught(fn) {
	try {
		await fn();
		return null;
	} catch (e) {
		return e;
	}
}

describe('réglages de notifications', () => {
	it('l’admin règle le ntfy d’un utilisateur, jeton chiffré', async () => {
		const { routes, state, crypto, admin, member } = await setup();

		const res = await routes.userById.PATCH(
			makeEvent({
				user: admin,
				params: { id: member.id },
				body: {
					notify: { enabled: true, url: 'https://ntfy.example.com', topic: 'kyara-bob', token: 'secret' }
				}
			})
		);
		const body = await res.json();

		expect(body.user.notify).toMatchObject({
			enabled: true,
			url: 'https://ntfy.example.com',
			topic: 'kyara-bob',
			tokenSet: true
		});
		expect(JSON.stringify(body)).not.toContain('secret');

		const stored = state.db.users.find((u) => u.id === member.id).notify;
		expect(stored.token).not.toBe('secret');
		expect(crypto.unseal(stored.token)).toBe('secret');
	});

	it('la liste des utilisateurs ne contient jamais le jeton', async () => {
		const { routes, admin, member } = await setup();
		await routes.userById.PATCH(
			makeEvent({
				user: admin,
				params: { id: member.id },
				body: { notify: { enabled: true, topic: 't', token: 'secret' } }
			})
		);

		const res = routes.users.GET(makeEvent({ user: admin, method: 'GET' }));
		const text = await res.text();
		expect(text).not.toContain('secret');
		expect(JSON.parse(text).users[1].notify.tokenSet).toBe(true);
	});

	it('un membre ne peut pas toucher aux notifications', async () => {
		const { routes, member } = await setup();

		const e = await caught(() =>
			routes.userById.PATCH(
				makeEvent({
					user: member,
					params: { id: member.id },
					body: { notify: { enabled: true, topic: 'x' } }
				})
			)
		);
		expect(e?.status).toBe(403);
	});

	it('le jeton vide laisse la valeur en place, null l’efface', async () => {
		const { routes, state, admin, member } = await setup();
		const patch = (notify) =>
			routes.userById.PATCH(
				makeEvent({ user: admin, params: { id: member.id }, body: { notify } })
			);

		await patch({ enabled: true, topic: 't', token: 'secret' });
		await patch({ topic: 't2', token: '' });
		expect(state.db.users.find((u) => u.id === member.id).notify.token).toBeTruthy();

		await patch({ token: null });
		expect(state.db.users.find((u) => u.id === member.id).notify.token).toBeNull();
	});
});

describe('notification de test', () => {
	it('envoie sur le topic configuré', async () => {
		const { routes, admin, member } = await setup();
		await routes.userById.PATCH(
			makeEvent({
				user: admin,
				params: { id: member.id },
				body: { notify: { enabled: true, url: 'https://ntfy.example.com', topic: 'kyara-bob' } }
			})
		);

		const sent = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			sent.push({ url: String(url), init });
			return new Response('ok', { status: 200 });
		});

		const res = await routes.userById.POST(
			makeEvent({ user: admin, params: { id: member.id }, method: 'POST' })
		);
		expect(res.status).toBe(200);
		expect(sent[0].url).toBe('https://ntfy.example.com/kyara-bob');
		expect(sent[0].init.headers.Title).toBe('Kyara - test');
	});

	it('refuse quand le topic manque', async () => {
		const { routes, admin, member } = await setup();
		const e = await caught(() =>
			routes.userById.POST(makeEvent({ user: admin, params: { id: member.id }, method: 'POST' }))
		);
		expect(e?.status).toBe(400);
	});
});
