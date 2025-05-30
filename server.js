require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// Ensure we have the required environment variables
if (!process.env.TRIGGER_SERVER_URL) {
  process.env.TRIGGER_SERVER_URL = 'https://trigger-server-qt7u.onrender.com';
}
if (!process.env.N8N_WEBHOOK_URL) {
  process.env.N8N_WEBHOOK_URL = 'https://n8n-clp2.onrender.com/webhook/retell-scheduling';
}

// Store the latest Typeform submission for reference
global.lastTypeformSubmission = null;

app.get('/', (req, res) => {
  res.send('Nexella WebSocket Server with Calendly scheduling link integration is live!');
});

// Store active calls metadata
const activeCallsMetadata = new Map();

// Enhanced function to store contact info globally with multiple fallbacks
function storeContactInfoGlobally(name, email, phone, source = 'Unknown') {
  console.log(`📝 Storing contact info globally from ${source}:`, { name, email, phone });
  
  if (email && email.trim() !== '') {
    global.lastTypeformSubmission = {
      timestamp: new Date().toISOString(),
      email: email.trim(),
      name: (name || '').trim(),
      phone: (phone || '').trim(),
      source: source
    };
    console.log('✅ Stored contact info globally:', global.lastTypeformSubmission);
    return true;
  } else {
    console.warn('⚠️ Cannot store contact info - missing email');
    return false;
  }
}

