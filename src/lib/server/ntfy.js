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
 * @param {{ url?: string, topic?: string, token?: string | null, title?: string,
 *   message?: string, priority?: number, tags?: string[], timeoutMs?: number }} opts
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function sendNtfy({
	url,
	topic,
	token,
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
	if (token) headers.Authorization = `Bearer ${token}`;

	try {
		const res = await fetch(`${server}/${encodeURIComponent(name)}`, {
			method: 'POST',
			headers,
			body: String(message ?? ''),
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
		return { ok: true };
	} catch (e) {
		return { ok: false, reason: e?.message ?? 'réseau' };
	}
}
