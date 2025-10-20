'use strict';

const localtunnel = require('localtunnel');

function isDisabled() {
  return process.env.GPT_CAR_DISABLE_TUNNEL === '1';
}

async function startTunnel({ port, logger = console } = {}) {
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('startTunnel: port must be a positive integer');
  }

  if (isDisabled()) {
    logger?.info?.('Public tunnel disabled via GPT_CAR_DISABLE_TUNNEL=1');
    return null;
  }

  const host = process.env.GPT_CAR_TUNNEL_SERVICE;
  const localHost = process.env.GPT_CAR_TUNNEL_LOCALHOST;
  const subdomain = process.env.GPT_CAR_TUNNEL_SUBDOMAIN;

  const tunnel = await localtunnel({
    port,
    host,
    local_host: localHost,
    subdomain,
  });

  logger?.info?.(`Public tunnel connected: ${tunnel.url}`);

  return {
    url: tunnel.url,
    close: () => tunnel.close(),
  };
}

module.exports = {
  startTunnel,
};
