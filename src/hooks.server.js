import { startEngine } from '#lib/server/bot.js';
import { authRequired, isValidCookie, COOKIE } from '#lib/server/session.js';

// Le moteur est un singleton : il doit survivre au HMR de Vite en dev.
if (!globalThis.__kyaraEngineStarted) {
	globalThis.__kyaraEngineStarted = true;
	startEngine();
}

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
	const authed = !authRequired() || isValidCookie(event.cookies.get(COOKIE));
	event.locals.authed = authed;

	const path = event.url.pathname;
	const isLogin = path === '/login' || path === '/api/login';

	if (!authed && !isLogin) {
		if (path.startsWith('/api/')) {
			return new Response(JSON.stringify({ error: 'unauthorized' }), {
				status: 401,
				headers: { 'content-type': 'application/json' }
			});
		}
		return new Response(null, { status: 303, headers: { location: '/login' } });
	}

	if (authed && path === '/login') {
		return new Response(null, { status: 303, headers: { location: '/' } });
	}

	return resolve(event);
}
