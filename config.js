module.exports = {
  TRIGGER_SERVER_URL: process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com',
  N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL || 'https://n8n-clp2.onrender.com/webhook/retell-scheduling',
  RETELL_API_KEY: process.env.RETELL_API_KEY,
  RETELL_AGENT_ID: process.env.RETELL_AGENT_ID
};