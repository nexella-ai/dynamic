// src/handlers/WebSocketHandler.js - DEBUG VERSION WITH EXTENSIVE LOGGING
const axios = require('axios');
const config = require('../config/environment');
const globalDiscoveryManager = require('../services/discovery/GlobalDiscoveryManager');
const { 
  checkAvailability, 
  generateAvailabilityResponse, 
  handleSchedulingPreference,
  suggestAlternativeTime,
  getAvailableTimeSlots 
} = require('../services/calendar/CalendarHelpers');
const { 
  sendSchedulingPreference, 
  addCallMetadata, 
  removeCallMetadata 
} = require('../services/webhooks/WebhookService');

class WebSocketHandler {
  constructor(ws, req) {
    this.ws = ws;
    this.req = req;
    this.callId = this.extractCallId(req.url);
    
    // EXTENSIVE DEBUG LOGGING
    console.log('🚨 ===========================================');
    console.log('🚨 NEW WEBSOCKET CONNECTION DEBUG INFO');
    console.log('🚨 ===========================================');
    console.log('🔗 Request URL:', req.url);
    console.log('🔗 Extracted Call ID:', this.callId);
    console.log('🧠 Current active sessions:', globalDiscoveryManager.getAllSessions());
    
    this.connectionData = {
      callId: this.callId,
      customerEmail: null,
      customerName: null,
      customerPhone: null
    };
    
    this.conversationHistory = [
      {
        role: 'system',
        content: `You are Sarah from Nexella AI. CRITICAL: Check the discovery status before asking questions.

DISCOVERY QUESTIONS (ask in this EXACT order, ONE AT A TIME):
1. "How did you hear about us?"
2. "What industry or business are you in?"
3. "What's your main product or service?"
4. "Are you currently running any ads?"
5. "Are you using any CRM system?"
6. "What are your biggest pain points or challenges?"

CRITICAL RULES:
- BEFORE asking any question, CHECK if it was already asked
- Do NOT repeat questions you've already asked
- If user asks about scheduling/times and you have 4+ questions answered, immediately provide availability
- Keep responses short and conversational`
      }
    ];
    
    this.userHasSpoken = false;
    this.webhookSent = false;
    this.lastBotMessage = '';
    this.questionAskedTimestamp = 0;
    this.schedulingDetected = false;
    this.calendarCheckResponse = '';
    this.schedulingInterrupted = false;
    
    this.initialize();
  }

  extractCallId(url) {
    console.log('🔍 Extracting call ID from URL:', url);
    const callIdMatch = url.match(/\/call_([a-f0-9]+)/);
    const extractedId = callIdMatch ? `call_${callIdMatch[1]}` : null;
    console.log('🔍 Extracted call ID:', extractedId);
    return extractedId;
  }

  async initialize() {
    console.log('🚨 INITIALIZING WEBSOCKET HANDLER');
    
    // Initialize discovery session FIRST
    this.initializeDiscoverySession();
    
    // Try to fetch call metadata
    if (this.callId) {
      await this.fetchCallMetadata();
    }
    
    // Set up event handlers
    this.setupEventHandlers();
    
    // Send initial greeting based on session state
    this.sendInitialGreeting();
  }

  initializeDiscoverySession() {
    console.log('🧠 INITIALIZING DISCOVERY SESSION');
    console.log('🧠 Call ID for session:', this.callId);
    
    // Get or create persistent discovery session
    const customerData = {
      email: this.connectionData.customerEmail,
      name: this.connectionData.customerName,
      phone: this.connectionData.customerPhone
    };
    
    const session = globalDiscoveryManager.getSession(this.callId, customerData);
    
    console.log('🚨 DISCOVERY SESSION RETRIEVED:');
    console.log('   📊 Questions Completed:', session.progress.questionsCompleted);
    console.log('   🗓️ Scheduling Started:', session.progress.schedulingStarted);
    console.log('   📝 Conversation Phase:', session.progress.conversationPhase);
    console.log('   ❓ All Questions Complete:', session.progress.allQuestionsCompleted);
    console.log('   ⏳ Waiting for Answer:', session.progress.waitingForAnswer);
    
    // Log each question status
    session.questions.forEach((q, index) => {
      console.log(`   Q${index + 1}: Asked=${q.asked}, Answered=${q.answered}, Answer="${q.answer}"`);
    });
    
    console.log('🚨 END DISCOVERY SESSION INFO');
  }

