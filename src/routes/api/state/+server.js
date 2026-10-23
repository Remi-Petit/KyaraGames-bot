import { json } from '@sveltejs/kit';
import { snapshot } from '#lib/server/state.js';

export function GET() {
	return json(snapshot(), { headers: { 'cache-control': 'no-store' } });
}
