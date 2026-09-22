/**
 * Side-effect module: loads `.env` into `process.env` before any command
 * module runs.
 *
 * This is a standalone module (rather than a `config({ quiet: true })` call
 * inline in `cli.ts`) because ESM evaluates every import before the
 * importing module's own body executes. A call placed in `cli.ts`'s body
 * would run AFTER every `import './commands/*.js'` above it has already
 * loaded, so any module reading `process.env` at load time would see it
 * unset. Importing this module instead ('./loadEnv.js') preserves the
 * load-before-use ordering that `import 'dotenv/config'` provided.
 */
import { config } from 'dotenv';

config({ quiet: true });
