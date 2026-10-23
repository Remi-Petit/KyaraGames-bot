<script>
	let password = $state('');
	let busy = $state(false);
	let message = $state(null);

	async function submit(event) {
		event.preventDefault();
		busy = true;
		message = null;
		try {
			const res = await fetch('/api/login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ password })
			});
			if (res.ok) {
				location.href = '/';
				return;
			}
			const body = await res.json().catch(() => ({}));
			message = body.message ?? 'Mot de passe incorrect';
		} catch {
			message = 'Serveur injoignable';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Kyara — Connexion</title></svelte:head>

<main>
	<form onsubmit={submit}>
		<div class="brand"><span>KYARA</span> BOT</div>
		<p class="hint">Accès protégé par mot de passe.</p>

		<label>
			Mot de passe
			<input type="password" bind:value={password} autocomplete="current-password" required />
		</label>

		{#if message}<p class="error">{message}</p>{/if}

		<button type="submit" disabled={busy}>{busy ? 'Vérification…' : 'Entrer'}</button>
	</form>
</main>

<style>
	main {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 24px;
	}
	form {
		width: min(380px, 100%);
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 18px;
		padding: 28px;
		display: grid;
		gap: 14px;
	}
	.brand {
		font-weight: 900;
		letter-spacing: 0.14em;
		font-size: 20px;
	}
	.brand span {
		color: var(--gold);
	}
	.hint {
		margin: 0;
		color: var(--muted);
		font-size: 13px;
	}
	label {
		display: grid;
		gap: 6px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}
	input {
		background: #0c0a12;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 10px 12px;
		color: var(--text);
	}
	input:focus {
		outline: 2px solid rgba(245, 197, 24, 0.4);
		outline-offset: 1px;
	}
	button {
		border: 0;
		border-radius: 10px;
		padding: 11px;
		font-weight: 700;
		background: var(--gold);
		color: #191307;
	}
	button:disabled {
		opacity: 0.6;
	}
	.error {
		margin: 0;
		color: var(--red);
		font-size: 13px;
	}
</style>
