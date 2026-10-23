import { json, error } from '@sveltejs/kit';
import { COOKIE, login, makeSessionCookie, publicUser } from '#lib/server/session.js';

export async function POST({ request, cookies }) {
	const body = await request.json().catch(() => ({}));
	const user = login(String(body.username ?? ''), String(body.password ?? ''));

	if (!user) {
		throw error(401, 'Identifiants incorrects.');
	}

	cookies.set(COOKIE, makeSessionCookie(user), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 30
	});

	return json({ ok: true, user: publicUser(user) });
}
