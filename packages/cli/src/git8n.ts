#!/usr/bin/env node
import { main } from '@git8n/mcp/cli/node';
import manifest from '../package.json' with { type: 'json' };

await main(manifest.version);
