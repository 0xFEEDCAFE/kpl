import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { ensureDatabaseUrl } from '../src/database-url.js';

// Usage: inport-legacy-cards [--force] [<pack.json | directory> ...]
//
// Without paths: imports every *.json pack in packs/, including the original decks.
// With paths: imports only the given pack files. A directory means every *.json file in it.
// Paths are relative to the current directory (server/ locally, /app in Docker).
//
// Without --force, decks that already exist are skipped.
// With --force, existing decks are deleted (with their cards) and imported again.
// A deck is identified by its name. The pack file format is described in packs/README.md.
const USAGE = 'Usage: inport-legacy-cards [--force] [<pack.json | directory> ...]';
const SYSTEM_OWNER = 'system';
const PACKS_DIR = 'packs';
// Card.text is VARCHAR(191) in the database
const MAX_TEXT_LENGTH = 191;

type CardImport = {
	text: string;
	tip?: string;
	pick: number;
}

type DeckImport = {
	name: string;
	description?: string;
	default: boolean;
	cards: CardImport[];
	source: string;
}

class PackError extends Error {}

function parseArgs(args: string[]): { force: boolean, paths: string[] } {
	let force = false;
	const paths: string[] = [];
	for (const arg of args) {
		if (arg === '--force') {
			force = true;
		} else if (arg.startsWith('-')) {
			console.error(`Unknown argument: ${arg}\n${USAGE}`);
			process.exit(1);
		} else {
			paths.push(arg);
		}
	}
	return { force, paths };
}

