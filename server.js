const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/', (req, res) => {
  res.send('Nexella WebSocket Server is up and running!');
});

wss.on('connection', (ws) => {
  console.log('Retell connected via WebSocket.');

  ws.send(JSON.stringify({
    text: "Hi there! Thank you for calling Nexella AI. How are you doing today?",
    content_complete: true,
    actions: []
  }));

  ws.on('message', async (data) => {
    try {
      const parsed = JSON.parse(data);
      const userMessage = parsed.text;

      console.log('User said:', userMessage);

      if (!userMessage || userMessage.trim() === '') {
        console.log('Empty user message received, ignoring...');
        return;
      }

      // 🔥 Immediately respond to keep Retell alive
      setTimeout(() => {
        ws.send(JSON.stringify({
          text: "That's awesome! I'd love to hear more. Could you tell me what kind of business you run?",
          content_complete: true,
          actions: []
        }));
      }, 500);

      // Then work on OpenAI full response
      const openaiResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `You are a customer service/sales representative for Nexella.io. 
You are to answer any questions the client has and persuade them to book a call with us. 
You must sound friendly, relatable, and build rapport. Match their language style naturally. Compliment them genuinely.

Ask them these discovery questions:
- How did you hear about us?
- What line of business are you in? What's your business model?
- What's your main product you sell, and what's your typical price point?
- Are you running any ads? (Meta, Google, TikTok?)
- Are you using any CRM like GoHighLevel?
- What problems are you running into?

When they mention problems, reassure them that Nexella can solve their issues. Make them feel understood.

Highlight Nexella's selling points:
- 24/7 SMS and voice AI agents
- Immediate or delayed responses
- Automatic appointment booking to calendars
- Supports inbound and outbound calls
- CRM integrations available
- No need to bring Twilio — everything included
- Caller ID import is free
- Sales and Customer Support automation

If they ask FAQ questions:
- Our AI systems respond immediately or with a customizable delay.
- We qualify leads using any set of questions you provide.
- Comprehensive support via email, chat, and Slack (for some plans).
- Cancel anytime directly inside your account.
- Integration flexibility with CRMs and communication platforms.
- Supports inbound and outbound calling natively.

You must make the client feel excited and confident about working with Nexella.io. Your goal is to get them to book a call!`
            },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.5
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );

      const botReply = openaiResponse.data.choices[0].message.content || "Could you tell me a little more about your goals?";

      ws.send(JSON.stringify({
        text: botReply,
        content_complete: true,
        actions: []
      }));

    } catch (error) {
      console.error('Error handling message:', error.message);
      ws.send(JSON.stringify({
        text: "I'm sorry, I didn't catch that. Could you say that again please?",
        content_complete: true,
        actions: []
      }));
    }
  });

  ws.on('close', () => {
    console.log('Connection closed.');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Nexella WebSocket Server is listening on port ${PORT}`);
});
