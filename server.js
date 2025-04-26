import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import axios from 'axios';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/', (req, res) => {
  res.send('Nexella WebSocket Server is live.');
});

wss.on('connection', (ws) => {
  console.log('Retell connected via WebSocket.');

  ws.send(JSON.stringify({
    text: "Hi there! Thank you for calling Nexella AI. How are you doing today?",
    actions: []
  }));

  ws.on('message', async (data) => {
    try {
      const parsed = JSON.parse(data);
      const userMessage = parsed.text;

      console.log('User said:', userMessage);

      const openaiResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `You are a customer service and sales representative for Nexella.io. 
You are friendly, persuasive, and build rapport with the client. Match their tone naturally. 
Extract information about their business, and encourage them to book a call with Nexella.

Ask these questions:
- How did you hear about us?
- What line of business are you in? What's your business model?
- What's your main product you sell, and what's your typical price point?
- Are you running any ads? (Meta, Google, TikTok?)
- Are you using any CRM like GoHighLevel?
- What problems are you running into?

When they mention problems, reassure them that Nexella can solve those issues.

Key selling points:
- 24/7 SMS and voice AI agents
- Automatic appointment booking
- Lightning fast lead response
- Easy CRM integration
- Supports inbound and outbound calls
- Free Caller ID import

Answer FAQs confidently:
- Response time: Immediate or with customizable delay.
- Lead qualification: We customize questions to qualify leads.
- Support: Email, platform chat, or Slack for some plans.
- Cancel anytime.
- Seamless integration with CRMs and tools.
- No need to bring your own Twilio.
- Nexella is perfect for sales AND customer support.

Always compliment the client and encourage them to book a call excitedly.`
            },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.5
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const botReply = openaiResponse.data.choices[0].message.content;

      const retellResponse = {
        text: botReply,
        actions: []
      };

      ws.send(JSON.stringify(retellResponse));
      console.log('Bot replied:', botReply);
    } catch (error) {
      console.error('Error handling message:', error.message);
      ws.close();
    }
  });

  ws.on('close', () => {
    console.log('Retell WebSocket disconnected.');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Nexella WebSocket Server is listening on port ${PORT}`);
});
