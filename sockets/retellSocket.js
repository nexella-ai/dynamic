const { handleWebSocketConnection } = require('./retellSocketHandler');

function setupSocket(wss) {
  wss.on('connection', handleWebSocketConnection);
  wss.on('error', (err) => console.error('WebSocket error:', err));
}

module.exports = { setupSocket };