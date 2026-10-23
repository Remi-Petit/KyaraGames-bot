import { json } from '@sveltejs/kit';
import { snapshot } from '#lib/server/state.js';

export function GET({ url }) {
	return json(snapshot(url.searchParams.get('account')), {
		headers: { 'cache-control': 'no-store' }
	});
}
