import { snapshot } from '#lib/server/state.js';
import { authMode, publicUser } from '#lib/server/session.js';

export function load({ url, locals }) {
	return {
		snapshot: snapshot(url.searchParams.get('account'), locals.user),
		me: publicUser(locals.user),
		authMode: authMode()
	};
}
