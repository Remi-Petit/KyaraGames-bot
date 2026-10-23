<script>
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import '#lib/ui.css';

	let { children, data } = $props();

	const path = $derived(page.url.pathname);
	const isAdmin = $derived(data.me?.role === 'admin' || data.authMode === 'open');
	const showBar = $derived(path !== '/login');

	async function logout() {
		await fetch('/api/logout', { method: 'POST' });
		location.href = '/login';
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app">
	{#if showBar}
		<header class="topbar">
			<a class="brand" href="/">
				<span class="brand-kyara">KYARA</span>
				<span class="brand-bot">BOT</span>
				<span class="brand-sub">collecteur de boosters gratuits</span>
			</a>

			<nav>
				<a href="/" class:active={path === '/'} aria-current={path === '/' ? 'page' : undefined}>
					Dashboard
				</a>
				{#if isAdmin}
					<a
						href="/admin"
						class:active={path.startsWith('/admin')}
						aria-current={path.startsWith('/admin') ? 'page' : undefined}
					>
						Administration
					</a>
				{/if}
			</nav>

			<div class="who">
				{#if data.me}
					<span class="who-text">
						<strong>{data.me.username}</strong>
						<span>{data.me.role === 'admin' ? 'administrateur' : 'membre'}</span>
					</span>
					<button class="link" onclick={logout}>Déconnexion</button>
				{:else}
					<span class="who-text">accès libre — crée un compte dans Administration</span>
				{/if}
			</div>
		</header>
	{/if}

	{@render children()}
</div>

<style>
	:global(:root) {
		--bg: #08070c;
		--panel: #12101a;
		--panel-2: #16131f;
		--line: #262133;
		--text: #e9e6f2;
		--muted: #8b849c;
		--gold: #f5c518;
		--green: #34d399;
		--amber: #fbbf24;
		--red: #f87171;
		--blue: #60a5fa;
		--violet: #a78bfa;
		--pink: #f472b6;
		--mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	:global(*) {
		box-sizing: border-box;
	}

	:global(html) {
		background: var(--bg);
	}

	:global(body) {
		margin: 0;
		min-height: 100vh;
		font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		color: var(--text);
		background:
			radial-gradient(900px 500px at 15% -10%, rgba(245, 197, 24, 0.09), transparent 60%),
			radial-gradient(800px 500px at 90% 0%, rgba(167, 139, 250, 0.08), transparent 55%),
			var(--bg);
		-webkit-font-smoothing: antialiased;
	}

	:global(button) {
		font: inherit;
		cursor: pointer;
	}

	:global(input) {
		font: inherit;
	}

	:global(a) {
		color: var(--gold);
	}

	.app {
		min-height: 100vh;
	}

	.topbar {
		max-width: 1180px;
		margin: 0 auto;
		padding: 22px 20px 14px;
		display: flex;
		align-items: center;
		gap: 22px;
		flex-wrap: wrap;
	}

	.brand {
		display: grid;
		text-decoration: none;
		color: var(--text);
		line-height: 1.1;
	}
	.brand-kyara {
		font-size: 22px;
		font-weight: 900;
		letter-spacing: 0.16em;
		color: var(--gold);
	}
	.brand-bot {
		font-size: 22px;
		font-weight: 300;
		letter-spacing: 0.24em;
		margin-left: 8px;
	}
	.brand-sub {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.16em;
		color: var(--muted);
		margin-top: 3px;
	}

	nav {
		display: flex;
		gap: 4px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 4px;
	}
	nav a {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--muted);
		text-decoration: none;
		padding: 7px 15px;
		border-radius: 999px;
		transition:
			color 0.15s,
			background 0.15s;
	}
	nav a:hover {
		color: var(--text);
	}
	nav a.active {
		color: #191307;
		background: var(--gold);
	}

	.who {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.who-text {
		display: grid;
		line-height: 1.2;
		text-align: right;
	}
	.who-text strong {
		font-size: 13px;
	}
	.who-text span {
		font-size: 11px;
		color: var(--muted);
	}

	@media (max-width: 640px) {
		.who {
			margin-left: 0;
		}
		.who-text {
			text-align: left;
		}
	}
</style>
