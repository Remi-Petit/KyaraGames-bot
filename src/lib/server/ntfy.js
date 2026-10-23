/**
 * Transport ntfy (https://docs.ntfy.sh/publish/).
 *
 * Volontairement silencieux : une notification qui échoue ne doit jamais
 * interrompre un cycle du bot. L'appelant reçoit `{ ok, reason }`.
 */

/**
 * Un en-tête HTTP n'accepte pas d'UTF-8 : on retire les accents pour le titre
 * (le corps du message, lui, reste en UTF-8).
 * @param {string} text
 */
export function asciiHeader(text) {
	return String(text ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[\u2010-\u2015]/g, '-')
		.replace(/[^\x20-\x7E]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Publie un message sur un topic ntfy.
 *
 * Authentification : `token` (jeton d'accès, `Bearer`) sinon `username` +
 * `password` (`Basic`) — les deux sont acceptés par ntfy.
 * @param {{ url?: string, topic?: string, token?: string | null, username?: string | null,
 *   password?: string | null, title?: string, message?: string, priority?: number,
 *   tags?: string[], timeoutMs?: number }} opts
 * @returns {Promise<{ ok: boolean, status?: number, reason?: string }>}
 */
export async function sendNtfy({
	url,
	topic,
	token,
	username,
	password,
	title,
	message,
	priority = 3,
	tags = [],
	timeoutMs = 6000
}) {
	const server = String(url || 'https://ntfy.sh').replace(/\/+$/, '');
	const name = String(topic ?? '').trim();
	if (!name) return { ok: false, reason: 'topic manquant' };

	const headers = { 'content-type': 'text/plain; charset=utf-8' };
	const safeTitle = asciiHeader(title);
	if (safeTitle) headers.Title = safeTitle;
	if (priority) headers.Priority = String(priority);
	if (tags.length) headers.Tags = tags.join(',');
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	} else if (username && password) {
		headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
	}

	try {
		const res = await fetch(`${server}/${encodeURIComponent(name)}`, {
			method: 'POST',
			headers,
			body: String(message ?? ''),
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (!res.ok) {
			// ntfy répond `{"error":"..."}` : on le remonte plutôt qu'un simple code.
			const text = await res.text().catch(() => '');
			let detail = '';
			try {
				detail = JSON.parse(text)?.error ?? '';
			} catch {
				detail = text.slice(0, 80);
			}
			return {
				ok: false,
				status: res.status,
				reason: detail ? `HTTP ${res.status} — ${detail}` : `HTTP ${res.status}`
			};
		}
		return { ok: true, status: res.status };
	} catch (e) {
		return { ok: false, reason: e?.message ?? 'réseau' };
	}
}
