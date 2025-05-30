require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { setupSocket } = require('./sockets/retellSocket');
const triggerRetellRoute = require('./routes/triggerRetell');
const retellWebhookRoute = require('./routes/retellWebhook');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// Web routes
app.get('/', (_, res) => res.send('Nexella AI Server is live!'));
app.use('/trigger-retell-call', triggerRetellRoute);
app.use('/retell-webhook', retellWebhookRoute);

// Socket
setupSocket(wss);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});