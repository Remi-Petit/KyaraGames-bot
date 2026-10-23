import { snapshot } from '#lib/server/state.js';
import { subscribe } from '#lib/server/bus.js';

const encoder = new TextEncoder();

/**
 * Flux temps réel (Server-Sent Events).
 * Envoie l'état complet du compte visible par l'utilisateur dès qu'il change
 * côté serveur, avec un battement toutes les 25 s pour traverser les proxies.
 */
export async function GET({ url, locals, request }) {
	const accountId = url.searchParams.get('account');

	const stream = new ReadableStream({
		start(controller) {
			let closed = false;
			let lastPayload = '';
			/** @type {ReturnType<typeof setTimeout> | null} */
			let coalesce = null;

			const flush = () => {
				coalesce = null;
				if (closed) return;
				const payload = JSON.stringify(snapshot(accountId, locals.user));
				if (payload === lastPayload) return;
				lastPayload = payload;
				controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
			};

			const schedule = () => {
				if (coalesce || closed) return;
				// Une rafale d'ouvertures ne doit pas envoyer 10 trames.
				coalesce = setTimeout(flush, 250);
			};

			const heartbeat = setInterval(() => {
				if (!closed) controller.enqueue(encoder.encode(': ping\n\n'));
			}, 25_000);

			const close = () => {
				if (closed) return;
				closed = true;
				clearTimeout(coalesce);
				clearInterval(heartbeat);
				unsubscribe();
				try {
					controller.close();
				} catch {
					/* déjà fermé */
				}
			};

			const unsubscribe = subscribe(schedule);
			request.signal?.addEventListener('abort', close);

			flush(); // état initial immédiat
		},

		cancel() {
			// Le client a fermé la connexion : le `close` d'abort fait le ménage.
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
}
