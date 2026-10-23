import { json, error } from '@sveltejs/kit';
import { COOKIE, authRequired, checkPassword, makeCookieValue } from '#lib/server/session.js';

export async function POST({ request, cookies }) {
	if (!authRequired()) return json({ ok: true });

	const body = await request.json().catch(() => ({}));
	if (!checkPassword(String(body.password ?? ''))) {
		throw error(401, 'Mot de passe incorrect');
	}

	cookies.set(COOKIE, makeCookieValue(), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 30
	});

	return json({ ok: true });
}
