// src/handlers/WebSocketHandler.js - SIMPLE DEBUG VERSION
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
    
    // SIMPLE DEBUG - Just the essentials
    console.log('🔗 NEW CONNECTION - Call ID:', this.callId);
    
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
- If user asks about scheduling/times and you have 4+ questions answered, immediately provide availability`
      }
    ];
    
    this.userHasSpoken = false;
    this.webhookSent = false;
    this.lastBotMessage = '';
    this.questionAskedTimestamp = 0;
    
    this.initialize();
  }

  extractCallId(url) {
    const callIdMatch = url.match(/\/call_([a-f0-9]+)/);
    return callIdMatch ? `call_${callIdMatch[1]}` : null;
  }

  async initialize() {
    // Initialize discovery session
    this.initializeDiscoverySession();
    
    // Set up event handlers
    this.setupEventHandlers();
    
    // Send initial greeting
    this.sendInitialGreeting();
  }

  initializeDiscoverySession() {
    const session = globalDiscoveryManager.getSession(this.callId, {});
    
    // SIMPLE DEBUG OUTPUT
    console.log(`📊 SESSION STATUS - Call ID: ${this.callId}`);
    console.log(`📊 Questions: ${session.progress.questionsCompleted}/6`);
    console.log(`📊 Scheduling: ${session.progress.schedulingStarted ? 'STARTED' : 'NOT_STARTED'}`);
    console.log(`📊 Phase: ${session.progress.conversationPhase}`);
    
    // Show which questions are answered
    const answered = session.questions.filter(q => q.answered).map(q => q.field);
    console.log(`📊 Answered: [${answered.join(', ')}]`);
  }

  setupEventHandlers() {
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('error', this.handleError.bind(this));
  }

  sendInitialGreeting() {
    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    setTimeout(() => {
      if (!this.userHasSpoken) {
        if (!progress || progress.questionsCompleted === 0) {
          console.log('🎙️ Sending NEW greeting');
          this.sendResponse("Hi there! This is Sarah from Nexella AI. How are you doing today?", 1);
        } else {
          console.log('🎙️ Sending RESUME greeting');
          this.sendResponse("Welcome back! Let's continue our conversation.", 1);
        }
      }
    }, 3000);
  }

  sendResponse(content, responseId = null) {
    this.lastBotMessage = content;
    this.questionAskedTimestamp = Date.now();
    
    console.log('🤖 SENT:', content.substring(0, 50) + '...');
    
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
      
      if (parsed.interaction_type === 'response_required') {
        await this.processUserMessage(parsed);
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      this.sendResponse("I missed that. Could you repeat it?", 9999);
    }
  }

  async processUserMessage(parsed) {
    const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
    const userMessage = latestUserUtterance?.content || "";

    console.log(`🗣️ USER: "${userMessage}"`);
    
    // Get current progress
    const progress = globalDiscoveryManager.getProgress(this.callId);
    console.log(`📊 CURRENT: ${progress?.questionsCompleted}/6 questions, scheduling=${progress?.schedulingStarted}`);

    // Check for availability request
    const isAvailabilityRequest = /what times|when are you|when do you|available|schedule|appointment/i.test(userMessage);
    
    console.log(`❓ Availability request: ${isAvailabilityRequest}`);
    console.log(`❓ Can schedule: ${isAvailabilityRequest && progress?.questionsCompleted >= 4}`);

    if (isAvailabilityRequest && progress?.questionsCompleted >= 4) {
      console.log('🗓️ ✅ SWITCHING TO SCHEDULING MODE');
      
      globalDiscoveryManager.markSchedulingStarted(this.callId);
      
      try {
        const availabilityResponse = await generateAvailabilityResponse();
        const response = `Perfect! I have all the information I need. ${availabilityResponse}`;
        
        console.log('🗓️ ✅ SENT SCHEDULING RESPONSE');
        
        this.conversationHistory.push({ role: 'user', content: userMessage });
        this.conversationHistory.push({ role: 'assistant', content: response });
        
        this.sendResponse(response, parsed.response_id);
        return; // EXIT
      } catch (error) {
        console.log('🗓️ ⚠️ FALLBACK SCHEDULING RESPONSE');
        const fallbackResponse = "Perfect! Let me check my calendar. What day and time would work best for you?";
        
        this.conversationHistory.push({ role: 'user', content: userMessage });
        this.conversationHistory.push({ role: 'assistant', content: fallbackResponse });
        
        this.sendResponse(fallbackResponse, parsed.response_id);
        return; // EXIT
      }
    }

    console.log('📝 PROCESSING AS DISCOVERY');

    // Add to conversation history
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // Generate response
    const contextPrompt = this.generateContextPrompt();
    const botReply = await this.getAIResponse(contextPrompt);
    
    console.log(`🤖 REPLY: "${botReply.substring(0, 50)}..."`);
    
    this.conversationHistory.push({ role: 'assistant', content: botReply });

    // Check for discovery question in bot reply
    const questionDetected = globalDiscoveryManager.detectQuestionInBotMessage(this.callId, botReply);
    console.log(`🔍 Question detected in bot reply: ${questionDetected}`);

    // Try to capture answer
    if (progress?.waitingForAnswer && progress?.currentQuestionIndex >= 0) {
      const captured = globalDiscoveryManager.captureAnswer(
        this.callId, 
        progress.currentQuestionIndex, 
        userMessage.trim()
      );
      console.log(`📝 Answer captured: ${captured}`);
      
      if (captured) {
        const newProgress = globalDiscoveryManager.getProgress(this.callId);
        console.log(`📊 NEW PROGRESS: ${newProgress?.questionsCompleted}/6 questions`);
      }
    } else {
      // FALLBACK: Try to capture answer for the most recent question that was asked but not answered
      const session = globalDiscoveryManager.getSessionInfo(this.callId);
      if (session) {
        const lastAskedUnanswered = session.questions.findIndex(q => q.asked && !q.answered);
        if (lastAskedUnanswered >= 0) {
          console.log(`📝 FALLBACK: Trying to capture answer for Q${lastAskedUnanswered + 1}`);
          const captured = globalDiscoveryManager.captureAnswer(
            this.callId, 
            lastAskedUnanswered, 
            userMessage.trim()
          );
          if (captured) {
            console.log(`📝 FALLBACK SUCCESS: Captured answer for Q${lastAskedUnanswered + 1}`);
            const newProgress = globalDiscoveryManager.getProgress(this.callId);
            console.log(`📊 NEW PROGRESS: ${newProgress?.questionsCompleted}/6 questions`);
          }
        }
      }
    }

    this.sendResponse(botReply, parsed.response_id);
  }

  generateContextPrompt() {
    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    if (!progress) {
      return '\nNEW CONVERSATION: Start with discovery.';
    }

    if (progress.schedulingStarted) {
      return '\nSCHEDULING MODE: Provide times or ask preferences.';
    }

    if (progress.questionsCompleted < 6) {
      const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
      if (nextQuestion) {
        return `\nDISCOVERY (${progress.questionsCompleted}/6): Ask "${nextQuestion.question}"`;
      }
    }

    return '\nDISCOVERY COMPLETE: Offer scheduling.';
  }

  async getAIResponse(contextPrompt) {
    const messages = [...this.conversationHistory];
    if (contextPrompt) {
      messages[messages.length - 1].content += contextPrompt;
    }

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

      return openaiResponse.data.choices[0].message.content || "Could you tell me more about that?";
    } catch (error) {
      console.error('❌ OpenAI error:', error.message);
      return "I'm having trouble processing that. Could you repeat it?";
    }
  }

  async handleClose() {
    console.log('🔌 CONNECTION CLOSED');
    const sessionInfo = globalDiscoveryManager.getSessionInfo(this.callId);
    if (sessionInfo) {
      console.log(`💾 SESSION PRESERVED: ${sessionInfo.questionsCompleted}/6 questions`);
    }
  }

  handleError(error) {
    console.error('❌ WebSocket Error:', error);
  }
}

module.exports = WebSocketHandler;
