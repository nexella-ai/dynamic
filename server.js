// Real Estate Assistant Server Code
const express = require('express');
const WebSocket = require('ws');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

// Global state storage
global.lastTypeformSubmission = null;
global.activeCallsMetadata = new Map();

// Discovery questions for real estate
const discoveryQuestions = [
  { 
    question: 'Are you currently renting or do you own?', 
    field: 'Current Ownership Status', 
    asked: false, 
    answered: false, 
    answer: '' 
  },
  { 
    question: "What's your ideal price range?", 
    field: 'Ideal Price Range', 
    asked: false, 
    answered: false, 
    answer: '' 
  },
  { 
    question: "How soon are you looking to buy?", 
    field: 'Timeline to Buy', 
    asked: false, 
    answered: false, 
    answer: '' 
  },
  { 
    question: "What type of home are you looking for?", 
    field: 'Home Type Preference', 
    asked: false, 
    answered: false, 
    answer: '' 
  },
  { 
    question: "Are there any must-haves or deal-breakers?", 
    field: 'Must-Haves and Deal-Breakers', 
    asked: false, 
    answered: false, 
    answer: '' 
  },
  { 
    question: "Are you working with another agent currently?", 
    field: 'Current Agent Status', 
    asked: false, 
    answered: false, 
    answer: '' 
  }
];

let discoveryProgress = {
  currentQuestionIndex: -1,
  questionsCompleted: 0,
  allQuestionsCompleted: false,
  waitingForAnswer: false,
  lastAcknowledgment: '' // Track last acknowledgment used
};

// Function to get varied acknowledgments
function getAcknowledgment() {
  const options = [
    "Perfect, thank you.",
    "Got it, that's helpful.",
    "Great, I understand.",
    "Excellent, thank you.",
    "That makes sense.",
    "Wonderful, thanks.",
    "I see, that's very helpful.",
    "Perfect, understood.",
    "Awesome, got it."
  ];
  
  // Filter out the last used acknowledgment to avoid repetition
  const availableOptions = options.filter(opt => opt !== discoveryProgress.lastAcknowledgment);
  
  // If we have options left, use them, otherwise reset
  if (availableOptions.length > 0) {
    const selected = availableOptions[Math.floor(Math.random() * availableOptions.length)];
    discoveryProgress.lastAcknowledgment = selected;
    return selected;
  } else {
    // All options used, reset the last acknowledgment and return a random one
    discoveryProgress.lastAcknowledgment = "";
    return options[Math.floor(Math.random() * options.length)];
  }
}

// Function to generate contextual acknowledgments based on user's answer
function getContextualAcknowledgment(userAnswer, questionIndex) {
  const answer = userAnswer.toLowerCase();
  
  switch (questionIndex) {
    case 0: // Current Ownership Status
      if (answer.includes('rent') || answer.includes('renting')) {
        return "Thanks for sharing that you're renting.";
      } else if (answer.includes('own') || answer.includes('homeowner')) {
        return "Great to know you already own property.";
      } else {
        return getAcknowledgment();
      }
    
    case 1: // Ideal Price Range
      if (/\d{4,}/.test(answer)) { // If answer contains a number with 4+ digits
        return `A budget of ${answer} is a great starting point.`;
      } else {
        return getAcknowledgment();
      }
    
    case 2: // Timeline to Buy
      if (answer.includes('soon') || answer.includes('immediately')) {
        return "Good to know you're ready to move quickly.";
      } else if (answer.includes('year') || answer.includes('future')) {
        return "It's helpful to know you're planning ahead.";
      } else {
        return getAcknowledgment();
      }
    
    case 3: // Home Type Preference
      if (answer.includes('condo') || answer.includes('apartment')) {
        return "An apartment or condo would be perfect for you then.";
      } else if (answer.includes('house') || answer.includes('single family')) {
        return "A single-family house sounds like what you need.";
      } else {
        return getAcknowledgment();
      }
    
    case 4: // Must-Haves and Deal-Breakers
      return getAcknowledgment(); // No specific patterns for this question
    
    case 5: // Current Agent Status
      if (answer.includes('yes') || answer.includes('working')) {
        return "Got it, you're already working with an agent.";
      } else if (answer.includes('no') || answer.includes('not')) {
        return "Great, I can help you without conflicting with another agent.";
      } else {
        return getAcknowledgment();
      }
    
    default:
      return getAcknowledgment();
  }
}