function readJson(file: string): unknown {
	// Strip a UTF-8 BOM: some Windows editors add one, and JSON.parse rejects it
	const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new PackError(`${file}: invalid JSON: ${(error as Error).message}`);
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// MySQL counts characters (code points), not UTF-16 units like String.length
function charLength(text: string): number {
	return [...text].length;
}

function checkCardText(text: unknown, where: string): string {
	if (typeof text !== 'string' || text.trim() === '') {
		throw new PackError(`${where}: "text" must be a non-empty string`);
	}
	if (charLength(text) > MAX_TEXT_LENGTH) {
		throw new PackError(`${where}: text is longer than ${MAX_TEXT_LENGTH} characters`);
	}
	return text;
}

// A black card is either a string or { text, pick? }. Without pick, it is the number of
// blanks (___) in the text, at least 1 (a question without blanks takes one answer).
function parseBlackCard(entry: unknown, where: string): CardImport {
	const card = typeof entry === 'string' ? { text: entry } : entry;
	if (!isObject(card)) {
		throw new PackError(`${where}: must be a string or an object with "text"`);
	}
	const text = checkCardText(card.text, where);
	const pick = card.pick;
	if (pick === undefined) {
		return { text, pick: Math.max(1, (text.match(/_{3,}/g) ?? []).length) };
	}
	if (typeof pick !== 'number' || !Number.isInteger(pick) || pick < 1) {
		throw new PackError(`${where}: "pick" must be a whole number, 1 or more`);
	}
	return { text, pick };
}

// A white card is either a string or { text, tip? }
function parseWhiteCard(entry: unknown, where: string): CardImport {
	const card = typeof entry === 'string' ? { text: entry } : entry;
	if (!isObject(card)) {
		throw new PackError(`${where}: must be a string or an object with "text"`);
	}
	const text = checkCardText(card.text, where);
	const tip = card.tip;
	if (tip !== undefined && typeof tip !== 'string') {
		throw new PackError(`${where}: "tip" must be a string`);
	}
	return { text, tip: tip || undefined, pick: 0 };
}

function parsePackFile(file: string): DeckImport {
	const pack = readJson(file);
	if (!isObject(pack)) {
		throw new PackError(`${file}: the file must contain a JSON object`);
	}

	const { name, description, default: isDefault, black = [], white = [] } = pack;
	if (typeof name !== 'string' || name.trim() === '') {
		throw new PackError(`${file}: "name" must be a non-empty string`);
	}
	if (charLength(name) > MAX_TEXT_LENGTH) {
		throw new PackError(`${file}: "name" is longer than ${MAX_TEXT_LENGTH} characters`);
	}
	if (description !== undefined && typeof description !== 'string') {
		throw new PackError(`${file}: "description" must be a string`);
	}
	if (isDefault !== undefined && typeof isDefault !== 'boolean') {
		throw new PackError(`${file}: "default" must be true or false`);
	}
	if (!Array.isArray(black) || !Array.isArray(white)) {
		throw new PackError(`${file}: "black" and "white" must be arrays`);
	}

	const cards = [
		...black.map((card, i) => parseBlackCard(card, `${file}: black[${i}]`)),
		...white.map((card, i) => parseWhiteCard(card, `${file}: white[${i}]`)),
	];
	if (cards.length === 0) {
		throw new PackError(`${file}: the pack has no cards`);
	}

	return {
		name: name.trim(),
		description: description || undefined,
		default: isDefault ?? false,
		cards,
		source: file,
	};
}

// Expands directories to the *.json files in them (sorted, not recursive)
function resolvePackFiles(paths: string[]): string[] {
	const files: string[] = [];
	for (const p of paths) {
		if (!fs.existsSync(p)) {
			throw new PackError(`${p}: no such file or directory`);
		}
		if (fs.statSync(p).isDirectory()) {
			files.push(...fs.readdirSync(p)
				.filter(f => f.toLowerCase().endsWith('.json'))
				.sort()
				.map(f => path.join(p, f)));
		} else {
			files.push(p);
		}
	}
	return files;
}

function collectDecks(paths: string[]): DeckImport[] {
	if (paths.length === 0) {
		if (!fs.existsSync(PACKS_DIR)) {
			return [];
		}
		paths = [PACKS_DIR];
	}
	const decks = resolvePackFiles(paths).map(parsePackFile);

	// Decks are matched by name, so two packs with one name would replace each other
	const seen = new Map<string, string>();
	for (const deck of decks) {
		const other = seen.get(deck.name);
		if (other) {
			throw new PackError(`Deck name "${deck.name}" is used by both ${other} and ${deck.source}`);
		}
		seen.set(deck.name, deck.source);
	}
	return decks;
}

async function importCards(force: boolean, paths: string[]) {
	// Read and check every file before touching the database
	const decks = collectDecks(paths);
	if (decks.length === 0) {
		console.log('No packs found');
		return;
	}

	console.log(`Importing ${decks.length} deck${decks.length === 1 ? '' : 's'}...`);

	ensureDatabaseUrl();
	const db = new PrismaClient();
	try {
		// One transaction: either every deck change is applied, or none is.
		await db.$transaction(async (tx) => {
			for (const deck of decks) {
				const existing = await tx.cardDeck.findMany({
					where: { ownerUUID: SYSTEM_OWNER, name: deck.name },
					select: { id: true },
				});

				if (existing.length > 0) {
					if (!force) {
						console.log(`Skipped "${deck.name}": already imported (use --force to replace it)`);
						continue;
					}
					// Cards are removed with their deck (ON DELETE CASCADE)
					await tx.cardDeck.deleteMany({
						where: { id: { in: existing.map(d => d.id) } },
					});
					console.log(`Removed ${existing.length} existing cop${existing.length === 1 ? 'y' : 'ies'} of "${deck.name}"`);
				}

				await tx.cardDeck.create({
					data: {
						name: deck.name,
						description: deck.description,
						ownerUUID: SYSTEM_OWNER,
						default: deck.default,
						public: true,
						cards: {
							createMany: {
								data: deck.cards,
							}
						}
					}
				});
				console.log(`Imported "${deck.name}" (${deck.cards.length} card${deck.cards.length === 1 ? '' : 's'}) from ${deck.source}`);
			}
		}, { timeout: 60_000 });
	} finally {
		await db.$disconnect();
	}
	console.log('Done');
}

const { force, paths } = parseArgs(process.argv.slice(2));
importCards(force, paths).catch((error) => {
	if (error instanceof PackError) {
		console.error(`Card import failed: ${error.message}`);
	} else {
		console.error('Card import failed:', error);
	}
	process.exit(1);
});
