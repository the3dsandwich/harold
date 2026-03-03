import { setGlobalDispatcher, Agent } from 'undici';
import { start } from './scheduler.js';
import { startServer } from './server.js';
import { logger } from './lib/logger.js';

// Force IPv4 at the socket level — undici's happy eyeballs tries IPv4+IPv6
// simultaneously, and in containers without IPv6 routing both attempts time out.
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

logger.info('harold', 'starting up');
start();
startServer();
logger.info('harold', 'all jobs registered — waiting for triggers');

process.on('SIGTERM', () => {
  logger.info('harold', 'received SIGTERM — shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('harold', 'received SIGINT — shutting down');
  process.exit(0);
});
