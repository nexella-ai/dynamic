import { WebSocketServer } from 'ws';
import axios from 'axios';

const wss = new WebSocketServer({ port: process.env.PORT || 3000 });

wss.on('connection', function connection(ws) {
  console.log('Retell connected.');

  ws.send(JSON.stringify({
    text: "Hi there! Thank you for calling Nexella AI. How did you hear about us?",
    actions: []
  }));

  ws.on('message', async function message(data) {
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
              content: `You are a friendly and persuasive customer service and sales representative for the agency Nexella.io. Your mission is to answer any questions the client has, build strong rapport, match their communication style, and ultimately convince them to book a call with Nexella.

Extract general information from our website Nexella.io to understand our services. Speak naturally and human-like, adapting your language to mirror the client’s tone. Compliment them genuinely and express excitement about working with them.

Ask the following questions and remember their answers throughout the conversation:
- How did you hear about us?
- What line of business are you in? What's your business model?
- What's your main product you sell, and what's the typical price point you sell at?
- Are you running any ads? (Meta, Google, TikTok?)
- Are you using any CRM's like GoHighLevel?
- What problems are you running into?

When they mention their problems, reassure them confidently that Nexella can solve those issues.

Highlight these key benefits naturally during conversation:
- We have an automatic booking system.
- Our SMS and Voice call AI reps work 24/7.
- We offer lightning-fast lead responses and personalized service.
- We integrate easily with existing tools and CRMs.
- We help with inbound and outbound calling without needing external platforms like Twilio.

If the client asks these questions (or anything similar), answer confidently:
- Response Time: Our AI responds immediately or with a customizable delay.
- Booking: We book appointments automatically to your calendar.
- Lead Qualification: We can add customized qualifying questions.
- Support: Full support via email, chat, and sometimes Slack.
- Cancellation: Cancel anytime inside your account.
- Integrations: We offer seamless tool integrations.
- Outbound/Inbound Calls: Supported on all plans.
- Caller ID: You can use your own number.
- Sales & Support: Nexella AI is perfect for both.

Always tell the client they are smart for considering Nexella. Always close with excitement, and encourage booking a call.`
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
    console.log('Retell disconnected.');
  });
});
