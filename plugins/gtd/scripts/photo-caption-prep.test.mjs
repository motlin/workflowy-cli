// Run: node --test plugins/gtd/scripts/photo-caption-prep.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
	buildExportAppleScript,
	buildManifest,
	facesQuery,
	favoritesQuery,
	groupFaces,
	planSources,
} from './photo-caption-prep.mjs';

test('favoritesQuery selects uncaptioned, untrashed, visible favorite photos within the window', () => {
	assert.strictEqual(
		favoritesQuery(14),
		"SELECT A.ZUUID AS uuid, datetime(A.ZDATECREATED+978307200,'unixepoch','localtime') AS created, A.ZDIRECTORY AS directory, A.ZFILENAME AS filename, COALESCE(B.ZORIGINALFILENAME,'') AS originalFilename FROM ZASSET A LEFT JOIN ZADDITIONALASSETATTRIBUTES B ON A.Z_PK=B.ZASSET WHERE A.ZFAVORITE=1 AND A.ZTRASHEDSTATE=0 AND A.ZHIDDEN=0 AND A.ZKIND=0 AND A.ZDATECREATED > strftime('%s','now','-14 days')-978307200 AND COALESCE(B.ZTITLE,'')='' AND COALESCE(B.ZACCESSIBILITYDESCRIPTION,'')='' ORDER BY A.ZDATECREATED DESC;",
	);
});

test('favoritesQuery rejects a non-integer window so nothing is interpolated into SQL', () => {
	assert.throws(() => favoritesQuery('14; DROP TABLE ZASSET'), /positive integer/);
	assert.throws(() => favoritesQuery(0), /positive integer/);
});

test('facesQuery lists every detected face for the given uuids with its person name', () => {
	assert.strictEqual(
		facesQuery(['AAA', 'BBB']),
		"SELECT A.ZUUID AS uuid, COALESCE(NULLIF(P.ZFULLNAME,''),'') AS name FROM ZASSET A JOIN ZDETECTEDFACE F ON F.ZASSETFORFACE=A.Z_PK LEFT JOIN ZPERSON P ON F.ZPERSONFORFACE=P.Z_PK WHERE A.ZUUID IN ('AAA','BBB');",
	);
});

test('facesQuery rejects uuids that are not uuid-shaped', () => {
	assert.throws(() => facesQuery(["x') OR 1=1 --"]), /Invalid uuid/);
});

test('groupFaces splits named people from the unnamed face count per uuid', () => {
	assert.deepStrictEqual(
		groupFaces([
			{uuid: 'AAA', name: 'Alice'},
			{uuid: 'AAA', name: ''},
			{uuid: 'AAA', name: 'Bob'},
			{uuid: 'AAA', name: 'Alice'},
			{uuid: 'BBB', name: ''},
		]),
		{
			AAA: {named: ['Alice', 'Bob'], unnamed: 1},
			BBB: {named: [], unnamed: 1},
		},
	);
});

test('planSources splits favorites into local originals and iCloud-only ones', () => {
	const favorites = [
		{
			uuid: 'AAA',
			created: '2026-09-21 16:18:00',
			directory: 'A',
			filename: 'AAA.heic',
			originalFilename: 'IMG_1.HEIC',
		},
		{
			uuid: 'BBB',
			created: '2026-09-12 20:05:00',
			directory: 'B',
			filename: 'BBB.heic',
			originalFilename: 'IMG_2.HEIC',
		},
	];
	const exists = (path) => path === '/lib/originals/A/AAA.heic';
	assert.deepStrictEqual(planSources(favorites, '/lib', exists), {
		local: [{...favorites[0], originalPath: '/lib/originals/A/AAA.heic'}],
		icloud: [favorites[1]],
	});
});

test('buildExportAppleScript exports each uuid into its own subfolder so files map back by uuid', () => {
	assert.deepStrictEqual(buildExportAppleScript(['AAA', 'BBB']), [
		'on run argv',
		'set outDir to item 1 of argv',
		'set ids to {"AAA", "BBB"}',
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
	]);
});

test('buildManifest records source, view path, and faces, and counts what is still unviewable', () => {
	const local = [
		{
			uuid: 'AAA',
			created: '2026-09-21 16:18:00',
			originalFilename: 'IMG_1.HEIC',
			originalPath: '/lib/originals/A/AAA.heic',
		},
	];
	const icloud = [
		{uuid: 'BBB', created: '2026-09-12 20:05:00', originalFilename: 'IMG_2.HEIC'},
		{uuid: 'CCC', created: '2026-09-11 17:49:00', originalFilename: 'IMG_3.HEIC'},
	];
	const views = {AAA: '/out/view/AAA.jpg', BBB: '/out/view/BBB.jpg'};
	const faces = {AAA: {named: ['Alice'], unnamed: 2}};
	assert.deepStrictEqual(buildManifest({local, icloud, views, faces}), {
		total: 3,
		viewable: 2,
		unviewable: 1,
		photos: [
			{
				uuid: 'AAA',
				created: '2026-09-21 16:18:00',
				originalFilename: 'IMG_1.HEIC',
				source: 'local',
				viewPath: '/out/view/AAA.jpg',
				faces: {named: ['Alice'], unnamed: 2},
			},
			{
				uuid: 'BBB',
				created: '2026-09-12 20:05:00',
				originalFilename: 'IMG_2.HEIC',
				source: 'icloud',
				viewPath: '/out/view/BBB.jpg',
				faces: {named: [], unnamed: 0},
			},
			{
				uuid: 'CCC',
				created: '2026-09-11 17:49:00',
				originalFilename: 'IMG_3.HEIC',
				source: 'icloud',
				viewPath: null,
				faces: {named: [], unnamed: 0},
			},
		],
	});
});
