import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';

/**
 * Charge des modules tout neufs (state/session/crypto) sur un dossier de données
 * isolé. `vi.resetModules()` garantit que chaque test repart d'un singleton vide.
 */
export async function freshStore({ password = '', seed = null } = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kyara-test-'));
	process.env.KYARA_DATA_DIR = dir;
	process.env.DASHBOARD_PASSWORD = password;

	if (seed) fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(seed));

	vi.resetModules();

	// Importés dans la même génération de modules : ils partagent le même `db`.
	const state = await import('../src/lib/server/state.js');
	const session = await import('../src/lib/server/session.js');
	const crypto = await import('../src/lib/server/crypto.js');

	return { dir, state, session, crypto };
}

export function cleanup(dir) {
	fs.rmSync(dir, { recursive: true, force: true });
}

/** Faux RequestEvent minimal pour appeler directement les handlers de routes. */
export function makeEvent({
	user = null,
	body,
	method = 'POST',
	url = 'http://localhost/api/test',
	params = {}
} = {}) {
	const jar = new Map();

	const cookies = {
		get: (name) => jar.get(name),
		set: (name, value) => jar.set(name, value),
		delete: (name) => jar.delete(name),
		getAll: () => [...jar].map(([name, value]) => ({ name, value }))
	};

	const request = {
		method,
		json: async () => {
			if (body === undefined) throw new SyntaxError('corps vide');
			return body;
		}
	};

	return {
		locals: { user },
		params,
		url: new URL(url),
		cookies,
		request,
		jar
	};
}

/** Réponse JSON d'un handler. */
export async function readJson(response) {
	return { status: response.status, body: await response.json() };
}

/** Faux /api/me : renvoie un profil Kyara pour le token fourni. */
export function stubKyaraMe(profile = {}) {
	const me = {
		id: 'kyara-1',
		pseudo: 'Tester',
		discord: { id: 'd1', username: 'tester', avatar: null },
		chakra: 10,
		freePacks: 1,
		freePacksMax: 10,
		nextFreeAt: null,
		pity: 0,
		boostersOpened: 0,
		...profile
	};

	globalThis.fetch = vi.fn(async (input) => {
		const url = String(input);
		if (url.includes('/api/me')) {
			return new Response(JSON.stringify(me), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		return new Response(JSON.stringify({ error: 'unexpected' }), {
			status: 404,
			headers: { 'content-type': 'application/json' }
		});
	});

	return me;
}
