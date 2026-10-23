import crypto from 'node:crypto';
import { KYARA_BASE } from './config.js';

export class KyaraError extends Error {
	constructor(status, code, message, body) {
		super(message || code || `HTTP ${status}`);
		this.name = 'KyaraError';
		this.status = status;
		this.code = code;
		this.body = body;
	}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Requête brute. `token` peut être null (endpoints publics). */
async function request(pathname, { token = null, method = 'GET', body, headers } = {}) {
	const finalHeaders = { accept: 'application/json', ...(headers || {}) };
	if (token) finalHeaders.authorization = `Bearer ${token}`;
	if (body !== undefined) finalHeaders['content-type'] = 'application/json';

	let res;
	try {
		res = await fetch(KYARA_BASE + pathname, {
			method,
			headers: finalHeaders,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(20_000)
		});
	} catch (e) {
		throw new KyaraError(0, 'network', `Serveur Kyara injoignable (${e.message})`);
	}

	const text = await res.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = null;
	}

	if (!res.ok) {
		throw new KyaraError(res.status, data?.error ?? `http_${res.status}`, data?.message, data);
	}
	return data;
}

/* ------------------------------------------------------------------ */
/* Endpoints publics (aucune authentification)                         */
/* ------------------------------------------------------------------ */

export const publicApi = {
	config: () => request('/config'),
	packs: () => request('/packs')
};

/** Vérifie une clé collée par l'utilisateur. */
export async function validateToken(candidate) {
	return request('/me', { token: candidate });
}

/* ------------------------------------------------------------------ */
/* Client authentifié                                                  */
/* ------------------------------------------------------------------ */

/**
 * Un client par compte : le cache du laissez-passer (x-pass) est propre au token,
 * donc deux comptes ne peuvent pas se marcher dessus.
 * @param {() => string | null} getToken
 */
export function createClient(getToken) {
	/** @type {{ token: string | null, value: string | null, expiresAt: number }} */
	let passCache = { token: null, value: null, expiresAt: 0 };

	async function raw(pathname, opts = {}) {
		return request(pathname, { ...opts, token: getToken() });
	}

	/** Pass "anti-bot" (header x-pass), valide ~30 min. */
	async function getPass(force = false) {
		const token = getToken();
		const now = Date.now();
		const stillValid =
			passCache.value && passCache.token === token && passCache.expiresAt - now > 60_000;
		if (!force && stillValid) return passCache.value;

		const r = await raw('/auth/pass', { method: 'POST', body: {} });
		passCache = { token, value: r.pass, expiresAt: r.expiresAt };
		return r.pass;
	}

	/** Appel authentifié avec récupération automatique du pass et retry transitoire. */
	async function call(pathname, opts = {}) {
		let pass = opts.pass;
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				return await raw(pathname, {
					method: opts.method ?? 'GET',
					body: opts.body,
					headers: {
						...(pass ? { 'x-pass': pass } : {}),
						...(opts.requestId ? { 'x-request-id': opts.requestId } : {}),
						...(opts.headers || {})
					}
				});
			} catch (e) {
				if (e instanceof KyaraError && e.code === 'pass_required') {
					pass = await getPass(true);
					continue;
				}
				if (e instanceof KyaraError && e.status === 503 && attempt < 2) {
					await sleep(1500);
					continue;
				}
				throw e;
			}
		}
		throw new KyaraError(0, 'retry_exhausted', 'Échec après plusieurs tentatives');
	}

	return {
		getPass,
		call,
		me: () => call('/me'),
		packState: () => call('/me/packs'),
		/**
		 * Ouvre un booster. `x-request-id` sert de clé d'idempotence côté serveur.
		 * @param {string} packId
		 */
		openPack: (packId) =>
			call(`/packs/${encodeURIComponent(packId)}/open`, {
				method: 'POST',
				body: {},
				requestId: crypto.randomUUID().replace(/-/g, '')
			})
	};
}
