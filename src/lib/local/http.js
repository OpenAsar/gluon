import { createServer } from 'node:http';
import createLocalFulfill from './fulfill.js';
import { log } from '../logger.js';

export default async ({ url: givenPath, localUrl }) => {
  const localFulfill = createLocalFulfill(givenPath);

  const port = parseInt(localUrl.split(':').pop());
  const server = createServer(async (req, res) => {
    const { status, body, headers } = await localFulfill(localUrl + decodeURI(req.url));

    res.writeHead(status, headers);
    res.end(body, 'utf8');
  }).listen(port, '127.0.0.1');

  log('local setup');

  return () => server.close();
};