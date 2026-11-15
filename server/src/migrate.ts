// Applies pending Prisma migrations, building DATABASE_URL first if needed (see database-url.ts).
import { execFileSync } from 'child_process';
import { ensureDatabaseUrl } from './database-url.js';

ensureDatabaseUrl();
execFileSync('./node_modules/.bin/prisma', ['migrate', 'deploy'], { stdio: 'inherit' });
