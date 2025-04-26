import { WebSocketServer } from 'ws';
import axios from 'axios';

const wss = new WebSocketServer({ port: process.env.PORT || 3000 });

wss.on('connection', function connection(ws) {
  console.log('Retell connected.');

  ws.on('message', async function message(data) {
    try {
      const parsed = JSON.parse(data);
      const userMessage = parsed.text;

      console.log('User said:', userMessage);

      const openaiResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: userMessage }],
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
