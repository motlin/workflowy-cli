#!/usr/bin/env node
import {setDefaultAutoSelectFamily} from 'node:net';
import {execute} from '@oclif/core';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

// Disable Happy Eyeballs (RFC 8305) auto-selection between IPv4/IPv6.
// Node.js's implementation has a race condition that produces transient
// EBADF errors when the algorithm closes a socket mid-connect.
// See: https://github.com/nodejs/node/issues/54359
setDefaultAutoSelectFamily(false);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPackageDir = join(__dirname, '..', 'packages', 'cli');

await execute({
	development: false,
	dir: cliPackageDir,
});