// System prompt for real estate assistant
const systemPrompt = `You are Sarah, a friendly and professional real estate assistant helping people find their next home. 
Your role is to conduct a brief discovery conversation before scheduling a consultation with a real estate agent.
You need to ask these 6 specific discovery questions in natural conversation:

1. Are you currently renting or do you own?
2. What's your ideal price range?
3. How soon are you looking to buy?
4. What type of home are you looking for?
5. Are there any must-haves or deal-breakers?
6. Are you working with another agent currently?

After asking each question:
- Wait for the response
- Give a brief acknowledgment
- Then ask the next question

Only after completing all 6 questions should you proceed to scheduling.

When responding:
- Be warm and personable
- Use natural language
- Avoid technical terms
- Keep it conversational

CRITICAL: Ask question ${questionNumber} next. Do NOT repeat completed questions. Do NOT skip to scheduling until all 6 are done.`;

// Conversation history for GPT context
let conversationHistory = [
  {
    role: 'system',
    content: systemPrompt
  },
  {
    role: 'assistant',
    content: 'Hi there! This is Sarah from [Company Name]. I\'m just calling to schedule a quick consultation with our real estate team. Before I check availability, could I ask you a few quick questions to better understand what you\'re looking for?'
  }
];

// WebSocket connection handler
function handleWebSocketConnection(ws) {
  let userHasSpoken = false;
  let callId = null;
  let answerCaptureTimer = null;
  let userResponseBuffer = [];
  
  // Auto greeting timer
  const autoGreetingTimer = setTimeout(() => {
    if (!userHasSpoken) {
      ws.send(JSON.stringify({
        content: "Hello? This is Sarah from [Company Name]. I'm here to schedule your real estate consultation.",
        content_complete: true,
        actions: [],
        response_id: 1
      }));
    }
  }, 7000); // 7 seconds for auto-greeting
  
  // Message handler
  ws.on('message', async (data) => {
    try {
      clearTimeout(autoGreetingTimer);
      userHasSpoken = true;
      
      const parsed = JSON.parse(data);
      console.log('Raw WebSocket Message:', JSON.stringify(parsed, null, 2));
      
      // Handle call data
      if (parsed.call) {
        callId = parsed.call.call_id;
        console.log(`Call ID: ${callId}`);
        
        // Store metadata
        if (parsed.call.metadata) {
          global.activeCallsMetadata.set(callId, parsed.call.metadata);
        }
      }
      
      // Process user response
      if (parsed.interaction_type === 'final_transcript' && parsed.speech_to_text) {
        const userResponse = parsed.speech_to_text.trim();
        console.log(`User said: "${userResponse}"`);
        
        // Buffer responses while processing
        if (discoveryProgress.waitingForAnswer) {
          userResponseBuffer.push(userResponse);
          
          // Process the buffer after a short delay
          clearTimeout(answerCaptureTimer);
          answerCaptureTimer = setTimeout(async () => {
            const currentQ = discoveryQuestions[discoveryProgress.currentQuestionIndex];
            
            if (currentQ && !currentQ.answered) {
              // Save the answer
              currentQ.answer = userResponse;
              currentQ.answered = true;
              discoveryProgress.questionsCompleted++;
              discoveryProgress.waitingForAnswer = false;
              
              console.log(`✅ Answer saved for "${currentQ.question}": "${userResponse}"`);
              
              // Get contextual acknowledgment
              const acknowledgment = getContextualAcknowledgment(userResponse, discoveryProgress.currentQuestionIndex);
              
              // Send acknowledgment
              ws.send(JSON.stringify({
                content: acknowledgment,
                content_complete: true,
                actions: [],
                response_id: 9998
              }));
              
              // Reset buffer and continue discovery
              userResponseBuffer = [];
              await continueDiscovery(ws);
            }
          }, 1500); // 1.5 seconds delay to capture full response
        }
      }
      
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        content: "I missed that. Could you repeat it?",
        content_complete: true,
        actions: [],
        response_id: 9999
      }));
    }
  });
  
  // Connection close handler
  ws.on('close', async () => {
    console.log('Connection closed.');
    clearTimeout(autoGreetingTimer);
    
    if (answerCaptureTimer) {
      clearTimeout(answerCaptureTimer);
      console.log('Cleared pending answer capture timer');
    }
    
    if (userResponseBuffer.length > 0 && discoveryProgress.waitingForAnswer) {
      const currentQ = discoveryQuestions[discoveryProgress.currentQuestionIndex];
      
      if (currentQ && !currentQ.answered) {
        currentQ.answer = userResponseBuffer.join(' ');
        currentQ.answered = true;
        discoveryProgress.questionsCompleted++;
        discoveryProgress.waitingForAnswer = false;
        
        console.log(`✅ Final buffered answer saved for "${currentQ.question}": "${currentQ.answer}"`);
        
        const acknowledgment = getContextualAcknowledgment(currentQ.answer, discoveryProgress.currentQuestionIndex);
        
        ws.send(JSON.stringify({
          content: acknowledgment,
          content_complete: true,
          actions: [],
          response_id: 9998
        }));
        
        userResponseBuffer = [];
        await continueDiscovery(ws);
      }
    }
  });
}

