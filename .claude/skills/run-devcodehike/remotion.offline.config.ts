// Copy of the project's remotion.config.ts plus one alias: `twoslash-cdn` ->
// twoslash-shim.mjs, so renders work without access to playgroundcdn.typescriptlang.org.
// Keep in sync with ../../../remotion.config.ts if that file changes.
import {Config} from '@remotion/cli/config';
import {createRequire} from 'node:module';
import path from 'node:path';

const projectRequire = createRequire(process.cwd() + '/package.json');
const shim = path.resolve(process.cwd(), '.claude/skills/run-devcodehike/twoslash-shim.mjs');

Config.setRspack(true);
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);

Config.overrideRspackConfig((config) => {
	return {
		...config,
		resolve: {
			...config.resolve,
			alias: {
				...config.resolve?.alias,
				'@code-hike/lighter': projectRequire.resolve(
					'@code-hike/lighter/dist/index.esm.mjs',
				),
				'twoslash-cdn$': shim,
				https: false,
			},
		},
		ignoreWarnings: [
			...(config.ignoreWarnings ?? []),
			/Critical dependency: the request of a dependency is an expression/,
		],
	};
});