  async fetchCallMetadata() {
    // Keep existing fetchCallMetadata logic but with more logging
    console.log('🔍 Fetching call metadata...');
    // ... existing code ...
  }

  setupEventHandlers() {
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('error', this.handleError.bind(this));
  }

  sendInitialGreeting() {
    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    console.log('🎙️ DETERMINING INITIAL GREETING');
    console.log('🎙️ Progress:', progress);
    
    if (!progress || (progress.questionsCompleted === 0 && !progress.schedulingStarted)) {
      console.log('🎙️ Sending initial greeting (new session)');
      setTimeout(() => {
        if (!this.userHasSpoken) {
          this.sendResponse("Hi there! This is Sarah from Nexella AI. How are you doing today?", 1);
        }
      }, 3000);
    } else if (progress.questionsCompleted > 0 && !progress.schedulingStarted) {
      console.log('🎙️ Resuming discovery session');
      setTimeout(() => {
        if (!this.userHasSpoken) {
          const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
          if (nextQuestion) {
            const questionNum = globalDiscoveryManager.getSessionInfo(this.callId).questions.findIndex(q => q.question === nextQuestion.question) + 1;
            this.sendResponse(`Welcome back! Let me continue where we left off. ${nextQuestion.question}`, 1);
          }
        }
      }, 3000);
    } else if (progress.schedulingStarted) {
      console.log('🎙️ Resuming scheduling session');
      setTimeout(() => {
        if (!this.userHasSpoken) {
          this.sendResponse("Welcome back! Let's continue with scheduling your appointment. What day and time would work best for you?", 1);
        }
      }, 3000);
    }
  }

  sendResponse(content, responseId = null) {
    this.lastBotMessage = content;
    this.questionAskedTimestamp = Date.now();
    
    console.log('🤖 SENDING RESPONSE:', content);
    console.log('🤖 Response ID:', responseId);
    
    this.ws.send(JSON.stringify({
      content: content,
      content_complete: true,
      actions: [],
      response_id: responseId || Date.now()
    }));
  }

  async handleMessage(data) {
    try {
      this.userHasSpoken = true;
      const parsed = JSON.parse(data);
      
      console.log('📥 RECEIVED MESSAGE:', JSON.stringify(parsed, null, 2));
      
      if (parsed.interaction_type === 'response_required') {
        await this.processUserMessage(parsed);
      }
    } catch (error) {
      console.error('❌ Error handling message:', error.message);
      this.sendResponse("I missed that. Could you repeat it?", 9999);
    }
  }

  async processUserMessage(parsed) {
    const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
    const userMessage = latestUserUtterance?.content || "";

    console.log('🚨 PROCESSING USER MESSAGE');
    console.log('🗣️ User said:', userMessage);
    
    // Get FRESH progress from persistent storage
    const progress = globalDiscoveryManager.getProgress(this.callId);
    console.log('📊 FRESH Progress from storage:', progress);
    
    // Log session info
    const sessionInfo = globalDiscoveryManager.getSessionInfo(this.callId);
    console.log('🧠 Current session info:', sessionInfo);

    // CRITICAL: Check if this is an availability request
    const availabilityPatterns = [
      /what times/i,
      /when are you/i,
      /when do you/i,
      /available/i,
      /schedule/i,
      /appointment/i,
      /times.*available/i,
      /times.*next week/i
    ];
    
    const isAvailabilityRequest = availabilityPatterns.some(pattern => 
      pattern.test(userMessage)
    );
    
    console.log('❓ Is availability request?', isAvailabilityRequest);
    console.log('❓ Questions completed:', progress?.questionsCompleted);
    console.log('❓ Can start scheduling?', isAvailabilityRequest && progress?.questionsCompleted >= 4);

    if (isAvailabilityRequest && progress?.questionsCompleted >= 4) {
      console.log('🚨 🚨 🚨 AVAILABILITY REQUEST DETECTED - SHOULD SWITCH TO SCHEDULING');
      
      // Mark scheduling as started
      globalDiscoveryManager.markSchedulingStarted(this.callId);
      
      // Generate immediate scheduling response
      try {
        const availabilityResponse = await generateAvailabilityResponse();
        const response = `Perfect! I have all the information I need. ${availabilityResponse}`;
        
        console.log('✅ Generated scheduling response:', response);
        
        this.conversationHistory.push({ role: 'user', content: userMessage });
        this.conversationHistory.push({ role: 'assistant', content: response });
        
        this.sendResponse(response, parsed.response_id);
        return; // EXIT EARLY - CRITICAL
      } catch (error) {
        console.error('❌ Error generating availability:', error);
        const fallbackResponse = "Perfect! Let me check my calendar. What day and time would work best for you?";
        
        this.conversationHistory.push({ role: 'user', content: userMessage });
        this.conversationHistory.push({ role: 'assistant', content: fallbackResponse });
        
        this.sendResponse(fallbackResponse, parsed.response_id);
        return; // EXIT EARLY - CRITICAL
      }
    }

    // If we reach here, it's NOT an availability request or we don't have enough discovery data
    console.log('📝 Processing as normal conversation (not scheduling)');

    // Add user message to conversation history
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // Generate context prompt based on current state
    const contextPrompt = this.generateContextPrompt();
    console.log('🤖 Generated context prompt:', contextPrompt);

    // Get AI response
    const botReply = await this.getAIResponse(contextPrompt);
    console.log('🤖 AI Response:', botReply);
    
    this.conversationHistory.push({ role: 'assistant', content: botReply });

    // Check if AI response contains a discovery question
    this.checkForDiscoveryQuestion(botReply);

    // Try to capture user answer if we're waiting for one
    this.tryToCaptureAnswer(userMessage);

    // Send response
    this.sendResponse(botReply, parsed.response_id);
  }

