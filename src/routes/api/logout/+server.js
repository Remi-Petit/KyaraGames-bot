import { json } from '@sveltejs/kit';
import { COOKIE } from '#lib/server/session.js';

export async function POST({ cookies }) {
	cookies.delete(COOKIE, { path: '/' });
	return json({ ok: true });
}
