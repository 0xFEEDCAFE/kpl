# Testing the card import script

This file describes the manual tests for `scripts/import-card-packs.ts`, the script that imports the card packs in `packs/`, including the two original decks. The project has no automated tests, so run these tests by hand after you change the script.

The tests run in Docker against a separate, temporary MySQL container. They do not touch the database of the game.

The last run is recorded in [Results of the last run](#results-of-the-last-run).

## What is tested

| Area | What the tests check |
|------|----------------------|
| Build | The server image builds, so the script compiles with `tsc`. |
| Validation | Each kind of invalid pack file stops the import with a message that names the file and the card. The checks finish before the script connects to the database. |
| Import | The default run with the original decks in `packs/`, a directory of packs, skipping existing decks, and replacing a deck with `--force`. |
| Stored data | Deck fields, the `pick` value of black cards (explicit and computed from the blanks), tooltips, Czech characters and a file that starts with a UTF-8 BOM. |

## Setup

Run all commands from the `server/` directory. Every command is on one line, so it works in both `sh` and PowerShell.

### 1. Build a test image

```sh
docker build -t kpl-server-packtest .
```

Expected result: the build finishes without errors. A type error in the script fails the build in the `tsc` step.

### 2. Create the test pack files

Put the files in `test-packs/` inside `server/`. Do not put them in `packs/`: everything in `packs/` is imported into the real database by the normal import. Delete `test-packs/` when you are done (see [Cleanup](#cleanup)).

Valid packs, in `test-packs/good/`:

`a.json`. Save this file **with** a UTF-8 BOM, to test that the script strips it. In PowerShell, `Set-Content -Encoding utf8BOM` does this. In VS Code, use *Save with Encoding → UTF-8 with BOM*.

```json
{
  "name": "Test A",
  "description": "Testovací balíček",
  "default": true,
  "black": [
    "Proč v noci nemůžu spát?",
    "A jako další trik vytáhnu ___ z ___.",
    { "text": "Napiš haiku.", "pick": 3 }
  ],
  "white": [
    "Rasismus",
    { "text": "Hořící člověk", "tip": "Nápověda" }
  ]
}
```

`b.json`. Save this file without a BOM. It tests a pack with only white cards and with no `description` or `default`.

```json
{ "name": "Test B", "white": ["Jen bílá karta"] }
```

Invalid packs, in `test-packs/bad/`. Each file has one mistake:

| File | Content | Mistake |
|------|---------|---------|
| `1-invalid-json.json` | `{ "name": "X", "white": ["ok"` | Broken JSON |
| `2-array.json` | `[ "a bare array" ]` | Not an object |
| `3-no-name.json` | `{ "white": ["no name"] }` | No `name` |
| `4-no-cards.json` | `{ "name": "Empty" }` | No cards |
| `5-long.json` | see below | Card text longer than 191 characters |
| `6-pick.json` | `{ "name": "Pick", "black": [{ "text": "x ___", "pick": 0 }] }` | `pick` less than 1 |
| `7-tip.json` | `{ "name": "Tip", "white": [{ "text": "x", "tip": 5 }] }` | `tip` is not a string |
| `8-default.json` | `{ "name": "Def", "default": "yes", "white": ["x"] }` | `default` is not true or false |
| `9-dup-name.json` | `{ "name": "Test A", "white": ["dup"] }` | Same name as `good/a.json` |

`5-long.json` has a second white card made of 192 × `ž`. Create it with one of these commands:

```sh
# sh
printf '{ "name": "Long", "white": ["ok", "%s"] }\n' "$(printf 'ž%.0s' $(seq 192))" > test-packs/bad/5-long.json
```

```powershell
# PowerShell
'{ "name": "Long", "white": ["ok", "' + ('ž' * 192) + '"] }' | Set-Content test-packs/bad/5-long.json -Encoding utf8NoBOM
```

## Validation tests

These tests run without a network (`--network none`), so the script cannot reach any database. A passing test therefore also shows that the checks finish before the database connection.

Run each file on its own:

```sh
docker run --rm --network none -v "$PWD/test-packs:/test:ro" kpl-server-packtest node dist/scripts/import-card-packs.js /test/bad/1-invalid-json.json
```

Replace the file name for each test. For test V9, pass two files: `/test/good/a.json /test/bad/9-dup-name.json`.

Every test must exit with code 1 and print the message below:

| # | Arguments | Expected message |
|---|-----------|------------------|
| V1 | `/test/bad/1-invalid-json.json` | `Card import failed: /test/bad/1-invalid-json.json: invalid JSON: Expected ',' or ']' after array element in JSON at position 31` |
| V2 | `/test/bad/2-array.json` | `Card import failed: /test/bad/2-array.json: the file must contain a JSON object` |
| V3 | `/test/bad/3-no-name.json` | `Card import failed: /test/bad/3-no-name.json: "name" must be a non-empty string` |
| V4 | `/test/bad/4-no-cards.json` | `Card import failed: /test/bad/4-no-cards.json: the pack has no cards` |
| V5 | `/test/bad/5-long.json` | `Card import failed: /test/bad/5-long.json: white[1]: text is longer than 191 characters` |
| V6 | `/test/bad/6-pick.json` | `Card import failed: /test/bad/6-pick.json: black[0]: "pick" must be a whole number, 1 or more` |
| V7 | `/test/bad/7-tip.json` | `Card import failed: /test/bad/7-tip.json: white[0]: "tip" must be a string` |
| V8 | `/test/bad/8-default.json` | `Card import failed: /test/bad/8-default.json: "default" must be true or false` |
| V9 | `/test/good/a.json /test/bad/9-dup-name.json` | `Card import failed: Deck name "Test A" is used by both /test/good/a.json and /test/bad/9-dup-name.json` |
| V10 | `/test/nope.json` | `Card import failed: /test/nope.json: no such file or directory` |
| V11 | `--dry-run` | `Unknown argument: --dry-run`, followed by the usage line |

The text of the V1 message comes from Node's `JSON.parse` and can change with the Node version.

## Import tests

### Start a temporary database

Create a separate network and a MySQL container. The names start with `kpl-packtest`, so they cannot be confused with the containers of the game.

```sh
docker network create kpl-packtest-net
docker run -d --name kpl-packtest-db --network kpl-packtest-net -e MYSQL_ROOT_PASSWORD=rootpw -e MYSQL_DATABASE=kpl -e MYSQL_USER=kpl -e MYSQL_PASSWORD=testpw mysql:8.4
```

Wait until MySQL is ready. This command prints `mysqld is alive` when it is:

```sh
docker exec kpl-packtest-db mysqladmin ping -h 127.0.0.1 -uroot -prootpw
```

Create the tables:

```sh
docker run --rm --network kpl-packtest-net -e MYSQL_PASSWORD=testpw -e MYSQL_HOST=kpl-packtest-db kpl-server-packtest node dist/src/migrate.js
```

Expected result: `All migrations have been successfully applied.`

### Run the tests

All tests use this command, followed by the arguments in the table:

```sh
docker run --rm --network kpl-packtest-net -e MYSQL_PASSWORD=testpw -e MYSQL_HOST=kpl-packtest-db -v "$PWD/test-packs:/test:ro" kpl-server-packtest node dist/scripts/import-card-packs.js
```

Run the tests in this order. Each one depends on the database state left by the one before it. All of them must exit with code 0.

| # | Arguments | What it tests | Expected output |
|---|-----------|---------------|-----------------|
| I1 | *(none)* | Default run: every pack in `packs/`. The files are read in name order. | `Importing 2 decks...`<br>`Imported "KPL Online - Community (2021)" (222 cards) from packs/kpl-community-2021.json`<br>`Imported "KPL Online - Original (2018)" (794 cards) from packs/kpl-original-2018.json`<br>`Done` |
| I2 | `/test/good` | A directory of packs, including a file with a BOM | `Importing 2 decks...`<br>`Imported "Test A" (5 cards) from /test/good/a.json`<br>`Imported "Test B" (1 card) from /test/good/b.json`<br>`Done` |
| I3 | `/test/good` | Decks that already exist are skipped | `Skipped "Test A": already imported (use --force to replace it)`<br>`Skipped "Test B": already imported (use --force to replace it)` |
| I4 | `--force /test/good/a.json` | `--force` replaces one deck and leaves the others alone | `Importing 1 deck...`<br>`Removed 1 existing copy of "Test A"`<br>`Imported "Test A" (5 cards) from /test/good/a.json`<br>`Done` |

The expected output assumes that `packs/` contains only the two original packs when you build the image. Each additional pack file adds a line to I1 and moves the deck ids below.

### Check the stored data

Pipe the query into the database container, so the shell does not change the backticks:

```sql
SELECT id, name, description, public, `default` FROM CardDeck;
SELECT d.name AS deck, c.pick, c.text, c.tip FROM Card c JOIN CardDeck d ON d.id = c.deckId WHERE d.name LIKE 'Test%' ORDER BY d.id, c.id;
```

Save the query as `test-packs/check.sql` and run:

```sh
docker exec -i kpl-packtest-db mysql -ukpl -ptestpw kpl --default-character-set=utf8mb4 < test-packs/check.sql
```

In PowerShell, `<` does not work. Use `Get-Content test-packs/check.sql | docker exec -i ...` instead.

Expected decks:

| id | name | description | public | default |
|----|------|-------------|--------|---------|
| 1 | KPL Online - Community (2021) | Rozšíření balíčku karet na základě návrhů komunity v roce 2021 | 1 | 1 |
| 2 | KPL Online - Original (2018) | Původní balíček karet použitý při prvním spuštění KPL Online v roce 2018 | 1 | 1 |
| 4 | Test B | NULL | 1 | 0 |
| 5 | Test A | Testovací balíček | 1 | 1 |

The first copy of Test A had id 3. Test I4 deleted it and created id 5.

Expected cards:

| deck | pick | text | tip | What it shows |
|------|------|------|-----|---------------|
| Test B | 0 | Jen bílá karta | NULL | A white card has `pick` 0 |
| Test A | 1 | Proč v noci nemůžu spát? | NULL | No blanks: `pick` is 1 |
| Test A | 2 | A jako další trik vytáhnu \_\_\_ z \_\_\_. | NULL | Two blanks: `pick` is 2 |
| Test A | 3 | Napiš haiku. | NULL | An explicit `pick` is kept |
| Test A | 0 | Rasismus | NULL | A white card written as a plain string |
| Test A | 0 | Hořící člověk | Nápověda | The tooltip is saved |

Also check that the Czech characters are not broken.

## Cleanup

```sh
docker rm -f kpl-packtest-db
docker network rm kpl-packtest-net
docker image rm kpl-server-packtest
```

Then delete the `test-packs/` directory.

## Not covered

These parts were not tested:

- **Running without Docker** (`pnpm run card-import`, or its alias `pnpm run legacy-card-import`). It runs the same code with `tsx` instead of the compiled JavaScript.
- **The Docker Compose commands in DEPLOYMENT.md**: rebuilding the `server` service, and copying a single pack into the running container with `docker compose cp`.
- **Characters outside the Basic Multilingual Plane** (for example emoji) in the 191-character check. The script counts code points, as MySQL does. Test V5 uses `ž`, which is one unit in both counts, so it does not show the difference.
- **The game itself**: that an imported pack appears in the deck selection and that its cards are dealt in a game.

## Results of the last run

- **Date:** 2026-11-16
- **Code:** commit `faee85a` with the uncommitted changes that moved the original decks from `legacy/*.json` to `packs/kpl-original-2018.json` and `packs/kpl-community-2021.json`
- **Steps:** the steps in this file, run in PowerShell 7 on Windows 11 with Docker Desktop
- **Result:** the build and all tests (V1–V11, I1–I4, stored data) passed. The outputs matched the expected results above. A second run without arguments after I4 printed `Skipped` for both original decks.
- **Migration check:** before the legacy code was removed, the old import (from `legacy/*.json`) and an import of only the two new pack files were run into two empty databases. The decks (name, description, `public`, `default`) and all 1016 cards (`pick`, text as `HEX(text)`, `tip`), sorted, were byte-identical in both. This includes the 12 cards with `\r\n` and black cards 30 and 109, which keep `pick` 2 without blanks.
- **Not run:** the `sh` command that creates `5-long.json`. The file was created with the PowerShell command.