  checkForDiscoveryQuestion(botReply) {
    console.log('🔍 Checking if bot reply contains discovery question:', botReply);
    
    const detected = globalDiscoveryManager.detectQuestionInBotMessage(this.callId, botReply);
    console.log('🔍 Question detected:', detected);
  }

  tryToCaptureAnswer(userMessage) {
    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    console.log('📝 Trying to capture answer:');
    console.log('   Waiting for answer:', progress?.waitingForAnswer);
    console.log('   Current question index:', progress?.currentQuestionIndex);
    console.log('   User message:', userMessage);
    
    if (progress?.waitingForAnswer && progress?.currentQuestionIndex >= 0) {
      const captured = globalDiscoveryManager.captureAnswer(
        this.callId, 
        progress.currentQuestionIndex, 
        userMessage.trim()
      );
      console.log('📝 Answer captured:', captured);
    }
  }

  generateContextPrompt() {
    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    console.log('🤖 Generating context prompt for progress:', progress);
    
    if (!progress) {
      return `

NEW CONVERSATION: Start with friendly greeting and begin discovery process.
Ask: "How did you hear about us?"`;
    }

    if (progress.schedulingStarted) {
      console.log('🗓️ Scheduling mode - no discovery prompts');
      return `

SCHEDULING MODE: User is ready to schedule. Provide available times or ask for preferences.`;
    }

    if (progress.questionsCompleted < 6) {
      const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
      if (nextQuestion) {
        const sessionInfo = globalDiscoveryManager.getSessionInfo(this.callId);
        const questionNumber = sessionInfo.questions.findIndex(q => q.question === nextQuestion.question) + 1;
        
        return `

DISCOVERY IN PROGRESS (${progress.questionsCompleted}/6 complete):
Next question to ask: ${questionNumber}. ${nextQuestion.question}

CRITICAL: Ask this question EXACTLY as written. Do NOT ask questions that were already answered.`;
      }
    }

    if (progress.allQuestionsCompleted) {
      return `

ALL DISCOVERY COMPLETE: Ready for scheduling. Offer available times.`;
    }

    return '';
  }

  async getAIResponse(contextPrompt) {
    const messages = [...this.conversationHistory];
    if (contextPrompt) {
      messages[messages.length - 1].content += contextPrompt;
    }

    console.log('🤖 Sending to OpenAI:', JSON.stringify(messages, null, 2));

    try {
      const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o',
        messages: messages,
        temperature: 0.7
      }, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      });

      const reply = openaiResponse.data.choices[0].message.content || "Could you tell me more about that?";
      console.log('🤖 OpenAI replied:', reply);
      return reply;
    } catch (error) {
      console.error('❌ OpenAI API error:', error.message);
      return "I'm having trouble processing that. Could you repeat it?";
    }
  }

  async handleClose() {
    console.log('🔌 CONNECTION CLOSED');
    console.log('💾 Session will be kept in memory for future connections');
    
    const sessionInfo = globalDiscoveryManager.getSessionInfo(this.callId);
    console.log('📊 Final session state:', sessionInfo);
  }

  handleError(error) {
    console.error('❌ WebSocket Error:', error);
  }
}

module.exports = WebSocketHandler;
