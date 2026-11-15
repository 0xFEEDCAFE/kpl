# Deployment with Docker

This guide explains how to run the game with Docker Compose, on your own computer or on a server.

## Overview

`docker-compose.yml` starts three containers:

| Service  | What it is                                    | Port         |
|----------|-----------------------------------------------|--------------|
| `db`     | MySQL 8.4 database (card decks)               | not exposed  |
| `server` | Node.js WebSocket game server (`server/`)     | 3001         |
| `client` | Svelte frontend, built and served by nginx (`client/`) | 8080 |

The browser loads the frontend from the `client` container. The frontend then opens a WebSocket connection directly to the `server` container. Both must be reachable from the player's browser.

Both ports are bound to `127.0.0.1`, so only the machine running Docker can reach them. For public access, put a reverse proxy in front (see [Deploying to a public server](#deploying-to-a-public-server)).

This matters because Docker adds its own firewall rules for published ports. A port published on all interfaces (`"8080:80"`) is reachable from the internet even when `ufw` or `firewalld` blocks it.

Database data is kept in the `db-data` volume, so it survives restarts and rebuilds.

## Requirements

- Docker with the Compose plugin (Docker Desktop on Windows/macOS, Docker Engine on Linux).

## Quick start (local)

```sh
docker compose up -d --build
docker compose exec server npm run legacy-card-import
```

Then open http://localhost:8080.

The second command loads the original card decks into the empty database. Run it **only once**. It does not check for existing decks, so a second run creates duplicate copies.

## Configuration

Put the settings in a `.env` file next to `docker-compose.yml`. Docker Compose reads it automatically. Do not commit this file.

```env
MYSQL_ROOT_PASSWORD=choose-a-strong-password
MYSQL_PASSWORD=choose-another-strong-password
VITE_SERVER_URL=ws://localhost:3001
```

| Variable              | Default               | Purpose |
|-----------------------|-----------------------|---------|
| `MYSQL_ROOT_PASSWORD` | `change-me-root`      | MySQL root password. |
| `MYSQL_PASSWORD`      | `change-me`           | Password of the `kpl` database user. The server uses it too. Letters and digits only (see [Password rules](#password-rules)). |
| `VITE_SERVER_URL`     | `ws://localhost:3001` | WebSocket address of the game server, as the player's browser sees it. |

Always change the passwords before you deploy to a public server.

### Password rules

Use only letters and digits in `MYSQL_PASSWORD`. To generate a strong password:

```sh
openssl rand -hex 24
```

The server connects with the URL `mysql://kpl:<MYSQL_PASSWORD>@db:3306/kpl`, so the password becomes part of a URL. Characters such as `/`, `#`, `?`, `@`, `:` and `%` break the URL. The server then fails at startup with `P1001: Can't reach database server`, usually with a wrong host name. URL-encoding the password does not help, because the same variable also sets the password inside MySQL.

Also avoid `$` in any value in `.env`. Docker Compose reads `$` as the start of a variable name.

### Important: `VITE_SERVER_URL` is set at build time

Vite builds this value into the frontend files. If you change it, rebuild the client:

```sh
docker compose up -d --build client
```

A player can still override the address in their browser with a `server-ip` cookie. This is useful for testing against a different server.

### Changing the database password later

MySQL sets the user and passwords only the first time the `db-data` volume is created. If you change `MYSQL_PASSWORD` later, also change it inside MySQL, or delete the volume and start again (this deletes all data).

## Deploying to a public server

1. Copy the repository to the server and create the `.env` file (see above).
2. Set `VITE_SERVER_URL` to the public address of the game server (see the examples below).
3. Put a reverse proxy in front of the containers to handle HTTPS. A page served over HTTPS can only open `wss://` connections, not `ws://`.
4. Start the stack and import the cards (see [Quick start](#quick-start-local)).

If ports 8080 or 3001 are already used on the server, for example by other applications, change the host-side port in `docker-compose.yml` (`"127.0.0.1:8090:80"`) and in the proxy configuration.

The game server accepts WebSocket connections on any URL path. So you can serve the game and the server from one domain: the frontend on `/` and the game server on `/ws`. This needs only one domain and one certificate.

### nginx

Use this when the server already runs nginx, for example for other applications. Set the game server address to the `/ws` path:

```env
VITE_SERVER_URL=wss://kpl.example.com/ws
```

Create a site configuration, for example `/etc/nginx/sites-available/kpl.example.com`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name kpl.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

Enable the site:

```sh
sudo ln -s /etc/nginx/sites-available/kpl.example.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Check that the site answers over both IPv4 and IPv6. Both commands must show the game's response, not a 404 or a different application:

```sh
curl -4 -I http://kpl.example.com/
curl -6 -I http://kpl.example.com/
```

Get an HTTPS certificate with [Certbot](https://certbot.eff.org/). Test with a dry run first, then request the real certificate:

```sh
sudo certbot --nginx -d kpl.example.com --redirect --hsts --dry-run
sudo certbot --nginx -d kpl.example.com --redirect --hsts
```

Certbot adds the `listen 443 ssl` settings to the file, and the options do the following:

- `--redirect` adds an HTTP-to-HTTPS redirect.
- `--hsts` tells browsers to always use HTTPS for this domain. Browsers remember this for a long time, so only use it when the domain will stay on HTTPS.

Some options do not work with this setup:

- `certonly` only gets the certificate and does not change the nginx configuration. Certbot then ignores `--redirect` and `--hsts`, and you must add the SSL settings yourself.
- `-w` / `--webroot-path` is for the webroot method. The `--nginx` method ignores it.
- `--staple-ocsp` has no use with Let's Encrypt, which stopped its OCSP service in 2025.

Keep both `listen` lines. If the domain has an IPv6 (AAAA) DNS record, Let's Encrypt may check it over IPv6. Without `listen [::]:80`, IPv6 requests go to a different nginx site, and the certificate request fails with a 404 error. After certbot runs, check that the 443 block also has `listen [::]:443 ssl;`.

Two settings in the `/ws` block are required:

- **`Upgrade` and `Connection` headers.** Without them, nginx does not pass WebSocket connections through, and the game cannot connect.
- **`proxy_read_timeout`.** The game does not send keep-alive messages. With the nginx default of 60 seconds, nginx closes the connection of any player who is idle for a minute, for example in the lobby. The player is then sent back to the home page.

### Caddy

[Caddy](https://caddyserver.com/) gets HTTPS certificates automatically and passes WebSocket connections through without extra settings or timeouts.

Same domain, game server on `/ws` (`VITE_SERVER_URL=wss://kpl.example.com/ws`):

```caddy
kpl.example.com {
    reverse_proxy /ws localhost:3001
    reverse_proxy localhost:8080
}
```

Or two domains (`VITE_SERVER_URL=wss://api.example.com/`):

```caddy
game.example.com {
    reverse_proxy localhost:8080
}

api.example.com {
    reverse_proxy localhost:3001
}
```

### Discord and Google login

The OAuth client IDs are hard-coded in `client/src/lib/auth/discord.ts` and `client/src/lib/auth/google.ts`. They belong to the original author's apps, so login fails on any other domain.

To enable login on your domain:

1. Register your own app in the [Discord Developer Portal](https://discord.com/developers/applications) and/or [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Add these redirect URLs to the app:
   - `https://game.example.com/auth/callback/discord`
   - `https://game.example.com/auth/callback/google`
3. Replace `CLIENT_ID` in the files above and rebuild the client.

Anonymous play works without any of this.

## Operations

| Task | Command |
|------|---------|
| Show container status | `docker compose ps` |
| Follow server logs | `docker compose logs -f server` |
| Update after `git pull` | `docker compose up -d --build` |
| Stop (keep data) | `docker compose down` |
| Stop and **delete all data** | `docker compose down -v` |
| Back up the database | `docker compose exec -T db mysqldump -ukpl -p<password> kpl > backup.sql` |
| Restore a backup | `docker compose exec -T db mysql -ukpl -p<password> kpl < backup.sql` |

The server applies new database migrations (`prisma migrate deploy`) every time it starts, so an update needs no extra step.

### Admin console

The game server reads admin commands from its console:

| Command               | Effect |
|-----------------------|--------|
| `motd <text>`         | Show a system message to all players. `motd` alone clears it. |
| `room list`           | List all rooms. |
| `room remove <id>`    | Close a room. |
| `player kick <id>`    | Disconnect a player. |

To open the console:

```sh
docker attach kpl-fork-server-1
```

The container name comes from the folder name. Check it with `docker compose ps`. To leave the console without stopping the server, press **Ctrl+P**, then **Ctrl+Q**. Ctrl+C stops the server.

## Troubleshooting

- **The page loads, but the game cannot connect.** Check that `VITE_SERVER_URL` points to an address the browser can reach, that it uses `wss://` when the page uses HTTPS, and that you rebuilt the client after changing it. The browser's developer console shows the WebSocket error.
- **The server restarts again and again.** Run `docker compose logs server`.
  - `P1001: Can't reach database server`, often with a wrong host name such as `kpl:3306` instead of `db:3306`: the password contains a character that breaks the database URL (see [Password rules](#password-rules)).
  - `P1000: Authentication failed`: the password in `.env` does not match the password stored in the database (see [Changing the database password later](#changing-the-database-password-later)).
- **The game page loads, but the WebSocket connection fails with error 502.** The reverse proxy cannot reach the game server. Check that the `server` container is running (`docker compose ps`) and that the proxy points to its port.
- **No card decks appear when creating a room.** The database is empty. Run the card import (see [Quick start](#quick-start-local)).
- **Players are disconnected after about a minute of inactivity.** The reverse proxy closes idle WebSocket connections. With nginx, set `proxy_read_timeout` (see [nginx](#nginx)).
- **Port 8080 or 3001 is already in use.** Change the host-side port in `docker-compose.yml`, for example `"127.0.0.1:8081:80"`. If you change the server port, also update `VITE_SERVER_URL` (local use) or the proxy configuration.
- **Other devices on the local network cannot open the game.** The ports are bound to `127.0.0.1`. For testing on a trusted network, remove the `127.0.0.1:` prefix and set `VITE_SERVER_URL` to `ws://<your-computer-ip>:3001`. Do not do this on a public server.
