import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import { ensureDatabaseUrl } from '../src/database-url.js';

// Usage: inport-legacy-cards [--force]
// Without --force, decks that already exist are skipped.
// With --force, existing decks are deleted (with their cards) and imported again.
const USAGE = 'Usage: inport-legacy-cards [--force]';
const SYSTEM_OWNER = 'system';


type LegacyBlackCard = {
	id: number;
	text: string;
	pick: number;
	source?: string;
};

type LegacyWhiteCard = {
	id: number;
	text: string;
	source?: string;
	tooltip?: string;
};

type CardImport = {
	text: string;
	tip?: string;
	pick: number;
}

function convertLegacyBlackCard(legacyCard: LegacyBlackCard): CardImport {
	return {
		text: legacyCard.text,
		pick: legacyCard.pick,
	};
}

function convertLegacyWhiteCard(legacyCard: LegacyWhiteCard): CardImport {
	return {
		text: legacyCard.text,
		tip: legacyCard.tooltip,
		pick: 0,
	};
}

function parseArgs(args: string[]): { force: boolean } {
	let force = false;
	for (const arg of args) {
		if (arg === '--force') {
			force = true;
		} else {
			console.error(`Unknown argument: ${arg}\n${USAGE}`);
			process.exit(1);
		}
	}
	return { force };
}

async function importCards(force: boolean) {
	console.log('Importing legacy cards...');

	const black_cards = JSON.parse(fs.readFileSync( 'legacy/black_cards.json', 'utf8'));
	const white_cards = JSON.parse(fs.readFileSync('legacy/white_cards.json', 'utf8'));


	let packOriginal: CardImport[] = [];
	let packOriginalCommunity: CardImport[] = [];

	white_cards.forEach((card: LegacyWhiteCard) => {
		const cardImport = convertLegacyWhiteCard(card);
		if (card.source) {
			packOriginalCommunity.push(cardImport);
		} else {
			packOriginal.push(cardImport);
		}
	});

	black_cards.forEach((card: LegacyBlackCard) => {
		const cardImport = convertLegacyBlackCard(card);
		if (card.source) {
			packOriginalCommunity.push(cardImport);
		} else {
			packOriginal.push(cardImport);
		}
	});


	const decks = [
		{
			name: 'KPL Online - Original (2018)',
			description: 'Původní balíček karet použitý při prvním spuštění KPL Online v roce 2018',
			cards: packOriginal,
		},
		{
			name: 'KPL Online - Community (2021)',
			description: 'Rozšíření balíčku karet na základě návrhů komunity v roce 2021',
			cards: packOriginalCommunity,
		},
	];

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
						default: true,
						public: true,
						cards: {
							createMany: {
								data: deck.cards,
							}
						}
					}
				});
				console.log(`Imported "${deck.name}" (${deck.cards.length} cards)`);
			}
		}, { timeout: 60_000 });
	} finally {
		await db.$disconnect();
	}
	console.log('Done');
}

const { force } = parseArgs(process.argv.slice(2));
importCards(force).catch((error) => {
	console.error('Card import failed:', error);
	process.exit(1);
});
