const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/', (req, res) => {
  res.send('Nexella WebSocket Server with memory is live!');
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

DISCOVERY QUESTIONS:
- How did you hear about us?
- What line of business are you in? What's your business model?
- What's your main product and typical price point?
- Are you running ads (Meta, Google, TikTok)?
- Are you using a CRM like GoHighLevel?
- What problems are you running into?

When they mention a problem, reassure them that Nexella can help.

Highlight Nexella's features casually throughout the conversation:
- 24/7 SMS and voice AI agents
- Immediate response
- Calendar booking
- CRM integrations
- No Twilio needed
- Caller ID import
- Sales and Customer Support automation

Your main goal is to make the user feel understood and excited to book a call with Nexella.io.

AT THE END, after completing discovery questions:
- Ask the user politely: "When would you like to schedule your call with us?"
- Collect the **scheduled date** and **scheduled time** from their answer.
- Confirm the day and time back to them: "Just to confirm, you'd like [Day at Time], correct?"
- Once confirmed, send a structured JSON message with type 'collected_slot' containing:
    {
      "type": "collected_slot",
      "slots": {
        "date": "YYYY-MM-DD",
        "time": "HH:mm",
        "name": "user's name if available",
        "phone": "user's phone if available",
        "email": "user's email if available"
      }
    }
- This will trigger the booking automatically through Calendly.
`
    }
  ];

  // Dummy "connecting..." message first
  ws.send(JSON.stringify({
    content: "connecting...",
    content_complete: true,
    actions: [],
    response_id: 0
  }));

  // Real welcome greeting after 500ms
  setTimeout(() => {
    ws.send(JSON.stringify({
      content: "Hi there! Thank you for calling Nexella AI. How are you doing today?",
      content_complete: true,
      actions: [],
      response_id: 1
    }));
  }, 500);

  ws.on('message', async (data) => {
    try {
      const parsed = JSON.parse(data);

      if (parsed.interaction_type === 'response_required') {
        const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
        const userMessage = latestUserUtterance?.content || "";

        console.log('User said:', userMessage);

        // Save user's message to conversation history
        conversationHistory.push({ role: 'user', content: userMessage });

        const openaiResponse = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4o',
            messages: conversationHistory,
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

        const botReply = openaiResponse.data.choices[0].message.content || "Could you tell me a little more about your business?";

        // Save AI's reply to conversation history
        conversationHistory.push({ role: 'assistant', content: botReply });

        ws.send(JSON.stringify({
          content: botReply,
          content_complete: true,
          actions: [],
          response_id: parsed.response_id // Echo back the correct response_id
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
  console.log(`Nexella WebSocket Server with memory is listening on port ${PORT}`);
});
