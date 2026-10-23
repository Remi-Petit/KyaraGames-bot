import { snapshot } from '#lib/server/state.js';

export function load({ url }) {
	return { snapshot: snapshot(url.searchParams.get('account')) };
}
