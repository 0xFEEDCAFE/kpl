import { createAvatar } from '@dicebear/core';
import { dylan } from '@dicebear/collection';

// Avatars are generated locally, so no third-party service learns usernames or player IPs.
const cache = new Map<string, string>();

export function avatarFor(seed: string): string {
	let uri = cache.get(seed);
	if (!uri) {
		uri = createAvatar(dylan, { seed, mood: ['happy', 'hopeful', 'superHappy'] }).toDataUri();
		cache.set(seed, uri);
	}
	return uri;
}
