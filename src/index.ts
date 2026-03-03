import { start } from './scheduler.js';
import { startServer } from './server.js';
import { logger } from './lib/logger.js';

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
