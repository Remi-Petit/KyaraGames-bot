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

describe('amorçage de l’administrateur', () => {
	it('crée l’admin au premier login et réclame les comptes orphelins', async () => {
		const s = await store({ password: 'supersecret' });
		s.state.upsertAccount({ id: 'k1', token: 'sealed', account: { pseudo: 'Ancien' } });

		expect(s.session.authMode()).toBe('users');

		const admin = s.session.login('admin', 'supersecret');
		expect(admin).toBeTruthy();
		expect(admin.role).toBe('admin');
		expect(s.state.findAccount('k1').ownerId).toBe(admin.id);
	});

	it('refuse un mauvais mot de passe d’amorçage sans créer d’utilisateur', async () => {
		const s = await store({ password: 'supersecret' });

		expect(s.session.login('admin', 'nope')).toBeNull();
		expect(s.state.db.users).toHaveLength(0);
	});

	it('reste en mode ouvert sans utilisateur ni mot de passe', async () => {
		const s = await store({});

		expect(s.session.authMode()).toBe('open');
		expect(s.session.currentUser(undefined)).toBeNull();
	});
});

describe('sessions', () => {
	it('accepte un cookie valide et refuse toute altération', async () => {
		const s = await store({ password: 'supersecret' });
		const admin = s.session.login('admin', 'supersecret');

		const cookie = s.session.makeSessionCookie(admin);
		expect(s.session.currentUser(cookie).id).toBe(admin.id);

		const [id, version, exp, sig] = cookie.split('.');
		expect(s.session.currentUser([id, version, exp, 'f'.repeat(64)].join('.'))).toBeNull();
		expect(s.session.currentUser([id, '999', exp, sig].join('.'))).toBeNull();
		expect(s.session.currentUser([id, version, exp].join('.'))).toBeNull();
		expect(s.session.currentUser('n-importe-quoi')).toBeNull();
		expect(s.session.currentUser('')).toBeNull();
	});

	it('refuse un cookie expiré même correctement signé', async () => {
		const s = await store({ password: 'supersecret' });
		const admin = s.session.login('admin', 'supersecret');

		const secret = s.crypto.sessionSecret('supersecret');
		const expiredAt = Date.now() - 1000;
		const payload = `${admin.id}.${admin.version}.${expiredAt}`;
		const expired = `${payload}.${s.crypto.sign(payload, secret)}`;

		expect(s.session.currentUser(expired)).toBeNull();
	});

	it('changer le mot de passe invalide les sessions déjà ouvertes', async () => {
		const s = await store({ password: 'supersecret' });
		const admin = s.session.login('admin', 'supersecret');
		const cookie = s.session.makeSessionCookie(admin);

		const newPassword = s.session.setUserPassword(admin);

		expect(newPassword).toHaveLength(18);
		expect(s.session.currentUser(cookie)).toBeNull();
		expect(s.session.login('admin', newPassword)).toBeTruthy();
	});
});

describe('utilisateurs', () => {
	it('le premier est admin, les suivants membres, doublons refusés', async () => {
		const s = await store({});

		const first = s.session.createUser({ username: 'alice', password: 'motdepasse1' });
		expect(first.user.role).toBe('admin');

		const second = s.session.createUser({ username: 'bob' });
		expect(second.user.role).toBe('member');
		expect(second.password).toHaveLength(18);

		expect(() => s.session.createUser({ username: 'BOB' })).toThrow(/déjà/);
		expect(() => s.session.createUser({ username: 'ab' })).toThrow(/3 caractères/);
		expect(() => s.session.createUser({ username: 'carol', password: 'court' })).toThrow(
			/8 caractères/
		);
	});

	it('le rôle admin peut être demandé explicitement', async () => {
		const s = await store({});
		s.session.createUser({ username: 'alice', password: 'motdepasse1' });

		const second = s.session.createUser({ username: 'bob', role: 'admin' });
		expect(second.user.role).toBe('admin');
	});

	it('connexion : mot de passe correct, incorrect, nom inconnu, casse ignorée', async () => {
		const s = await store({});
		s.session.createUser({ username: 'alice', password: 'motdepasse1' });

		expect(s.session.login('alice', 'motdepasse1')?.username).toBe('alice');
		expect(s.session.login('ALICE', 'motdepasse1')?.username).toBe('alice');
		expect(s.session.login('alice', 'nope')).toBeNull();
		expect(s.session.login('inconnu', 'nope')).toBeNull();
	});

	it('ne stocke jamais le mot de passe en clair', async () => {
		const s = await store({});
		s.session.createUser({ username: 'alice', password: 'motdepasse1' });

		const user = s.state.db.users[0];
		expect(JSON.stringify(user)).not.toContain('motdepasse1');
		expect(user.hash).toHaveLength(128);
		expect(user.salt).toHaveLength(32);
	});
});
