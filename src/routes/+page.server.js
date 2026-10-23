import { snapshot } from '#lib/server/state.js';

export function load() {
	return { snapshot: snapshot() };
}