// Function to continue discovery process
async function continueDiscovery(ws) {
  try {
    // Find next unanswered question
    let nextQuestionIndex = -1;
    
    for (let i = 0; i < discoveryQuestions.length; i++) {
      if (!discoveryQuestions[i].answered) {
        nextQuestionIndex = i;
        break;
      }
    }
    
    // If all questions are answered
    if (nextQuestionIndex === -1 && !discoveryProgress.allQuestionsCompleted) {
      discoveryProgress.allQuestionsCompleted = true;
      console.log('✅ All discovery questions completed!');
      
      // Create formatted discovery data
      const formattedDiscoveryData = {};
      discoveryQuestions.forEach(q => {
        if (q.field && q.answer) {
          formattedDiscoveryData[q.field] = q.answer;
          console.log(`✅ Mapped discovery: ${q.field} = "${q.answer}"`);
        }
      });
      
      // Here you would typically send to your webhook or API
      console.log('📦 Final discovery data:', formattedDiscoveryData);
      
      // Simulate sending to scheduling
      ws.send(JSON.stringify({
        content: "Great! I have all the information I need. Let me check my calendar for availability...",
        content_complete: true,
        actions: [],
        response_id: 9997
      }));
      
      // Schedule closing after delay
      setTimeout(() => {
        ws.close();
      }, 5000);
      
      return;
    }
    
    // Ask next question
    if (nextQuestionIndex >= 0) {
      discoveryProgress.currentQuestionIndex = nextQuestionIndex;
      discoveryProgress.waitingForAnswer = true;
      
      const nextQuestion = discoveryQuestions[nextQuestionIndex];
      nextQuestion.asked = true;
      
      console.log(`❓ Asking question ${nextQuestionIndex + 1}: "${nextQuestion.question}"`);
      
      // Send question via WebSocket
      ws.send(JSON.stringify({
        content: nextQuestion.question,
        content_complete: true,
        actions: [],
        response_id: nextQuestionIndex + 1
      }));
    }
  } catch (error) {
    console.error('Error continuing discovery:', error);
  }
}

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Upgrade HTTP server to WebSocket
const server = app.listen(3001, () => {
  console.log('WebSocket server running on port 3001');
});
const wss = new WebSocket.Server({ server });

wss.on('connection', handleWebSocketConnection);

console.log('Real estate assistant server started');

// Export for testing
module.exports = app;
