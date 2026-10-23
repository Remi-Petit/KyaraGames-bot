import { json } from '@sveltejs/kit';
import { snapshot } from '#lib/server/state.js';

export function GET({ url, locals }) {
	return json(snapshot(url.searchParams.get('account'), locals.user), {
		headers: { 'cache-control': 'no-store' }
	});
}
