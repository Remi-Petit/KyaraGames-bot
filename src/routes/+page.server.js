import { snapshot } from '#lib/server/state.js';

export function load({ url, locals }) {
	return {
		snapshot: snapshot(url.searchParams.get('account'), locals.user)
	};
}
