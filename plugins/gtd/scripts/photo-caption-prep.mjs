#!/usr/bin/env node
// Stage recent uncaptioned favorite photos for the "Add captions to favorite
// photos" review item, so Claude can Read every image before proposing a caption.
//
// Favorites whose originals are on disk convert straight to a viewable JPEG.
// iCloud-optimized favorites (no local original) are exported through Photos,
// which is slow (minutes), so launch this in the background before the walk
// rather than skipping them.
//
// Usage:
//   node plugins/gtd/scripts/photo-caption-prep.mjs [--days 14] [--out .llm/gtd/photo-captions]
//   node plugins/gtd/scripts/photo-caption-prep.mjs --count-only [--days 14]
//
// Full run writes <out>/manifest.json and prints
//   total=<n> viewable=<n> unviewable=<n> manifest=<path>
// --count-only re-reads a fresh DB copy and prints remaining=<n>: the number of
// favorites in the window that still have no caption.

import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';

const UUID_RE = /^[0-9A-Fa-f-]+$/;

export function favoritesQuery(days) {
	if (!Number.isInteger(days) || days < 1) throw new Error(`days must be a positive integer, got ${days}`);
	return (
		"SELECT A.ZUUID AS uuid, datetime(A.ZDATECREATED+978307200,'unixepoch','localtime') AS created, A.ZDIRECTORY AS directory, A.ZFILENAME AS filename, COALESCE(B.ZORIGINALFILENAME,'') AS originalFilename" +
		' FROM ZASSET A LEFT JOIN ZADDITIONALASSETATTRIBUTES B ON A.Z_PK=B.ZASSET' +
		' WHERE A.ZFAVORITE=1 AND A.ZTRASHEDSTATE=0 AND A.ZHIDDEN=0 AND A.ZKIND=0' +
		` AND A.ZDATECREATED > strftime('%s','now','-${days} days')-978307200` +
		" AND COALESCE(B.ZTITLE,'')='' AND COALESCE(B.ZACCESSIBILITYDESCRIPTION,'')=''" +
		' ORDER BY A.ZDATECREATED DESC;'
	);
}

export function facesQuery(uuids) {
	for (const uuid of uuids) {
		if (!UUID_RE.test(uuid)) throw new Error(`Invalid uuid: ${uuid}`);
	}
	const list = uuids.map((uuid) => `'${uuid}'`).join(',');
	return (
		"SELECT A.ZUUID AS uuid, COALESCE(NULLIF(P.ZFULLNAME,''),'') AS name" +
		' FROM ZASSET A JOIN ZDETECTEDFACE F ON F.ZASSETFORFACE=A.Z_PK LEFT JOIN ZPERSON P ON F.ZPERSONFORFACE=P.Z_PK' +
		` WHERE A.ZUUID IN (${list});`
	);
}

export function groupFaces(rows) {
	const byUuid = {};
	for (const {uuid, name} of rows) {
		const entry = (byUuid[uuid] ??= {named: [], unnamed: 0});
		if (!name) entry.unnamed += 1;
		else if (!entry.named.includes(name)) entry.named.push(name);
	}
	return byUuid;
}

export function facesSummary({named, unnamed}) {
	if (named.length === 0 && unnamed === 0) return 'No faces detected.';
	const tagged = `Tagged: ${named.length > 0 ? named.join(', ') : 'nobody'}.`;
	if (unnamed === 0) return tagged;
	return `${tagged} ${unnamed} untagged face${unnamed === 1 ? '' : 's'}, ready to tag in Photos.`;
}

export function planSources(favorites, libraryPath, exists) {
	const local = [];
	const icloud = [];
	for (const favorite of favorites) {
		const originalPath = join(libraryPath, 'originals', favorite.directory, favorite.filename);
		if (exists(originalPath)) local.push({...favorite, originalPath});
		else icloud.push(favorite);
	}
	return {local, icloud};
}

// Photos' `whose` filter is lazy; `get` forces the list so `count` and `export`
// see real items (the -1728 rule). Each uuid lands in its own folder because
// Photos names exports IMG_xxxx, which can't be mapped back otherwise.
export function buildExportAppleScript(uuids) {
	const ids = uuids.map((uuid) => `"${uuid}"`).join(', ');
	return [
		'on run argv',
		'set outDir to item 1 of argv',
		`set ids to {${ids}}`,
		'set okCount to 0',
		'tell application "Photos"',
		'repeat with i in ids',
		'set u to (i as string)',
		'try',
		'with timeout of 600 seconds',
		'set m to (get every media item whose id is (u & "/L0/001"))',
		'if (count of m) > 0 then',
		'export m to POSIX file (outDir & "/" & u)',
		'set okCount to okCount + 1',
		'log ("exported " & u)',
		'else',
		'log ("missing " & u)',
		'end if',
		'end timeout',
		'on error e',
		'log ("failed " & u & ": " & e)',
		'end try',
		'end repeat',
		'end tell',
		'return okCount',
		'end run',
	];
}