// Send final data to webhook
async function sendFinalData(name, email, phone, preferredDay, callId, discoveryAnswers) {
  try {
    console.log('📤 Sending final data to webhook');
    console.log('Discovery answers:', discoveryAnswers);
    
    const webhookData = {
      name: name || '',
      email: email || '',
      phone: phone || '',
      preferredDay: preferredDay || '',
      call_id: callId || '',
      schedulingComplete: true,
      "How did you hear about us": discoveryAnswers[0] || '',
      "Business/Industry": discoveryAnswers[1] || '',
      "Main product": discoveryAnswers[2] || '',
      "Running ads": discoveryAnswers[3] || '',
      "Using CRM": discoveryAnswers[4] || '',
      "Pain points": discoveryAnswers[5] || ''
    };
    
    console.log('📤 Webhook payload:', JSON.stringify(webhookData, null, 2));
    
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL}/process-scheduling-preference`, webhookData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    console.log('✅ Webhook sent successfully:', response.data);
    return { success: true, data: response.data };
    
  } catch (error) {
    console.error('❌ Error sending webhook:', error.message);
    return { success: false, error: error.message };
  }
}

// HTTP Request - Trigger Retell Call
app.post('/trigger-retell-call', express.json(), async (req, res) => {
  try {
    const { name, email, phone, userId } = req.body;
    console.log(`Received request to trigger Retell call for ${name} (${email})`);
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    
    const userIdentifier = userId || `user_${phone || Date.now()}`;
    console.log('Call request data:', { name, email, phone, userIdentifier });
    
    storeContactInfoGlobally(name, email, phone, 'API Call');
    
    const metadata = {
      customer_name: name || '',
      customer_email: email,
      customer_phone: phone || ''
    };
    
    console.log('Setting up call with metadata:', metadata);
    
    const initialVariables = {
      customer_name: name || '',
      customer_email: email
    };
    
    const response = await axios.post('https://api.retellai.com/v1/calls', 
      {
        agent_id: process.env.RETELL_AGENT_ID,
        customer_number: phone,
        variables: initialVariables,
        metadata
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`Successfully triggered Retell call: ${response.data.call_id}`);
    res.status(200).json({ 
      success: true, 
      call_id: response.data.call_id,
      message: `Call initiated for ${name || email}`
    });
    
  } catch (error) {
    console.error('Error triggering Retell call:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Unknown error triggering call' 
    });
  }
});

// SIMPLE WebSocket handler
wss.on('connection', async (ws, req) => {
  console.log('🔗 NEW WEBSOCKET CONNECTION');
  
  // Extract call ID from URL
  const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
  const callId = callIdMatch ? `call_${callIdMatch[1]}` : null;
  console.log('📞 Call ID:', callId);
  
  // Simple conversation state
  let currentState = 'greeting'; // greeting -> discovery -> recap -> scheduling -> complete
  let currentQuestionIndex = 0;
  let userHasSpoken = false;
  let discoveryAnswers = ['', '', '', '', '', ''];
  let customerName = '';
  let customerEmail = '';
  let customerPhone = '';
  let webhookSent = false;
  
  const questions = [
    "How did you hear about us?",
    "What industry or business are you in?", 
    "What's your main product or service?",
    "Are you currently running any ads?",
    "Are you using any CRM system?",
    "What are your biggest pain points or challenges?"
  ];

  // Auto-greeting
  setTimeout(() => {
    if (!userHasSpoken) {
      console.log('🎙️ Sending auto-greeting');
      ws.send(JSON.stringify({
        content: "Hi there. This is Sarah from Nexella AI. How are you doing today?",
        content_complete: true,
        actions: [],
        response_id: 1
      }));
    }
  }, 2000);

  ws.on('message', async (data) => {
    try {
      userHasSpoken = true;
      const parsed = JSON.parse(data);
      
      // Only process messages that need a response
      if (parsed.interaction_type !== 'response_required') {
        return;
      }
      
      const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
      if (!userMessage) return;
      
      console.log(`🗣️ User: "${userMessage}" | State: ${currentState} | Question: ${currentQuestionIndex}`);
      
      let botReply = "";
      
      // GREETING STATE
      if (currentState === 'greeting') {
        const msg = userMessage.toLowerCase();
        
        // First greeting
        if (msg.includes('hello') || msg.includes('hi') || msg.includes('hey')) {
          botReply = "Hi there. This is Sarah from Nexella AI. How are you doing today?";
        }
        // Response to how are you
        else if (msg.includes('good') || msg.includes('great') || msg.includes('fine') || msg.includes('well')) {
          if (msg.includes('how are you')) {
            botReply = "I'm doing great, thank you for asking! I'd love to learn about your business. " + questions[0];
          } else {
            botReply = "That's wonderful to hear! I'd love to learn about your business. " + questions[0];
          }
          currentState = 'discovery';
        }
        // Other responses
        else {
          botReply = "Thanks for sharing! I'd love to learn about your business. " + questions[0];
          currentState = 'discovery';
        }
      }
      
      // DISCOVERY STATE
      else if (currentState === 'discovery') {
        // Save the answer
        discoveryAnswers[currentQuestionIndex] = userMessage.trim();
        console.log(`✅ Saved answer ${currentQuestionIndex + 1}: "${userMessage}"`);
        
        // Move to next question
        currentQuestionIndex++;
        
        if (currentQuestionIndex < questions.length) {
          // Ask next question
          botReply = "Thank you. " + questions[currentQuestionIndex];
        } else {
          // All questions done, show recap
          currentState = 'recap';
          botReply = "Perfect! Let me recap what you shared:\n\n";
          for (let i = 0; i < questions.length; i++) {
            botReply += `${i + 1}. ${questions[i]} - "${discoveryAnswers[i]}"\n`;
          }
          botReply += "\nDoes all of that sound correct?";
        }
      }
      
      // RECAP STATE  
      else if (currentState === 'recap') {
        const msg = userMessage.toLowerCase();
        
        if (msg.includes('yes') || msg.includes('correct') || msg.includes('right') || msg.includes('good')) {
          // User confirmed, send webhook and schedule
          currentState = 'scheduling';
          botReply = "Perfect! I'll send you a scheduling link shortly. What day works best for you?";
          
          // Send webhook
          if (!webhookSent) {
            const result = await sendFinalData(
              customerName, 
              customerEmail, 
              customerPhone, 
              'User confirmed answers', 
              callId, 
              discoveryAnswers
            );
            webhookSent = result.success;
          }
        } else {
          // User wants to correct something
          botReply = "No problem! Which question would you like me to correct? Just tell me the number (1-6).";
        }
      }
      
      // SCHEDULING STATE
      else if (currentState === 'scheduling') {
        botReply = "Great! I'll send you the scheduling link via email. Thank you for your time!";
        currentState = 'complete';
      }
      
      // Send response
      if (botReply) {
        console.log(`🤖 Bot: "${botReply}"`);
        ws.send(JSON.stringify({
          content: botReply,
          content_complete: true,
          actions: [],
          response_id: parsed.response_id
        }));
      }
      
    } catch (error) {
      console.error('❌ Error:', error.message);
      ws.send(JSON.stringify({
        content: "I'm sorry, could you repeat that?",
        content_complete: true,
        actions: [],
        response_id: 999
      }));
    }
  });

  ws.on('close', async () => {
    console.log('🔌 Connection closed');
    
    // Send final webhook if we have some answers
    if (!webhookSent && discoveryAnswers.some(a => a.trim() !== '')) {
      console.log('🚨 Sending final webhook on close');
      await sendFinalData(
        customerName, 
        customerEmail, 
        customerPhone, 
        'Call ended early', 
        callId, 
        discoveryAnswers
      );
    }
  });
});

// Endpoint to receive Retell webhook call events
app.post('/retell-webhook', express.json(), async (req, res) => {
  try {
    const { event, call } = req.body;
    console.log(`Received Retell webhook event: ${event}`);
    
    if (call && call.call_id) {
      console.log(`Call ID: ${call.call_id}, Status: ${call.call_status}`);
      
      const email = call.metadata?.customer_email || '';
      const name = call.metadata?.customer_name || '';
      const phone = call.to_number || '';
      
      if (email) {
        storeContactInfoGlobally(name, email, phone, 'Retell Webhook');
      }
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error handling Retell webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Simple Nexella WebSocket Server listening on port ${PORT}`);
});
