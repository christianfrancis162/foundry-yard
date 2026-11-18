// Foundry Yard — a make.fun best-game-01 entry (Node 22, standard library only).
// The game is this directory's game/ folder: plain static files the browser loads as
// ES modules, with three.js from an import map pointing at ./vendor/three/.
// This program hands the game in: it copies game/ and screenshots/ from beside this
// file to /output and writes /output/dossier.json, the summary the judge reads,
// using the vendored make.fun library.
//
// Foundry Yard is a round-based tactical first-person shooter in the browser: a
// 36 x 30 m outdoor map with two bombsites, three lanes and a mid doorway. You and
// two teammates face three enemy bots. Red attacks a bombsite — stop the plant, or
// defuse the bomb. First to 5 round wins takes the match. Buy weapons between
// rounds, throw grenades, and use the shotgun up close.
//
// Put your PNG or JPEG screenshots in screenshots/ (the first by name is the cover)
// and run it.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(here, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes;
// the others refuse an entry the scorer would refuse (more than 4 screenshots or one
// over 256 KiB; more than 993 files in game/ or 48 MiB of game files, in all: game/
// counts beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
