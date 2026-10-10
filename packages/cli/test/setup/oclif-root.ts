import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {Command, type Interfaces} from '@oclif/core';

type Run = (this: unknown, argv?: string[], opts?: Interfaces.LoadOptions) => Promise<unknown>;

// Under vitest, require.main is unset, so Command.run falls back to @oclif/core's own package.json,
// whose oclif.devPlugins names @oclif/plugin-plugins and warns on every test that it cannot be found.
const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const originalRun = Reflect.get(Command, 'run') as Run;

Reflect.set(Command, 'run', function (this: unknown, argv?: string[], opts?: Interfaces.LoadOptions) {
	return originalRun.call(this, argv, opts ?? cliRoot);
} satisfies Run);
