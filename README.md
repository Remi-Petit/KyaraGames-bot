# Kyara Bot

Bot personnel pour [kyara.games](https://kyara.games) : il ouvre les boosters gratuits
avant que la réserve (10 max, +1 toutes les ~10 min) ne soit pleine, en alternant les
types de boosters. Un tableau de bord SvelteKit (Svelte 5) affiche l'état en direct.

## Comment l'authentification fonctionne

La connexion Discord ne sert qu'**une fois** : après le OAuth, Kyara émet un token
opaque stocké dans `localStorage.kyara_token`. Ensuite, toutes les requêtes authentifiées
sont de simples `Authorization: Bearer <token>` — aucun cookie, aucune session Discord.

Conséquence : le bot n'a pas besoin de Discord, d'un navigateur ni d'un OAuth.
Il a juste besoin de cette clé, récupérable depuis la console du navigateur :

```js
copy(localStorage.getItem('kyara_token'))
```

Pourquoi pas un « Se connecter avec Discord » dans l'interface du bot ? Parce que le
token Kyara est émis par **le serveur de Kyara** avec **son propre client OAuth**. Un
OAuth Discord lancé par le bot renverrait un code pour un autre client : Kyara refuserait
l'échange. Il faudrait automatiser un vrai login Discord (2FA, captcha) — fragile et
contraire aux CGU de Discord. La clé collée une fois est donc la bonne approche.

Sécurité : la clé est chiffrée au repos (`AES-256-GCM`, clé locale dans `.data/key.bin`),
n'est jamais renvoyée au navigateur, et `.data/` est ignoré par git.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173
```

Production :

```bash
npm run build
npm start          # adapter-node, port 3000 par défaut
```

Optionnel, dans `.env` (voir `.env.example`) :

```env
DASHBOARD_PASSWORD=un-mot-de-passe   # protège l'accès au tableau de bord
KYARA_DATA_DIR=C:\chemin\data        # dossier des données
```

## Comportement

- À chaque passage : `GET /api/me`, puis ouverture de **tous** les boosters disponibles
  (max 10), un par type, en round-robin sur les types activés.
- Le prochain passage est planifié à `min(intervalle max, instant où la réserve
  atteindrait 10)`. C'est ce qui garantit qu'aucun booster n'est perdu, tout en restant
  à ~1 h 30 entre deux passages quand la réserve est basse.
- Un `x-pass` (laissez-passer anti-bot, valable 30 min) est demandé automatiquement
  quand l'API répond `pass_required`, et renouvelé au besoin.
- Sur `401` : le bot se met en pause et le tableau de bord demande une nouvelle clé
  (il ne bascule **pas** en compte invité comme le fait le site).
- `crypto.randomUUID()` est envoyé en `x-request-id` à chaque ouverture (idempotence
  côté serveur).

## Avertissement

Projet non officiel. Les actions passent par l'API du site avec ta propre session :
automatiser un jeu peut contrevenir à ses règles et exposer le compte à des sanctions.
À utiliser sur ton compte, à rythme humain.


## Adding features

Add features to your project with `sv add`:

```sh
npx sv add
```

For example, to add Tailwind CSS:

```sh
npx sv add tailwindcss
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
