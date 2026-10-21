/**
 * Starts the API unconditionally — the entry point for process managers.
 *
 * server.ts starts itself only when it is the script Node was given, so tests
 * can import it. PM2 loads scripts through its own wrapper, which makes that
 * check fail: the process stays "online" without ever listening. PM2 runs this
 * file instead (ecosystem.config.cjs).
 */
import { main } from './server.js';

void main();
