const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/', (req, res) => {
  res.send('Nexella WebSocket Server with staged discovery and contact collection is live!');
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
- Wait for the user's answer before asking the next question.
- Build a back-and-forth conversation, not a checklist.
- Acknowledge and respond to user answers briefly to sound human.
- Always lead the user towards booking a call with us.
- First ask questions about their business, then ask for contact info.
- After collecting contact info, confirm the booking.

FAQ Knowledge:
- Our AI Systems respond immediately or with a customizable delay.
- We qualify leads using any set of questions you provide.
- Appointments are automatically booked into your calendar.
- Nexella AI supports inbound and outbound voice and SMS calls.
- We integrate easily with CRMs like GoHighLevel and others.
- Caller ID import is free.
- Comprehensive email and Slack support available.

If the user asks a question about Nexella services, politely answer based on the FAQ Knowledge above. Otherwise, continue guiding them to provide their name, email, phone, and preferred time.
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
  let leadSubmitted = false;

  const webhookURL = 'https://hook.us2.make.com/6wsdtorhmrpxbical1czq09pmurffoei';

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
      content: "Hi there! Thanks for calling Nexella. How’s your day going?",
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

        // Determine what information is missing and ask relevant questions
        if (!userInfo.name) {
          botReply = "Thanks for reaching out! May I have your name, please?";
          currentStep = 'name';
        } else if (!userInfo.email) {
          botReply = "Got it! What's the best email to reach you?";
          currentStep = 'email';
        } else if (!userInfo.phone) {
          botReply = "Great, and what's your best phone number?";
          currentStep = 'phone';
        } else if (!userInfo.time) {
          botReply = "Thanks! When would you prefer to schedule a call? Maybe today or tomorrow afternoon?";
          currentStep = 'time';
        } else if (!leadSubmitted) {
          botReply = `Thanks ${userInfo.name}! I'll get you booked for a call. You'll receive a confirmation shortly.`;
          currentStep = 'done';
          leadSubmitted = true;

          console.log('Collected lead info:', userInfo);

          // POST collected lead to Make.com Webhook
          try {
            await axios.post(webhookURL, {
              name: userInfo.name,
              email: userInfo.email,
              phone: userInfo.phone,
              time: userInfo.time
            });
            console.log('Lead sent to Make.com successfully!');
          } catch (err) {
            console.error('Error sending lead to Make.com:', err.message);
          }
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
  console.log(`Nexella WebSocket Server with staged discovery and contact collection is listening on port ${PORT}`);
});
