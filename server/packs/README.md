# Card packs

Every `*.json` file in this directory is a card pack. The card import script loads all of them. The original decks are here too: `kpl-original-2018.json` and `kpl-community-2021.json`. To run the import:

```sh
pnpm run legacy-card-import            # locally, from server/
docker compose exec server node dist/legacy/inport-legacy-cards.js   # Docker (rebuild the image first)
```

To import only some packs, pass their files or directories. Then the other packs are not imported:

```sh
pnpm run legacy-card-import packs/my-pack.json
```

Existing decks are skipped. Add `--force` to replace them, for example after you change a pack's cards.

## Format

```json
{
  "name": "Můj balíček",
  "description": "Krátký popis, který se ukáže při výběru balíčků",
  "default": false,
  "black": [
    "Proč v noci nemůžu spát?",
    "A jako další trik vytáhnu ___ z ___.",
    { "text": "Napiš haiku.", "pick": 3 }
  ],
  "white": [
    "Rasismus",
    { "text": "Hořící člověk", "tip": "Vysvětlení, které se ukáže v nápovědě" }
  ]
}
```

| Field         | Required | Meaning |
|---------------|----------|---------|
| `name`        | yes      | Deck name shown to players. It identifies the deck: it must be unique, and importing a pack with the same name again skips it (or replaces it with `--force`). If you rename a pack, the deck with the old name stays in the database. |
| `description` | no       | Text shown under the deck name. |
| `default`     | no       | `true` adds the deck to rooms made by "join random room". Defaults to `false`. |
| `black`       | no       | Black cards. Write blanks as `___`. A card is a string or `{ "text", "pick" }`. Without `pick`, it is the number of blanks, or 1 if there are none. |
| `white`       | no       | White cards. A card is a string or `{ "text", "tip" }`. `tip` is an optional tooltip. |

A pack needs at least one card. Card text can have at most 191 characters. The script checks all files before it changes the database, and stops with the file name and card position if something is wrong.

All imported packs are public: every player can select them when creating a room.
