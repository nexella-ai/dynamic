const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/', (req, res) => {
  res.send('Nexella WebSocket Server with memory + lead collection is live!');
});

wss.on('connection', (ws) => {
  console.log('Retell connected via WebSocket.');

  let conversationHistory = [
    {
      role: 'system',
      content: `You are a customer service/sales representative for Nexella.io. 
You must sound friendly, relatable, and build rapport naturally. Match their language style. Compliment them genuinely.

IMPORTANT:
- Ask ONE question at a time.
- Greet them first, build rapport before asking for their information.
- Ask for their name, and then start asking about what type of business they are in.
- Ask if they are running ads, and what type of problems they are running into.
- Store and remember this information, let them know Nexella is a great fit for their situation.
- Let them know they are very smart for wanting to work with us.
- Wait for the user's answer before asking the next question.
- Build a back-and-forth conversation, not a checklist.
- Acknowledge and respond to user answers briefly to sound human.
- Always lead the user towards booking a call with us.
- If the user's name, email, phone number, or preferred call time are missing, politely collect them before ending the call.
`
    }
  ];

  let userInfo = {
    name: null,
    email: null,
    phone: null,
    time: null
  };

  let currentStep = null;

  // Dummy "connecting..." message first
  ws.send(JSON.stringify({
    content: "connecting...",
    content_complete: true,
    actions: [],
    response_id: 0
  }));

  // Greeting after slight delay
  setTimeout(() => {
    ws.send(JSON.stringify({
      content: "Hi there! Thank you for calling Nexella AI. How are you doing today?",
      content_complete: true,
      actions: [],
      response_id: 1
    }));
  }, 2500);

  ws.on('message', async (data) => {
    try {
      const parsed = JSON.parse(data);

      if (parsed.interaction_type === 'response_required') {
        const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
        const userMessage = latestUserUtterance?.content || "";

        console.log('User said:', userMessage);

        conversationHistory.push({ role: 'user', content: userMessage });

        // Simple keyword matching to fill userInfo
        if (!userInfo.name && userMessage.match(/^[a-zA-Z]{2,}(\s[a-zA-Z]{2,})?$/)) {
          userInfo.name = userMessage.trim();
        } else if (!userInfo.email && userMessage.includes('@')) {
          userInfo.email = userMessage.trim();
        } else if (!userInfo.phone && userMessage.replace(/[^0-9]/g, '').length >= 10) {
          userInfo.phone = userMessage.replace(/[^0-9]/g, '');
        } else if (!userInfo.time && (userMessage.includes('today') || userMessage.includes('tomorrow') || userMessage.match(/\d/))) {
          userInfo.time = userMessage.trim();
        }

        let botReply = "";

        if (!userInfo.name) {
          botReply = "By the way, may I have your name please?";
          currentStep = 'name';
        } else if (!userInfo.email) {
          botReply = "Thanks! What's the best email address to reach you?";
          currentStep = 'email';
        } else if (!userInfo.phone) {
          botReply = "Got it — and what's your best phone number?";
          currentStep = 'phone';
        } else if (!userInfo.time) {
          botReply = "Awesome — when would you prefer to schedule a call? (Today or tomorrow?)";
          currentStep = 'time';
        } else {
          botReply = `Thank you ${userInfo.name}! I'll get you booked for a call. You'll receive an email shortly with the confirmation.`;
          currentStep = 'done';
          // Here is where you would trigger Calendly API booking with userInfo
          console.log('Collected lead info:', userInfo);
        }

        conversationHistory.push({ role: 'assistant', content: botReply });

        ws.send(JSON.stringify({
          content: botReply,
          content_complete: true,
          actions: [],
          response_id: parsed.response_id
        }));
      }

    } catch (error) {
      console.error('Error handling message:', error.message);
      ws.send(JSON.stringify({
        content: "I'm sorry, could you say that again please?",
        content_complete: true,
        actions: [],
        response_id: 9999
      }));
    }
  });

  ws.on('close', () => {
    console.log('Connection closed.');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Nexella WebSocket Server with memory + collection is listening on port ${PORT}`);
});
