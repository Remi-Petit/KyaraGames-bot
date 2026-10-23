import crypto from 'node:crypto';
import { KYARA_BASE } from './config.js';
import { state } from './state.js';
import { unseal } from './crypto.js';

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

let passCache = { value: null, expiresAt: 0 };

export function token() {
	return unseal(state.token);
}

async function raw(pathname, { method = 'GET', body, extraHeaders, tokenOverride } = {}) {
	const t = tokenOverride ?? token();
	const headers = { accept: 'application/json', ...(extraHeaders || {}) };
	if (t) headers.authorization = `Bearer ${t}`;
	if (body !== undefined) headers['content-type'] = 'application/json';

	let res;
	try {
		res = await fetch(KYARA_BASE + pathname, {
			method,
			headers,
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

/** Pass "anti-bot" (header x-pass), valide ~30 min. */
export async function getPass(force = false) {
	const now = Date.now();
	if (!force && passCache.value && passCache.expiresAt - now > 60_000) return passCache.value;
	const r = await raw('/auth/pass', { method: 'POST', body: {} });
	passCache = { value: r.pass, expiresAt: r.expiresAt };
	return r.pass;
}

/** Appel authentifié avec récupération automatique du pass et retry transitoire. */
export async function call(pathname, opts = {}) {
	let pass = opts.pass;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			return await raw(pathname, {
				...opts,
				extraHeaders: {
					...(pass ? { 'x-pass': pass } : {}),
					...(opts.requestId ? { 'x-request-id': opts.requestId } : {}),
					...(opts.extraHeaders || {})
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

export const api = {
	me: () => call('/me'),
	config: () => raw('/config'),
	packs: () => raw('/packs'),
	packState: () => call('/me/packs'),
	/**
	 * Ouvre un booster. `requestId` sert de clé d'idempotence côté serveur.
	 * @param {string} packId
	 */
	openPack: (packId) =>
		call(`/packs/${encodeURIComponent(packId)}/open`, {
			method: 'POST',
			body: {},
			requestId: crypto.randomUUID().replace(/-/g, '')
		})
};

/** Vérifie une clé collée par l'utilisateur. */
export async function validateToken(candidate) {
	return raw('/me', { tokenOverride: candidate });
}