export function buildManifest({local, icloud, views, faces}) {
	const toEntry = (favorite, source) => {
		const photoFaces = faces[favorite.uuid] ?? {named: [], unnamed: 0};
		return {
			uuid: favorite.uuid,
			created: favorite.created,
			originalFilename: favorite.originalFilename,
			source,
			viewPath: views[favorite.uuid] ?? null,
			faces: photoFaces,
			facesSummary: facesSummary(photoFaces),
		};
	};
	const photos = [...local.map((f) => toEntry(f, 'local')), ...icloud.map((f) => toEntry(f, 'icloud'))];
	const viewable = photos.filter((p) => p.viewPath).length;
	return {total: photos.length, viewable, unviewable: photos.length - viewable, photos};
}

function parseArgs(argv) {
	const args = {days: 14, out: '.llm/gtd/photo-captions', countOnly: false};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--days') args.days = Number(argv[++i]);
		else if (argv[i] === '--out') args.out = argv[++i];
		else if (argv[i] === '--count-only') args.countOnly = true;
		else throw new Error(`Unknown argument: ${argv[i]}`);
	}
	return args;
}

function copyDatabase(libraryPath, outDir) {
	const target = join(outDir, 'photos-ro.sqlite');
	for (const suffix of ['-wal', '-shm']) rmSync(target + suffix, {force: true});
	const source = join(libraryPath, 'database', 'Photos.sqlite');
	copyFileSync(source, target);
	for (const suffix of ['-wal', '-shm']) {
		if (existsSync(source + suffix)) copyFileSync(source + suffix, target + suffix);
	}
	return target;
}

function sqliteJson(dbPath, sql) {
	const result = spawnSync('sqlite3', ['-readonly', '-json', dbPath, sql], {encoding: 'utf8'});
	if (result.status !== 0) throw new Error(`sqlite3 failed: ${result.stderr}`);
	return result.stdout.trim() ? JSON.parse(result.stdout) : [];
}

function toViewJpeg(source, viewPath) {
	const result = spawnSync('sips', ['-s', 'format', 'jpeg', '-Z', '900', source, '--out', viewPath], {
		encoding: 'utf8',
	});
	return result.status === 0 && existsSync(viewPath);
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const libraryPath = join(homedir(), 'Pictures', 'Photos Library.photoslibrary');
	const outDir = resolve(args.out);
	mkdirSync(outDir, {recursive: true});

	const dbPath = copyDatabase(libraryPath, outDir);
	const favorites = sqliteJson(dbPath, favoritesQuery(args.days));
	if (args.countOnly) {
		process.stdout.write(`remaining=${favorites.length}\n`);
		return;
	}

	const viewDir = join(outDir, 'view');
	const exportDir = join(outDir, 'export');
	rmSync(viewDir, {recursive: true, force: true});
	rmSync(exportDir, {recursive: true, force: true});
	mkdirSync(viewDir, {recursive: true});

	const {local, icloud} = planSources(favorites, libraryPath, existsSync);
	const views = {};
	for (const favorite of local) {
		const viewPath = join(viewDir, `${favorite.uuid}.jpg`);
		if (toViewJpeg(favorite.originalPath, viewPath)) views[favorite.uuid] = viewPath;
	}

	if (icloud.length > 0) {
		for (const favorite of icloud) mkdirSync(join(exportDir, favorite.uuid), {recursive: true});
		const script = buildExportAppleScript(icloud.map((f) => f.uuid)).flatMap((line) => ['-e', line]);
		const result = spawnSync('osascript', [...script, exportDir], {encoding: 'utf8'});
		writeFileSync(
			join(outDir, 'export.log'),
			`${result.stderr}exit=${result.status} exported=${result.stdout.trim()}\n`,
		);
		for (const favorite of icloud) {
			const folder = join(exportDir, favorite.uuid);
			const [file] = readdirSync(folder);
			const viewPath = join(viewDir, `${favorite.uuid}.jpg`);
			if (file && toViewJpeg(join(folder, file), viewPath)) views[favorite.uuid] = viewPath;
		}
	}

	const faces = favorites.length > 0 ? groupFaces(sqliteJson(dbPath, facesQuery(favorites.map((f) => f.uuid)))) : {};
	const manifest = buildManifest({local, icloud, views, faces});
	const manifestPath = join(outDir, 'manifest.json');
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	process.stdout.write(
		`total=${manifest.total} viewable=${manifest.viewable} unviewable=${manifest.unviewable} manifest=${manifestPath}\n`,
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
