// test-dealership.js
const WebSocket = require('ws');

async function testDealershipConversation() {
  console.log('🚗 Testing Tim Short Ford Dealership AI\n');
  
  const ws = new WebSocket('ws://localhost:3000/ws/timshort_ford_lafollette/call_test123');
  
  const conversation = [
    { wait: 2000, user: "Hi, I was on your website looking at the 2024 F-150. I'm interested in scheduling a test drive." },
    { wait: 3000, user: "Sure, it's Mike." },
    { wait: 3000, user: "I'm looking at the XLT." },
    { wait: 3000, user: "Oxford White would be great." },
    { wait: 3000, user: "Tomorrow at 2 PM is perfect." },
    { wait: 3000, user: "865-555-1234 and mike@email.com" },
    { wait: 3000, user: "Yeah, I have a 2019 Silverado to trade in." }
  ];
  
  ws.on('open', () => {
    console.log('✅ Connected to dealership AI\n');
    
    // Send greeting to trigger response
    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      transcript: [{ role: 'user', content: 'hello' }]
    }));
  });
  
  ws.on('message', async (data) => {
    const response = JSON.parse(data);
    if (response.content) {
      console.log(`🤖 AI: ${response.content}\n`);
      
      // Send next message from conversation
      if (conversation.length > 0) {
        const next = conversation.shift();
        setTimeout(() => {
          console.log(`👤 Customer: ${next.user}\n`);
          ws.send(JSON.stringify({
            interaction_type: 'response_required',
            transcript: [{ role: 'user', content: next.user }],
            response_id: Date.now()
          }));
        }, next.wait);
      }
    }
  });
  
  ws.on('close', () => {
    console.log('\n✅ Conversation completed');
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
}

// Run the test
testDealershipConversation();
