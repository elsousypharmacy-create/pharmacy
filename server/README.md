# server/

- `src/NN_name.js` — the real source, split by topic. **Edit these.** Load order = `files.json` (file-name order). `00_config.js` must stay first (`secret_` is called eagerly by top-level vars).
- `Code.js` — GENERATED single-file bundle of `src/`. Do not edit by hand. The live updater (`serverUpdate`) fetches only this file from `main`.
- After editing `src/`: `node tools/build-server.js` (and `--check` to confirm it is current).
- `tools/verify-split.js <old Code.js> <acorn path>` proves the bundle is equivalent to a given single-file original.
