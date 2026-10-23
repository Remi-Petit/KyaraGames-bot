import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, freshStore } from '../helpers.js';

const dirs = [];

afterEach(() => {
	dirs.forEach(cleanup);
	dirs.length = 0;
});

/** Un store avec un admin, un compte, et un fetch espionné. */
async function setup({ notify } = {}) {
	const s = await freshStore();
	dirs.push(s.dir);

	const admin = s.session.createUser({ username: 'alice', password: 'motdepasse1' }).user;
	const account = s.state.upsertAccount({
		id: 'k1',
		ownerId: admin.id,
		token: 'sealed',
		account: { pseudo: 'AliceK' }
	});

	const user = s.state.db.users.find((u) => u.id === admin.id);
	Object.assign(user.notify, {
		enabled: true,
		url: 'https://ntfy.example.com',
		topic: 'kyara-test',
		token: s.crypto.seal('jeton-ntfy'),
		onRare: true,
		onErrors: true,
		...notify
	});

	const sent = [];
	globalThis.fetch = vi.fn(async (url, init) => {
		sent.push({ url: String(url), init });
		return new Response('ok', { status: 200 });
	});

	const notifyMod = await import('../../src/lib/server/notify.js');
	notifyMod.resetNotifyCooldown();

	return { ...s, admin, account, user, sent, notifyMod };
}

const entry = (best) => ({
	at: new Date().toISOString(),
	packId: 'shonen',
	packName: 'Shōnen',
	kind: 'free',
	best,
	cards: [
		{ name: 'Naruto', rarity: best },
		{ name: 'Sasuke', rarity: 'C' }
	]
});

describe('notifications ntfy', () => {
	it('pousse un légendaire sur le topic configuré', async () => {
		const { account, sent, notifyMod } = await setup();

		expect(await notifyMod.notifyRare(account, entry('L'))).toBe(true);

		expect(sent).toHaveLength(1);
		expect(sent[0].url).toBe('https://ntfy.example.com/kyara-test');
		const headers = sent[0].init.headers;
		expect(headers.Authorization).toBe('Bearer jeton-ntfy');
		expect(headers.Title).toBe('Kyara - Legendaire');
		expect(headers.Title).toMatch(/^[\x20-\x7E]+$/); // en-tête ASCII
		expect(sent[0].init.body).toContain('Shōnen');
		expect(sent[0].init.body).toContain('Légendaire');
	});

	it('un mythique part en priorité max', async () => {
		const { account, sent, notifyMod } = await setup();
		await notifyMod.notifyRare(account, entry('M'));
		expect(sent[0].init.headers.Priority).toBe('5');
	});

	it('ne notifie pas une rareté banale', async () => {
		const { account, sent, notifyMod } = await setup();
		expect(await notifyMod.notifyRare(account, entry('E'))).toBe(false);
		expect(sent).toHaveLength(0);
	});

	it('respecte la case « légendaire ou mythique » décochée', async () => {
		const { account, sent, notifyMod } = await setup({ notify: { onRare: false } });
		expect(await notifyMod.notifyRare(account, entry('M'))).toBe(false);
		expect(sent).toHaveLength(0);
	});

	it('ne fait rien sans topic ou quand c’est désactivé', async () => {
		const a = await setup({ notify: { topic: '' } });
		expect(await a.notifyMod.notifyRare(a.account, entry('M'))).toBe(false);
		expect(a.sent).toHaveLength(0);

		const b = await setup({ notify: { enabled: false } });
		expect(await b.notifyMod.notifyRare(b.account, entry('M'))).toBe(false);
		expect(b.sent).toHaveLength(0);
	});

	it('tempère les erreurs répétées', async () => {
		const { account, sent, notifyMod } = await setup();

		expect(await notifyMod.notifyError(account, 'réseau')).toBe(true);
		expect(await notifyMod.notifyError(account, 'réseau')).toBe(false);

		expect(sent).toHaveLength(1);
		expect(sent[0].init.headers.Tags).toBe('warning');
	});

	it('échoue proprement si le serveur répond mal', async () => {
		const { account, notifyMod } = await setup();
		globalThis.fetch = vi.fn(async () => new Response('nope', { status: 403 }));

		expect(await notifyMod.notifyRare(account, entry('L'))).toBe(false);
	});
});

describe('en-têtes ntfy', () => {
	it('retire les accents du titre', async () => {
		const { asciiHeader } = await import('../../src/lib/server/ntfy.js');
		expect(asciiHeader('Kyara — Légendaire !')).toBe('Kyara - Legendaire !');
		expect(asciiHeader('Shōnen Mix')).toBe('Shonen Mix');
	});
});

describe('authentification ntfy', () => {
	const capture = async (options) => {
		const sent = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			sent.push({ url: String(url), init });
			return new Response('ok', { status: 200 });
		});
		const { sendNtfy } = await import('../../src/lib/server/ntfy.js');
		const res = await sendNtfy({ topic: 't', message: 'm', ...options });
		return { res, sent };
	};

	it('préfère le jeton (Bearer) s’il est fourni', async () => {
		const { sent } = await capture({ token: 'tk_abc', username: 'mia', password: 'secret' });
		expect(sent[0].init.headers.Authorization).toBe('Bearer tk_abc');
	});

	it('utilise identifiant + mot de passe en Basic sinon', async () => {
		const { sent } = await capture({ username: 'mia', password: 'secret' });
		expect(sent[0].init.headers.Authorization).toBe(
			`Basic ${Buffer.from('mia:secret').toString('base64')}`
		);
	});

	it('n’envoie aucun en-tête d’authentification sans identifiants', async () => {
		const { sent } = await capture({});
		expect(sent[0].init.headers.Authorization).toBeUndefined();
	});

	it('remonte le message d’erreur du serveur (403)', async () => {
		globalThis.fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ code: 40301, error: 'forbidden' }), { status: 403 })
		);
		const { sendNtfy } = await import('../../src/lib/server/ntfy.js');
		const res = await sendNtfy({ topic: 't', message: 'm' });

		expect(res).toMatchObject({ ok: false, status: 403 });
		expect(res.reason).toBe('HTTP 403 — forbidden');
	});
});
