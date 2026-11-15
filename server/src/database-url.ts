/**
 * Sets DATABASE_URL from MYSQL_PASSWORD (and optional MYSQL_USER, MYSQL_HOST,
 * MYSQL_PORT, MYSQL_DATABASE) when DATABASE_URL is not set, as in the Docker setup.
 * The user name and password are percent-encoded, so they may contain characters
 * such as @, /, # or % that would otherwise break the URL.
 * An explicit DATABASE_URL always wins.
 */
export function ensureDatabaseUrl(): void {
	if (process.env.DATABASE_URL || !process.env.MYSQL_PASSWORD) return;

	const user = encodeURIComponent(process.env.MYSQL_USER || 'kpl');
	const password = encodeURIComponent(process.env.MYSQL_PASSWORD);
	const host = process.env.MYSQL_HOST || 'db';
	const port = process.env.MYSQL_PORT || '3306';
	const database = process.env.MYSQL_DATABASE || 'kpl';

	process.env.DATABASE_URL = `mysql://${user}:${password}@${host}:${port}/${database}`;
}
