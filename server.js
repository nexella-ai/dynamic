require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Nexella WebSocket Server with Calendly scheduling link integration is live!');
});

// Store active calls metadata
const activeCallsMetadata = new Map();

// For checking slot availability with our trigger server
async function checkAvailability(startTime, endTime) {
  try {
    const response = await axios.get(`${process.env.TRIGGER_SERVER_URL}/check-availability`, {
      params: { startTime, endTime }
    });
    return response.data.available;
  } catch (error) {
    console.error('Error checking availability:', error.message);
    return false;
  }
}

// For getting available time slots from Calendly (through your trigger server)
async function getAvailableTimeSlots(date) {
  try {
    const formattedDate = new Date(date).toISOString().split('T')[0];
    const response = await axios.get(`${process.env.TRIGGER_SERVER_URL}/available-slots`, {
      params: { date: formattedDate }
    });
    return response.data.availableSlots || [];
  } catch (error) {
    console.error('Error getting available slots:', error.message);
    return [];
  }
}

// Update conversation state in trigger server
async function updateConversationState(callId, discoveryComplete, preferredDay) {
  try {
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL}/update-conversation`, {
      call_id: callId,
      discoveryComplete,
      preferredDay
    });
    console.log(`Updated conversation state for call ${callId}:`, response.data);
    return response.data.success;
  } catch (error) {
    console.error('Error updating conversation state:', error);
    return false;
  }
}

// IMPROVED: Send scheduling data to trigger server webhook endpoint with better error handling
async function sendSchedulingPreference(name, email, phone, preferredDay, callId, discoveryData = {}) {
  try {
    // Format discovery data to be more readable
    const formattedDiscoveryData = {};
    
    // Map the discovery questions to the answers
    const discoveryQuestions = [
      'How did you hear about us?',
      'What line of business are you in? What\'s your business model?',
      'What\'s your main product and typical price point?',
      'Are you running ads (Meta, Google, TikTok)?',
      'Are you using a CRM like GoHighLevel?',
      'What problems are you running into?'
    ];
    
    // Add each question and answer to formatted data
    Object.entries(discoveryData).forEach(([key, value]) => {
      // Try to match question number to the actual question
      if (key.startsWith('question_')) {
        const questionIndex = parseInt(key.replace('question_', ''));
        if (!isNaN(questionIndex) && questionIndex >= 0 && questionIndex < discoveryQuestions.length) {
          // Use the actual question text as the key
          formattedDiscoveryData[discoveryQuestions[questionIndex]] = value;
        } else {
          formattedDiscoveryData[key] = value;
        }
      } else {
        formattedDiscoveryData[key] = value;
      }
    });
    
    // IMPORTANT FIX: Ensure we have the metadata from call ID if available
    if (callId && activeCallsMetadata.has(callId) && (!email || !name || !phone)) {
      const callMetadata = activeCallsMetadata.get(callId);
      if (callMetadata) {
        if (!email && callMetadata.customer_email) email = callMetadata.customer_email;
        if (!name && callMetadata.customer_name) name = callMetadata.customer_name;
        if (!phone) {
          phone = callMetadata.phone || callMetadata.to_number;
        }
      }
      console.log(`Retrieved metadata from call ID ${callId}: ${email}, ${name}, ${phone}`);
    }
    
    // Add fallback for missing email
    if (!email || email.trim() === '') {
      console.log('WARNING: Email is empty, using fallback email');
      email = 'jadenlugoco@gmail.com'; // Fallback to ensure data gets processed
    }
    
    // Ensure phone number is formatted properly with leading +
    if (phone && !phone.startsWith('+')) {
      phone = '+1' + phone.replace(/[^0-9]/g, '');
    }
    
    const webhookData = {
      name: name || '',
      email: email || '',
      phone: phone || '',
      preferredDay: preferredDay || '',
      call_id: callId || '',
      schedulingComplete: true,
      discovery_data: formattedDiscoveryData
    };
    
    console.log('Sending scheduling preference to trigger server:', JSON.stringify(webhookData, null, 2));
    
    const response = await axios.post(`${process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/process-scheduling-preference`, webhookData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    console.log('Scheduling preference sent successfully:', response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('Error sending scheduling preference:', error);
    
    // Even if there's an error, try to send directly to n8n webhook
    try {
      console.log('Attempting to send directly to n8n webhook as fallback');
      const webhookData = {
        name: name || '',
        email: email || 'jadenlugoco@gmail.com', // Ensure fallback email here too
        phone: phone || '',
        preferredDay: preferredDay || '',
        call_id: callId || '',
        schedulingComplete: true,
        discovery_data: formattedDiscoveryData || {}
      };
      
      const n8nResponse = await axios.post(process.env.N8N_WEBHOOK_URL || 'https://n8n-clp2.onrender.com/webhook/retell-scheduling', webhookData, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      console.log('Successfully sent directly to n8n:', n8nResponse.data);
      return { success: true, fallback: true };
    } catch (n8nError) {
      console.error('Error sending directly to n8n:', n8nError);
      return { success: false, error: error.message };
    }
  }
}

// IMPROVED: Better detection of discovery questions being asked and answered
function trackDiscoveryQuestions(botMessage, discoveryProgress, discoveryQuestions) {
  if (!botMessage) return false;
  
  const botMessageLower = botMessage.toLowerCase();
  
  // Key phrases to detect in the bot's message that indicate specific discovery questions
  const keyPhrases = [
    ["hear about us", "find us", "discover us", "found us", "discovered nexella"], // How did you hear about us
    ["business", "company", "industry", "what do you do", "line of business", "business model"], // What line of business are you in
    ["product", "service", "offer", "price point", "main product", "typical price"], // What's your main product
    ["ads", "advertising", "marketing", "meta", "google", "tiktok", "running ads"], // Are you running ads
    ["crm", "gohighlevel", "management system", "customer relationship", "using any crm"], // Are you using a CRM
    ["problems", "challenges", "issues", "pain points", "difficulties", "running into", "what problems"] // What problems are you facing
  ];
  
  // Check each question's key phrases
  keyPhrases.forEach((phrases, index) => {
    if (phrases.some(phrase => botMessageLower.includes(phrase))) {
      discoveryProgress.questionsAsked.add(index);
      console.log(`Detected question ${index} was asked: ${discoveryQuestions[index]}`);
    }
  });
  
  // Only consider discovery complete if we have asked at least 5 questions AND 
  // there's a scheduling-related phrase OR all 6 questions have been asked
  const minimumQuestionsAsked = 5;
  const schedulingPhrases = ["schedule", "book a call", "day of the week", "what day works", "good time", "availability"];
  
  const hasSchedulingPhrase = schedulingPhrases.some(phrase => botMessageLower.includes(phrase));
  const hasEnoughQuestions = discoveryProgress.questionsAsked.size >= minimumQuestionsAsked;
  const hasAllQuestions = discoveryProgress.questionsAsked.size >= discoveryQuestions.length;
  
  // Log the progress for debugging
  console.log(`Question progress: ${discoveryProgress.questionsAsked.size}/${discoveryQuestions.length}, Scheduling phrase: ${hasSchedulingPhrase}`);
  
  // Consider discovery complete when we have enough questions OR all questions
  const discoveryComplete = (hasEnoughQuestions && hasSchedulingPhrase) || hasAllQuestions;
  
  if (discoveryComplete) {
    console.log('Discovery process considered complete!');
  }
  
  discoveryProgress.allQuestionsAsked = discoveryComplete;
  return discoveryComplete;
}

// IMPROVED: Better detection of scheduling preferences
function handleSchedulingPreference(userMessage) {
  // Extract day of week with better handling for various formats
  const dayMatch = userMessage.match(/monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow|today/i);
  const nextWeekMatch = userMessage.match(/next week/i);
  
  if (nextWeekMatch) {
    // Handle "next week" specifically
    let targetDate = new Date();
    // Add 7 days to get to next week, then adjust to Monday
    targetDate.setDate(targetDate.getDate() + 7);
    
    // Get next Monday (if we're already past Monday this week)
    const dayOfWeek = targetDate.getDay();
    const daysUntilMonday = (dayOfWeek === 0) ? 1 : (8 - dayOfWeek);
    targetDate.setDate(targetDate.getDate() + daysUntilMonday - 7);
    
    return {
      dayName: 'next week',
      date: targetDate,
      isSpecific: false
    };
  } else if (dayMatch) {
    const preferredDay = dayMatch[0].toLowerCase();
    
    let targetDate = new Date();
    
    // Handle relative day references
    if (preferredDay === 'tomorrow') {
      targetDate.setDate(targetDate.getDate() + 1);
      return {
        dayName: 'tomorrow',
        date: targetDate,
        isSpecific: true
      };
    } else if (preferredDay === 'today') {
      return {
        dayName: 'today',
        date: targetDate,
        isSpecific: true
      };
    } else {
      // Handle specific day of week
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const requestedDayIndex = daysOfWeek.findIndex(d => d === preferredDay);
      
      if (requestedDayIndex !== -1) {
        const currentDay = targetDate.getDay();
        let daysToAdd = requestedDayIndex - currentDay;
        
        // If the requested day is earlier in the week than today, go to next week
        if (daysToAdd <= 0) {
          daysToAdd += 7;
        }
        
        targetDate.setDate(targetDate.getDate() + daysToAdd);
        
        return {
          dayName: preferredDay,
          date: targetDate,
          isSpecific: true
        };
      }
    }
  }
  
  return null;
}

// NEW: Speech patterns dictionary for natural conversational responses
const speechPatternsDict = {
  // Opening phrases
  openings: [
    "Hi there! This is Sarah from Nexella.",
    "Hey! Sarah from Nexella here.",
    "Hello! It's Sarah with Nexella."
  ],
  
  // Transition phrases
  transitions: [
    "So, tell me a bit about",
    "I'd love to hear more about",
    "Let's talk about",
    "Moving on to",
    "Now I'm curious about"
  ],
  
  // Acknowledgment phrases
  acknowledgments: [
    "That makes sense.",
    "I understand.",
    "Got it.",
    "I see what you mean.",
    "That's really helpful to know."
  ],
  
  // Enthusiasm phrases
  enthusiasm: [
    "That's awesome!",
    "That sounds great!",
    "I'm excited to hear that!",
    "That's fantastic!",
    "Love that!"
  ],
  
  // Scheduling phrases
  scheduling: [
    "Let's find a time to chat more about this.",
    "We should definitely schedule a call to dive deeper.",
    "I'd love to set up a call to discuss this further.",
    "Let's get a call on the calendar to talk more."
  ],
  
  // Terms with specific pronunciations (for reference and post-processing)
  pronunciations: {
    "Nexella": "Nex-EL-a",
    "CRM": "C-R-M",
    "API": "A-P-I",
    "GoHighLevel": "Go-High-Level",
    "SaaS": "sass"
  },
  
  // Fallback responses for handling errors
  fallbacks: [
    "I'm sorry, I think I missed that. Could you repeat that one more time?",
    "Sorry about that, I didn't quite catch what you said. Could you say that again?",
    "Hmm, I think we had a bit of a connection issue. What were you saying?",
    "I apologize, I think I missed part of that. Could you repeat it?",
    "Sorry, I didn't catch that. Could you say it again?",
    "I think there was a bit of interference. Could you repeat that please?"
  ]
};

// NEW: Function to enhance speech patterns in the response
function enhanceSpeechPatterns(responseText) {
  let enhancedText = responseText;
  
  // Simple replacements for common awkward phrases
  const replacements = {
    "I would like to": "I'd like to",
    "I am": "I'm",
    "You are": "You're",
    "We are": "We're",
    "It is": "It's",
    "Do not": "Don't",
    "Cannot": "Can't",
    "Will not": "Won't",
    "That is": "That's",
    "What is": "What's",
    "Here is": "Here's",
    "There is": "There's",
    "How is": "How's",
    "Who is": "Who's",
    "When is": "When's",
    "CRM system": "C-R-M system",
    "Nexella.io": "Nexella",
    "Meta ads": "Meta ads",
    "TikTok ads": "TikTok ads",
    "Nexella AI": "Nexella"
  };
  
  // Apply simple replacements
  Object.entries(replacements).forEach(([original, replacement]) => {
    const regex = new RegExp(`\\b${original}\\b`, 'gi');
    enhancedText = enhancedText.replace(regex, replacement);
  });
  
  // Detect if this is an opening message
  if (enhancedText.includes("Sarah") && enhancedText.includes("Nexella") && enhancedText.length < 150) {
    // If it's a generic opening, replace with a more natural one
    if (enhancedText.match(/\bHi\b|\bHello\b|\bHey\b/i)) {
      // Pick a random opening
      const randomOpening = speechPatternsDict.openings[Math.floor(Math.random() * speechPatternsDict.openings.length)];
      // Replace just the opening part
      enhancedText = enhancedText.replace(/^(Hi|Hello|Hey).*?(Nexella).{0,20}/i, randomOpening + " ");
    }
  }
  
  // Add natural transitions if they're missing
  if (enhancedText.includes("?") && !enhancedText.match(/\bSo\b|\bNow\b|\bAnyway\b|\bBy the way\b/i)) {
    // Add a natural transition before questions sometimes
    if (Math.random() < 0.3) { // 30% chance to add transition
      const questionPattern = /([.!]\s+)([A-Z][^?]*\?)/g;
      const randomTransition = speechPatternsDict.transitions[Math.floor(Math.random() * speechPatternsDict.transitions.length)];
      
      enhancedText = enhancedText.replace(questionPattern, (match, punctuation, question) => {
        if (question.length > 20) { // Only for substantial questions
          return punctuation + randomTransition.split(' ').slice(0, 2).join(' ') + ", " + question.charAt(0).toLowerCase() + question.slice(1);
        }
        return match;
      });
    }
  }
  
  // Improve Nexella pronunciation
  enhancedText = enhancedText.replace(/\bNexella\b/g, "Nex-ella");
  
  // Improve specific technical terms pronunciation
  enhancedText = enhancedText.replace(/\bCRM\b/g, "C-R-M");
  enhancedText = enhancedText.replace(/\bGoHighLevel\b/g, "Go High Level");
  
  return enhancedText;
}

// NEW: Function to extract and maintain knowledge from the conversation
function updateConversationMemory(userMessage, conversationHistory, conversationMemory) {
  // Initialize memory if not present
  if (!conversationMemory.entities) {
    conversationMemory.entities = {
      business_name: null,
      product_type: null,
      business_type: null,
      price_point: null,
      pain_points: [],
      ad_platforms: [],
      crm_system: null
    };
    conversationMemory.speech_patterns = {
      preferred_name: null,
      speaking_style: null
    };
  }
  
  // Extract business name using regex pattern
  const businessNamePattern = /(?:my|our) (?:business|company|agency|firm)(?: is| called| named)? (?:is |called |named )?([A-Z][A-Za-z0-9\s&'-]+)(?:\.|\,|\s|$)/i;
  const businessNameMatch = userMessage.match(businessNamePattern);
  if (businessNameMatch && businessNameMatch[1]) {
    conversationMemory.entities.business_name = businessNameMatch[1].trim();
  }
  
  // Extract product type
  const productTypePatterns = [
    /(?:sell|offer|provide|make|produce) ([^\.]{3,50}?)(?:\.|\,|\s|$)/i,
    /(?:our|my) (?:main |primary |)(?:product|service) is ([^\.]{3,50}?)(?:\.|\,|\s|$)/i
  ];
  
  for (const pattern of productTypePatterns) {
    const match = userMessage.match(pattern);
    if (match && match[1]) {
      conversationMemory.entities.product_type = match[1].trim();
      break;
    }
  }
  
  // Extract business type
  const businessTypePatterns = [
    /(?:we are|I am|it's|we're|I'm) (?:a |an |)([^\.]{3,40}?)(?:business|company|agency|firm)/i,
    /(?:we're|I'm) in the ([^\.]{3,40}?)(?:industry|business|space|market)/i
  ];
  
  for (const pattern of businessTypePatterns) {
    const match = userMessage.match(pattern);
    if (match && match[1]) {
      conversationMemory.entities.business_type = match[1].trim();
      break;
    }
  }
  
  // Extract pain points
  const painPointPatterns = [
    /(?:problem|issue|challenge|struggle|difficulty) (?:is|with) ([^\.]{5,100}?)(?:\.|\,|\s|$)/i,
    /(?:having|have) (?:a |an |)(?:problem|issue|challenge|struggle|difficulty) (?:with|regarding) ([^\.]{5,100}?)(?:\.|\,|\s|$)/i
  ];
  
  for (const pattern of painPointPatterns) {
    const match = userMessage.match(pattern);
    if (match && match[1]) {
      const painPoint = match[1].trim();
      if (!conversationMemory.entities.pain_points.includes(painPoint)) {
        conversationMemory.entities.pain_points.push(painPoint);
      }
      break;
    }
  }
  
  // Extract preferred name if user corrects or provides it
  const namePatterns = [
    /(?:call me|I'm|name is|it's) ([A-Z][a-z]{1,15})/i,
    /(?:this is|speaking is|'s) ([A-Z][a-z]{1,15})/i
  ];
  
  for (const pattern of namePatterns) {
    const match = userMessage.match(pattern);
    if (match && match[1]) {
      conversationMemory.speech_patterns.preferred_name = match[1].trim();
      break;
    }
  }
  
  return conversationMemory;
}

// NEW: Function to enhance response with memory
function enhanceResponseWithMemory(responseText, conversationMemory) {
  let enhancedText = responseText;
  
  // Replace generic references with specific memories when relevant
  if (conversationMemory.entities.business_name) {
    // Replace generic business references with the actual name occasionally
    // Only do this for a percentage of occurrences to maintain natural speech
    const businessReplaceChance = 0.7; // 70% chance to replace
    
    if (Math.random() < businessReplaceChance) {
      const businessName = conversationMemory.entities.business_name;
      enhancedText = enhancedText.replace(
        /your business|your company/i, 
        businessName
      );
    }
  }
  
  // Use preferred name if available
  if (conversationMemory.speech_patterns.preferred_name) {
    const preferredName = conversationMemory.speech_patterns.preferred_name;
    // Replace generic "you" with name occasionally for personalization
    if (Math.random() < 0.3) { // 30% chance
      enhancedText = enhancedText.replace(
        /^(Thank you|Great|Awesome|Perfect)/i,
        `$1, ${preferredName}`
      );
    }
  }
  
  // Reference specific product type if available
  if (conversationMemory.entities.product_type && 
      enhancedText.includes("product") && 
      Math.random() < 0.6) { // 60% chance
    const productType = conversationMemory.entities.product_type;
    enhancedText = enhancedText.replace(
      /your product|your service/i,
      `your ${productType}`
    );
  }
  
  return enhancedText;
}

// NEW: Unified AI response generator with consistency checks
async function generateAIResponse(userMessage, conversationHistory, state) {
  try {
    // Add system prompt update based on conversation state
    let systemPrompt = conversationHistory[0].content;
    
    // If we're in discovery, emphasize natural speech for that specific question
    if (state.conversationState === 'discovery') {
      const currentQuestionIndex = state.discoveryProgress.currentQuestionIndex || 0;
      if (currentQuestionIndex < state.discoveryQuestions.length) {
        const currentQuestion = state.discoveryQuestions[currentQuestionIndex];
        systemPrompt += `\n\nFOCUS ON THIS QUESTION NOW: "${currentQuestion}"\n` +
                        `Ask this in a very natural, conversational way. Wait for their answer before moving on.`;
      }
    }
    
    // If we're in booking, emphasize natural scheduling phrases
    if (state.conversationState === 'booking') {
      systemPrompt += `\n\nYou are now helping schedule a call. Use natural language to confirm their preferred day.` +
                     `Say something like "Perfect! I'll send you a scheduling link for [day] and you can pick a time that works best for you."`;
    }
    
    // Update the system prompt in the conversation history
    conversationHistory[0].content = systemPrompt;
    
    // Generate standard response
    const standardResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: conversationHistory,
        temperature: 0.65,
        presence_penalty: 0.2,
        frequency_penalty: 0.3,
        max_tokens: 300 // Setting a reasonable limit helps maintain focused responses
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      }
    );

    let responseContent = standardResponse.data.choices[0].message.content;
    
    // Apply speech pattern enhancements
    responseContent = enhanceSpeechPatterns(responseContent);
    
    // For critical conversation stages, use verification to ensure quality
    const criticalStages = ['introduction', 'booking'];
    if (criticalStages.includes(state.conversationState)) {
      try {
        // Verification for natural speech with specific instructions
        const verificationPrompt = [
          { 
            role: 'system', 
            content: `You are a speech naturalness expert for Sarah from Nexella. 
                     Your task is to ensure this response sounds completely natural when spoken aloud.
                     Fix any awkward phrases or words that would sound unnatural in conversation.
                     Ensure consistent use of contractions (don't, I'm, you're, we're, etc.).
                     Maintain Sarah's warm, friendly tone.
                     Make minimal changes - just enough to ensure natural speech.
                     IMPORTANT: Maintain all information about Nexella, scheduling, and the conversation purpose.`
          },
          { role: 'user', content: responseContent }
        ];
  
        const verificationResponse = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4o',
            messages: verificationPrompt,
            temperature: 0.3,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 5000
          }
        );
  
        responseContent = verificationResponse.data.choices[0].message.content;
      } catch (verificationError) {
        console.log('Verification step failed, using enhanced response instead:', verificationError.message);
        // We already enhanced the response, so we can continue with that
      }
    }
    
    return responseContent;
  } catch (error) {
    console.error('Error generating AI response:', error);
    // Fallback response in case of errors
    return speechPatternsDict.fallbacks[Math.floor(Math.random() * speechPatternsDict.fallbacks.length)];
  }
}

// NEW: Track hesitation indicators from users
function trackHesitationIndicators(userMessage) {
  const hesitationPhrases = [
    "what do you mean",
    "i don't understand",
    "can you repeat",
    "didn't catch that",
    "say that again",
    "you're breaking up",
    "couldn't hear you",
    "what was that",
    "huh",
    "pardon",
    "sorry"
  ];
  
  // Check if message contains hesitation indicators
  const containsHesitation = hesitationPhrases.some(phrase => 
    userMessage.toLowerCase().includes(phrase)
  );
  
  if (containsHesitation) {
    console.log('User hesitation detected:', userMessage);
    return true;
  }
  
  return false;
}

// NEW: Enhanced error handler with context awareness
function handleConversationError(error, conversationState, retryCount = 0) {
  console.error(`Error in ${conversationState} state:`, error.message);
  
  // If we've already retried too many times, escalate
  if (retryCount >= 3) {
    return {
      message: "I seem to be having some technical difficulties. Let me make sure I have this right - you'd like to schedule a call with one of our specialists, right? If so, what day works best for you?",
      shouldEscalate: true
    };
  }
  
  // Different fallbacks based on conversation state
  if (conversationState === 'introduction') {
    return {
      message: "Hi there! This is Sarah from Nexella. I think we had a small connection issue. How are you doing today?",
      shouldEscalate: false
    };
  } else if (conversationState === 'discovery') {
    return {
      message: "I'm sorry about that - I think I missed what you were saying. We were talking about your business needs. Could you tell me a bit more about what you're looking for?",
      shouldEscalate: false
    };
  } else if (conversationState === 'booking') {
    return {
      message: "Sorry about that little glitch. We were just talking about scheduling a call. What day would work best for you?",
      shouldEscalate: true // Prioritize getting to scheduling
    };
  } else {
    return {
      message: speechPatternsDict.fallbacks[Math.floor(Math.random() * speechPatternsDict.fallbacks.length)],
      shouldEscalate: false
    };
  }
}

wss.on('connection', (ws) => {
  console.log('Retell connected via WebSocket.');
  
  // Store connection data with this WebSocket
  const connectionData = {
    callId: null,
    metadata: null,
    isOutboundCall: false,
    isAppointmentConfirmation: false
  };
  
  // Define discovery questions as a trackable list
  const discoveryQuestions = [
    'How did you hear about us?',
    'What line of business are you in? What\'s your business model?',
    'What\'s your main product and typical price point?',
    'Are you running ads (Meta, Google, TikTok)?',
    'Are you using a CRM like GoHighLevel?',
    'What problems are you running into?'
  ];
  
  let discoveryProgress = {
    currentQuestionIndex: 0,
    questionsAsked: new Set(),
    allQuestionsAsked: false
  };
  
  // Initialize conversation memory for consistent context
  let conversationMemory = {
    entities: {
      business_name: null,
      product_type: null,
      business_type: null,
      price_point: null,
      pain_points: [],
      ad_platforms: [],
      crm_system: null
    },
    speech_patterns: {
      preferred_name: null,
      speaking_style: null
    }
  };
  
  // UPDATED: Improved system prompt with name awareness and simplified scheduling
  let conversationHistory = [
    {
      role: 'system',
      content: `You are a customer service/sales representative for Nexella.io named "Sarah". Always introduce yourself as Sarah from Nexella.

VOICE & SPEECH PATTERNS:
- Speak in a warm, friendly American English accent
- Use a consistent speaking pace - not too fast, not too slow
- Pronounce words clearly and naturally, especially tech terms
- Use natural rhythm and intonation, with slight emphasis on important words
- Avoid robotic or monotone delivery
- Use contractions consistently (don't, can't, won't, I'm, you're, we're)
- Add occasional brief pauses between thoughts for natural conversation flow
- Maintain a consistent pitch and volume throughout the call

CONVERSATIONAL STYLE:
- Use natural transition phrases: "So tell me," "By the way," "Actually," "You know what"
- Include occasional filler words in moderation: "um," "like," "you know" (sparingly!)
- Use casual acknowledgments: "Got it," "I see," "Makes sense," "That's great"
- Express excitement naturally: "That's awesome!" "I'm really excited about that"
- Show empathy: "I understand," "That must be challenging"
- Ask follow-up questions that build on what they've said
- Use their exact words or phrases occasionally to show you're listening
- Maintain consistent vocal personality throughout all interactions

KEY REMINDERS:
- We ALREADY have their name and email from their typeform submission
- Address them by name early in the conversation if you know it
- You don't need to ask for their email again
- Be conversational, not checklist-like
- Ask ONE question at a time
- Wait for answers before moving forward
- Show genuine interest in their responses

DISCOVERY QUESTIONS (ask ALL in order):
1. "How did you hear about Nexella?" (casual follow-up: "That's great to know!")
2. "So, tell me a little bit about your business - what's your business model like?" (acknowledge their answer)
3. "What's your main product or service and what's your typical price point per client?" (react naturally)
4. "Are you running any ads right now - like on Meta, Google, or TikTok?" (show interest in response)
5. "Are you using any CRM system like GoHighLevel, HubSpot, or SalesForce?" (acknowledge answer)
6. "What specific problems are you running into that we might be able to help with?" (validate their challenges)

SCHEDULING:
- ONLY after asking ALL discovery questions, ask for what DAY works for a call
- Say something like: "Based on what you've shared, I think we should definitely schedule a call to discuss solutions. What day works best for you?"
- When they mention ANY day (today, tomorrow, Monday, next week, etc.), immediately confirm
- Say something like: "Perfect! I'll send you a scheduling link for [day] and you can pick whatever time works best"
- Emphasize they already have an account/email with us
- Make it super easy and casual

CONSISTENT TECHNICAL TERMS:
- Always pronounce "Nexella" as "Nex-EL-a" (not "Nex-ella")
- Say "CRM" as individual letters C-R-M (not "crum")
- Pronounce "GoHighLevel" with clear separation: "Go-High-Level"
- Say "Meta" (not "Facebook")
- Pronounce "API" as individual letters A-P-I

Remember: You MUST ask ALL SIX discovery questions before scheduling. Your goal is to have a natural, friendly conversation that leads to sending them a scheduling link. Keep it light, casual, and make them feel comfortable!`
    }
  ];

  // States for conversation flow
  let conversationState = 'introduction';  // introduction -> discovery -> booking -> completed
  let bookingInfo = {
    name: '',
    email: '',
    phone: '',
    preferredDay: '',
    schedulingLinkSent: false,
    userId: `user_${Date.now()}`
  };
  let discoveryData = {}; // Store answers to discovery questions
  let collectedContactInfo = false;
  let userHasSpoken = false;
  let webhookSent = false; // Track if we've sent the webhook
  let retryCount = 0; // Track retry attempts for error handling

  // Send connecting message
  ws.send(JSON.stringify({
    content: "connecting...",
    content_complete: true,
    actions: [],
    response_id: 0
  }));

  // Set a timer for auto-greeting if user doesn't speak first
  const autoGreetingTimer = setTimeout(() => {
    if (!userHasSpoken) {
      ws.send(JSON.stringify({
        content: "Hi there! This is Sarah from Nexella. How are you doing today?",
        content_complete: true,
        actions: [],
        response_id: 1
      }));
    }
  }, 5000); // 5 seconds delay

  ws.on('message', async (data) => {
    try {
      // Clear auto-greeting timer if user speaks first
      clearTimeout(autoGreetingTimer);
      userHasSpoken = true;
      
      const parsed = JSON.parse(data);
      
      // IMPROVED: Better metadata handling for call information
      if (parsed.call && parsed.call.call_id && !connectionData.callId) {
        connectionData.callId = parsed.call.call_id;
        
        // Store call metadata if available
        if (parsed.call.metadata) {
          connectionData.metadata = parsed.call.metadata;
          console.log('Call metadata received:', JSON.stringify(connectionData.metadata, null, 2));
          
          // Extract customer info from metadata if available
          if (connectionData.metadata.customer_name) {
            bookingInfo.name = connectionData.metadata.customer_name;
            collectedContactInfo = true;
            
            // Store name in conversation memory
            conversationMemory.speech_patterns.preferred_name = connectionData.metadata.customer_name.split(' ')[0];
            
            // Update system prompt with the user's name
            if (bookingInfo.name && bookingInfo.name.trim() !== '') {
              conversationHistory[0].content = conversationHistory[0].content.replace(/\[Name\]/g, bookingInfo.name);
            }
          }
          if (connectionData.metadata.customer_email) {
            bookingInfo.email = connectionData.metadata.customer_email;
            collectedContactInfo = true;
          }
          if (connectionData.metadata.to_number) {
            bookingInfo.phone = connectionData.metadata.to_number;
            collectedContactInfo = true;
          } else if (parsed.call.to_number) {
            bookingInfo.phone = parsed.call.to_number;
            collectedContactInfo = true;
          }
          
          // Store this call's metadata globally
          activeCallsMetadata.set(connectionData.callId, parsed.call.metadata);
          
          // Log what we've captured
          console.log(`Captured customer info for call ${connectionData.callId}:`, {
            name: bookingInfo.name,
            email: bookingInfo.email,
            phone: bookingInfo.phone
          });
        }
      }

      if (parsed.interaction_type === 'response_required') {
        const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
        const userMessage = latestUserUtterance?.content || "";
        const previousBotMessage = conversationHistory.length >= 2 ? 
            conversationHistory[conversationHistory.length - 1]?.content : "";

        console.log('User said:', userMessage);
        console.log('Current conversation state:', conversationState);
        
        // Check for user hesitation or confusion
        const userHesitation = trackHesitationIndicators(userMessage);
        if (userHesitation) {
          // If user seems confused, we can adjust our approach
          // For instance, we might use a more careful, clearly-articulated response
          console.log('User hesitation detected, will use clearer speech patterns');
          // Optionally, we could reduce temperature for more precise response
        }
        
        // Update conversation memory with user's message
        conversationMemory = updateConversationMemory(userMessage, conversationHistory, conversationMemory);

        // IMPROVED: Better discovery answer tracking
        if (conversationState === 'discovery') {
          // Match user answers to questions
          const lastBotMessage = conversationHistory[conversationHistory.length - 1];
          if (lastBotMessage && lastBotMessage.role === 'assistant') {
            
            // Check which discovery question was asked
            for (let i = 0; i < discoveryQuestions.length; i++) {
              const question = discoveryQuestions[i];
              const shortQuestionStart = question.toLowerCase().substring(0, 15);
              
              // Check if bot message contains this question
              if (lastBotMessage.content.toLowerCase().includes(shortQuestionStart)) {
                // Store the answer with question index
                discoveryData[`question_${i}`] = userMessage;
                console.log(`Stored answer to question ${i}: ${question}`);
                
                // Try to set the variable for the Retell call as well
                try {
                  if (parsed.call && parsed.call.call_id) {
                    const variableKey = `discovery_q${i}`;
                    const variableData = {
                      variables: {
                        [variableKey]: userMessage
                      }
                    };
                    
                    // Set the variable on the Retell call
                    axios.post(`https://api.retellai.com/v1/calls/${parsed.call.call_id}/variables`, 
                      variableData, 
                      {
                        headers: {
                          'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
                          'Content-Type': 'application/json'
                        }
                      }
                    ).catch(err => console.error(`Error setting discovery variable ${variableKey}:`, err));
                  }
                } catch (varError) {
                  console.error('Error setting call variable:', varError);
                }
                
                // Update the current question index for the next question
                discoveryProgress.currentQuestionIndex = i + 1;
                break;
              }
            }
          }
        }
        
        // Check if user wants to schedule
        if (userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss)\b/)) {
          console.log('User requested scheduling');
          // Only move to booking if we've completed discovery
          if (discoveryProgress.allQuestionsAsked) {
            conversationState = 'booking';
          }
        }
        
        // IMPROVED: Better day preference detection
        if (conversationState === 'booking' || 
           (conversationState === 'discovery' && discoveryProgress.allQuestionsAsked)) {
          const dayInfo = handleSchedulingPreference(userMessage);
          
          if (dayInfo && !webhookSent) {
            bookingInfo.preferredDay = dayInfo.dayName;
            
            // Alert the Retell agent through custom variables
            try {
              if (parsed.call && parsed.call.call_id) {
                await axios.post(`https://api.retellai.com/v1/calls/${parsed.call.call_id}/variables`, {
                  variables: {
                    preferredDay: bookingInfo.preferredDay,
                    schedulingComplete: true,
                    // Include full discovery data
                    discovery_data: JSON.stringify(discoveryData)
                  }
                }, {
                  headers: {
                    'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
                    'Content-Type': 'application/json'
                  }
                });
                console.log('Set Retell call variables for scheduling and discovery data');
              }
            } catch (variableError) {
              console.error('Error setting Retell variables:', variableError);
            }
            
            // Immediately send data to trigger server when we get a day preference
            console.log('Sending scheduling preference to trigger server with all collected data');
            const result = await sendSchedulingPreference(
              bookingInfo.name,
              bookingInfo.email,
              bookingInfo.phone,
              bookingInfo.preferredDay,
              connectionData.callId,
              discoveryData
            );
            
            // Mark as sent and continue conversation naturally
            bookingInfo.schedulingLinkSent = true;
            conversationState = 'completed';
            webhookSent = true;
            
            // Update conversation state in trigger server
            if (connectionData.callId) {
              await updateConversationState(connectionData.callId, true, bookingInfo.preferredDay);
            }
            
            console.log('Data sent to n8n and conversation marked as completed');
          }
        }

        // Add user message to conversation history
        conversationHistory.push({ role: 'user', content: userMessage });

        // Generate AI response with improved handler
        try {
          const botReply = await generateAIResponse(
            userMessage,
            conversationHistory,
            {
              conversationState,
              discoveryProgress,
              discoveryQuestions
            }
          );
          
          // Enhance response with conversation memory
          const enhancedReply = enhanceResponseWithMemory(botReply, conversationMemory);
          
          // Final speech pattern enhancement
          const naturalReply = enhanceSpeechPatterns(enhancedReply);
          
          // Add bot reply to conversation history
          conversationHistory.push({ role: 'assistant', content: naturalReply });

          // Check if discovery is complete based on bot reply
          const discoveryComplete = trackDiscoveryQuestions(naturalReply, discoveryProgress, discoveryQuestions);
          
          // Transition state based on content and tracking
          if (conversationState === 'introduction') {
            // Move to discovery after introduction
            conversationState = 'discovery';
          } else if (conversationState === 'discovery' && discoveryComplete) {
            // Transition to booking if all discovery questions are asked
            conversationState = 'booking';
            
            // Update conversation state in trigger server
            if (connectionData.callId) {
              updateConversationState(connectionData.callId, true, null);
            }
            
            console.log('Transitioning to booking state based on discovery completion');
          }

          // Reset retry count on successful response
          retryCount = 0;
          
          // Send the AI response
          ws.send(JSON.stringify({
            content: naturalReply,
            content_complete: true,
            actions: [],
            response_id: parsed.response_id
          }));
          
          // After sending the response, check if this should be our last message
          if (conversationState === 'completed' && !webhookSent && naturalReply.toLowerCase().includes('scheduling')) {
            // If we're in the completed state and talking about scheduling but haven't sent the webhook yet
            if (bookingInfo.email || connectionData.metadata?.customer_email) {
              console.log('Sending final webhook before conversation end');
              await sendSchedulingPreference(
                bookingInfo.name || connectionData.metadata?.customer_name || '',
                bookingInfo.email || connectionData.metadata?.customer_email || '',
                bookingInfo.phone || connectionData.metadata?.to_number || '',
                bookingInfo.preferredDay || 'Not specified',
                connectionData.callId,
                discoveryData
              );
              webhookSent = true;
            }
          }
        } catch (error) {
          console.error('Error generating AI response:', error);
          
          // Use enhanced error handler
          const { message, shouldEscalate } = handleConversationError(
            error, 
            conversationState,
            retryCount
          );
          
          // Add fallback response to conversation history
          conversationHistory.push({ role: 'assistant', content: message });
          
          // Send the fallback message
          ws.send(JSON.stringify({
            content: message,
            content_complete: true,
            actions: [],
            response_id: parsed.response_id
          }));
          
          // If we should escalate, try to move to booking
          if (shouldEscalate) {
            conversationState = 'booking';
          }
          
          // Increment retry count
          retryCount++;
        }
      }

    } catch (error) {
      console.error('Error handling message:', error.message);
      
      // Always try to send whatever data we have if an error occurs
      if (!webhookSent && connectionData.callId && (bookingInfo.email || connectionData.metadata?.customer_email)) {
        try {
          console.log('Sending webhook due to error');
          await sendSchedulingPreference(
            bookingInfo.name || connectionData.metadata?.customer_name || '',
            bookingInfo.email || connectionData.metadata?.customer_email || '',
            bookingInfo.phone || connectionData.metadata?.to_number || '',
            bookingInfo.preferredDay || 'Not specified',
            connectionData.callId,
            discoveryData
          );
          webhookSent = true;
        } catch (webhookError) {
          console.error('Failed to send webhook after error:', webhookError);
        }
      }
      
      // Get a random fallback message
      const fallbackMessage = speechPatternsDict.fallbacks[Math.floor(Math.random() * speechPatternsDict.fallbacks.length)];
      
      // Send a recovery message
      ws.send(JSON.stringify({
        content: fallbackMessage,
        content_complete: true,
        actions: [],
        response_id: parsed.response_id || 9999
      }));
    }
  });

  ws.on('close', async () => {
    console.log('Connection closed.');
    clearTimeout(autoGreetingTimer); // Clear the timer when connection closes
    
    // ALWAYS send data to trigger server when call ends, regardless of completion status
    if (!webhookSent && connectionData.callId) {
      try {
        // Get any metadata we can find for this call
        if (!bookingInfo.name && connectionData?.metadata?.customer_name) {
          bookingInfo.name = connectionData.metadata.customer_name;
        }
        if (!bookingInfo.email && connectionData?.metadata?.customer_email) {
          bookingInfo.email = connectionData.metadata.customer_email;
        }
        if (!bookingInfo.phone && connectionData?.metadata?.to_number) {
          bookingInfo.phone = connectionData.metadata.to_number;
        }

        console.log('Connection closed - sending final webhook data with discovery info:', discoveryData);
        await sendSchedulingPreference(
          bookingInfo.name || '',
          bookingInfo.email || '',
          bookingInfo.phone || '',
          bookingInfo.preferredDay || 'Call ended early',
          connectionData.callId,
          discoveryData
        );
        console.log(`Final data sent for call ${connectionData.callId}`);
        webhookSent = true;
      } catch (finalError) {
        console.error('Error sending final webhook:', finalError.message);
      }
      
      // Clean up
      activeCallsMetadata.delete(connectionData.callId);
      console.log(`Cleaned up metadata for call ${connectionData.callId}`);
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
      
      // Extract important call information
      const email = call.metadata?.customer_email || '';
      const name = call.metadata?.customer_name || '';
      const phone = call.to_number || '';
      let preferredDay = '';
      let discoveryData = {};
      
      // Look for preferred day in various locations
      if (call.variables && call.variables.preferredDay) {
        preferredDay = call.variables.preferredDay;
      } else if (call.custom_data && call.custom_data.preferredDay) {
        preferredDay = call.custom_data.preferredDay;
      } else if (call.analysis && call.analysis.custom_data) {
        try {
          const customData = typeof call.analysis.custom_data === 'string'
            ? JSON.parse(call.analysis.custom_data)
            : call.analysis.custom_data;
            
          if (customData.preferredDay) {
            preferredDay = customData.preferredDay;
          }
        } catch (error) {
          console.error('Error parsing custom data:', error);
        }
      }
      
      // Extract discovery data from variables, transcript, and custom data
      if (call.variables) {
        // Extract discovery-related variables
        Object.entries(call.variables).forEach(([key, value]) => {
          if (key.startsWith('discovery_') || key.includes('question_')) {
            discoveryData[key] = value;
          }
        });
      }
      
      // Extract from custom_data if any
      if (call.custom_data && call.custom_data.discovery_data) {
        try {
          const parsedData = typeof call.custom_data.discovery_data === 'string' 
            ? JSON.parse(call.custom_data.discovery_data)
            : call.custom_data.discovery_data;
            
          discoveryData = { ...discoveryData, ...parsedData };
        } catch (error) {
          console.error('Error parsing discovery data from custom_data:', error);
        }
      }
      
      // If no discovery data found yet, try to extract from transcript
      if (Object.keys(discoveryData).length === 0 && call.transcript && call.transcript.length > 0) {
        // Use the discovery questions to match answers in the transcript
        const discoveryQuestions = [
          'How did you hear about us?',
          'What line of business are you in? What\'s your business model?',
          'What\'s your main product and typical price point?',
          'Are you running ads (Meta, Google, TikTok)?',
          'Are you using a CRM like GoHighLevel?',
          'What problems are you running into?'
        ];
        
        // Find questions and their answers in the transcript
        call.transcript.forEach((item, index) => {
          if (item.role === 'assistant') {
            const botMessage = item.content.toLowerCase();
            
            // Try to match with our known discovery questions
            discoveryQuestions.forEach((question, qIndex) => {
              // If this bot message contains a discovery question
              if (botMessage.includes(question.toLowerCase().substring(0, 15))) {
                // Check if next message is from the user (the answer)
                if (call.transcript[index + 1] && call.transcript[index + 1].role === 'user') {
                  const answer = call.transcript[index + 1].content;
                  discoveryData[`question_${qIndex}`] = answer;
                }
              }
            });
          }
        });
      }
      
      // Send webhook for call ending events
      if ((event === 'call_ended' || event === 'call_analyzed') && email) {
        console.log(`Sending webhook for ${event} event with discovery data:`, discoveryData);
        
        try {
          // Use the trigger server to route the webhook
          await axios.post(`${process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/process-scheduling-preference`, {
            name,
            email,
            phone,
            preferredDay: preferredDay || 'Not specified',
            call_id: call.call_id,
            call_status: call.call_status,
            discovery_data: discoveryData,
            schedulingComplete: true
          });
          
          console.log(`Successfully sent webhook for ${event}`);
        } catch (error) {
          console.error(`Error sending webhook for ${event}:`, error);
        }
      }
      
      // Clean up any stored data
      activeCallsMetadata.delete(call.call_id);
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error handling Retell webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Nexella WebSocket Server with Calendly scheduling link integration is listening on port ${PORT}`);
});
