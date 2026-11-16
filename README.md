# KPL Online (Karty proti lidskosti)

An online multiplayer party card game in Czech, in the style of *Cards Against Humanity*. Players join a room. Each round, one player (the card czar) reveals a black card with a blank or a question. The other players answer with the funniest white card from their hand, and the czar picks the winner. The first player to reach the room's point goal wins.

The game was originally created by Sára Hýžová. This repository is a personal fork of [sarahyzova/kpl](https://github.com/sarahyzova/kpl), which contains the game's latest rewrite. See [History](#history).

## Features

- Public and private rooms, with a room browser and "join random room"
- Room settings: player limit, point goal and card decks
- Card decks stored in a database, including the original 2018 deck and the 2021 community extension
- In-game chat, sounds and a touchscreen-friendly hand for phones
- Anonymous play, or login with Discord or Google
- Admin console on the server: system message for all players, room and player management

## Tech stack

| Part     | Technology |
|----------|------------|
| Frontend | [Svelte 4](https://svelte.dev/), TypeScript, [Vite](https://vitejs.dev/), `svelte-routing` |
| Backend  | Node.js, TypeScript (run with `tsx`), WebSockets (`ws`) |
| Database | MySQL, accessed through [Prisma](https://www.prisma.io/) |
| Deployment | Docker Compose, nginx for the frontend |

The frontend and the backend communicate over a single WebSocket connection. The client calls server functions by name (RPC), and the server pushes game state updates to the players.

## Project structure

```
.
├── client/                     Svelte frontend
│   ├── public/                 Static files: font, sound effects
│   ├── src/
│   │   ├── App.svelte          Routes (pages) of the app
│   │   ├── pages/              One folder per screen
│   │   │   ├── home/           Entry page, login, profile
│   │   │   ├── lobby/          Room browser
│   │   │   ├── create/         Room creation and deck selection
│   │   │   ├── ingame/         Game board, hand, players, chat sidebar
│   │   │   ├── rules/          Game rules
│   │   │   └── auth/           Discord/Google login callback
│   │   ├── components/         Shared UI: cards, layouts, form controls
│   │   └── lib/
│   │       ├── networking/     WebSocket client, message encoding, RPC calls
│   │       └── auth/           Anonymous, Discord and Google login
│   ├── Dockerfile              Builds the app and serves it with nginx
│   └── nginx.conf
├── server/                     Node.js game server
│   ├── src/
│   │   ├── index.ts            Entry point: starts the server and the admin console
│   │   ├── networking/         WebSocket server, player identity, RPC functions
│   │   ├── game/               Rooms, players and the game logic
│   │   ├── auth/               Discord/Google token checks
│   │   ├── cli/                Admin console commands
│   │   └── database.ts         Prisma client
│   ├── prisma/                 Database schema and migrations
│   ├── legacy/                 Original card data (JSON) and the card import script
│   ├── packs/                  Additional card packs (JSON), see packs/README.md
│   └── Dockerfile
├── docker-compose.yml          Runs the database, server and client together
└── DEPLOYMENT.md               Deployment guide
```

## Deployment

The easiest way to run the game is Docker Compose:

```sh
docker compose up -d --build
docker compose exec server node dist/legacy/inport-legacy-cards.js
```

Then open http://localhost:8080.

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for configuration, deployment to a public server with HTTPS, login setup, backups and troubleshooting.

## Development without Docker

You need Node.js 20, [pnpm](https://pnpm.io/) for the server, and a running MySQL database.

**Server:**

```sh
cd server
pnpm install
```

Create `server/.env`:

```env
DATABASE_URL=mysql://user:password@localhost:3306/kpl
SERVER_PORT=3001
```

The client's development build connects to `ws://localhost:3001`, so set `SERVER_PORT` to 3001. Without it, the server uses port 3000.

```sh
pnpm run migrate             # create the database tables
pnpm run legacy-card-import  # load the card decks and packs/*.json (skips existing; add --force to replace them)
pnpm run dev                 # start the server, restarts on file changes
```

**Client:**

```sh
cd client
npm install
npm run dev
```

Vite prints the local address of the app, usually http://localhost:5173.

## Adding a card pack

A card pack is a JSON file in `server/packs/`. The import script loads every pack file in that folder into the database. The game shows the new pack in the deck selection when players create a room. You do not need to change any code.

1. Create a file in `server/packs/`, for example `server/packs/my-pack.json`. Save it as UTF-8.

2. Write the pack:

   ```json
   {
     "name": "Můj balíček",
     "description": "Krátký popis balíčku",
     "black": [
       "Proč v noci nemůžu spát?",
       "A jako další trik vytáhnu ___ z ___."
     ],
     "white": [
       "Rasismus",
       { "text": "Hořící člověk", "tip": "Nápověda, která se ukáže u karty" }
     ]
   }
   ```

   - `name` is required. Players see it, and the import uses it to find the deck again. Every pack needs a different name.
   - Black cards are the questions. Write each blank as `___`. A black card with two blanks needs two white cards as the answer.
   - White cards are the answers. Add a `tip` when a card needs an explanation.
   - A card's text can have at most 191 characters.
   - Add `"default": true` to also use the pack in rooms made by "join random room".

   See [server/packs/README.md](server/packs/README.md) for all the fields.

3. Import the pack.

   With Docker, rebuild the server image, because the image contains the pack files, and then run the import:

   ```sh
   docker compose up -d --build server
   docker compose exec server node dist/legacy/inport-legacy-cards.js
   ```

   Without Docker, run this in `server/`:

   ```sh
   pnpm run legacy-card-import
   ```

   The script prints each imported pack. Packs that are already in the database are skipped. If the script finds an error in a file, it prints the file name and the card position, and changes nothing in the database.

4. To change a pack later, edit its file, rebuild the image (with Docker), and run the import with `--force`. This replaces the decks that are already in the database with the versions from the files. Do this when nobody is playing: a room that is waiting to start with the old version of the pack gets no cards from it.

   To remove a pack, deleting its file is not enough. The deck stays in the database until you delete it there.

## History

Sára Hýžová started the project in high school as a way to play the game with friends. Over the years the game was improved step by step and rewritten several times. The [original repository](https://github.com/sarahyzova/kpl) contains the latest rewrite.

The site became unexpectedly popular. The original version was not built for that load and had repeated outages. The later rewrites tried to fix the stability problems and to add new features, such as a custom card editor and user accounts.

According to the author, attempts to change the game were often met with rude and threatening e-mails, and even short outages brought demands for immediate fixes. This took the joy out of the work. The author decided to stop developing the game, even though it never became what they had planned. The code was published on GitHub and opened to community development.

The author's own account, in Czech, is in the [original README](https://github.com/sarahyzova/kpl/blob/0eb6b86/README.md).
