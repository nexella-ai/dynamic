// src/handlers/WebSocketHandler.js - BASED ON YOUR WORKING CODE PATTERN
const axios = require('axios');
const config = require('../config/environment');
const globalDiscoveryManager = require('../services/discovery/GlobalDiscoveryManager');
const { 
  autoBookAppointment,
  getAvailableTimeSlots,
  generateAvailabilityResponse
} = require('../services/calendar/CalendarHelpers');
const { 
  sendSchedulingPreference, 
  getActiveCallsMetadata
} = require('../services/webhooks/WebhookService');

class WebSocketHandler {
  constructor(ws, req) {
    this.ws = ws;
    this.req = req;
    
    console.log('🔗 NEW WEBSOCKET CONNECTION ESTABLISHED');
    console.log('Connection URL:', req.url);
    
    // Extract call ID from URL (EXACT COPY from working code)
    const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
    this.callId = callIdMatch ? `call_${callIdMatch[1]}` : null;
    
    console.log('📞 Extracted Call ID:', this.callId);
    
    // Store connection data with this WebSocket (EXACT COPY from working code)
    this.connectionData = {
      callId: this.callId,
      metadata: null,
      customerEmail: null,
      customerName: null,
      customerPhone: null,
      isOutboundCall: false,
      isAppointmentConfirmation: false
    };

    // Discovery system variables (EXACT COPY from working code)
    this.answerCaptureTimer = null;
    this.userResponseBuffer = [];
    this.isCapturingAnswer = false;

    // EXACT COPY: Discovery questions system from working code
    this.discoveryQuestions = [
      { question: 'How did you hear about us?', field: 'How did you hear about us', asked: false, answered: false, answer: '' },
      { question: 'What industry or business are you in?', field: 'Business/Industry', asked: false, answered: false, answer: '' },
      { question: 'What\'s your main product or service?', field: 'Main product', asked: false, answered: false, answer: '' },
      { question: 'Are you currently running any ads?', field: 'Running ads', asked: false, answered: false, answer: '' },
      { question: 'Are you using any CRM system?', field: 'Using CRM', asked: false, answered: false, answer: '' },
      { question: 'What are your biggest pain points or challenges?', field: 'Pain points', asked: false, answered: false, answer: '' }
    ];
    
    this.discoveryProgress = {
      currentQuestionIndex: -1,
      questionsCompleted: 0,
      allQuestionsCompleted: false,
      waitingForAnswer: false,
      lastAcknowledgment: ''
    };

    // EXACT COPY: System prompt from working code
    this.conversationHistory = [
      {
        role: 'system',
        content: `You are a customer service/sales representative for Nexella.io named "Sarah". Always introduce yourself as Sarah from Nexella.

CONVERSATION FLOW:
1. GREETING PHASE: Start with a warm greeting and ask how they're doing
2. BRIEF CHAT: Engage in 1-2 exchanges of pleasantries before discovery
3. TRANSITION: Naturally transition to discovery questions
4. DISCOVERY PHASE: Ask all 6 discovery questions systematically
5. SCHEDULING PHASE: Only after all 6 questions are complete

GREETING & TRANSITION GUIDELINES:
- Always start with: "Hi there! This is Sarah from Nexella AI. How are you doing today?"
- When they respond to how they're doing, acknowledge it warmly
- After 1-2 friendly exchanges, transition naturally with something like:
  "That's great to hear! I'd love to learn a bit more about you and your business so I can better help you today."
- Then start with the first discovery question

CRITICAL DISCOVERY REQUIREMENTS:
- You MUST ask ALL 6 discovery questions in the exact order listed below
- Ask ONE question at a time and wait for the customer's response
- Do NOT move to scheduling until ALL 6 questions are answered
- After each answer, acknowledge it briefly before asking the next question

DISCOVERY QUESTIONS (ask in this EXACT order):
1. "How did you hear about us?"
2. "What industry or business are you in?"
3. "What's your main product or service?"
4. "Are you currently running any ads?"
5. "Are you using any CRM system?"
6. "What are your biggest pain points or challenges?"

SPEAKING STYLE & PACING:
- Speak at a SLOW, measured pace - never rush your words
- Insert natural pauses between sentences using periods (.)
- Complete all your sentences fully - never cut off mid-thought
- Use shorter sentences rather than long, complex ones
- Keep your statements and questions concise but complete

PERSONALITY & TONE:
- Be warm and friendly but speak in a calm, measured way
- Use a consistent, even speaking tone throughout the conversation
- Use contractions and everyday language that sounds natural
- Maintain a calm, professional demeanor at all times
- If you ask a question with a question mark '?' go up in pitch and tone towards the end of the sentence.
- If you respond with "." always keep an even consistent tone towards the end of the sentence.

DISCOVERY FLOW:
- Only start discovery questions AFTER greeting exchange is complete
- After each answer, acknowledge it briefly with varied responses like:
  * "Perfect, thank you."
  * "Got it, that's helpful."
  * "Great, I understand."
  * "Excellent, thank you."
  * "That makes sense."
  * "Wonderful, thanks."
  * "I see, that's very helpful."
  * "Perfect, understood."
  * "Awesome, got it."
- CRITICAL: Never use the same acknowledgment twice in a row
- Keep acknowledgments short and natural
- Then immediately ask the next question
- Do NOT skip questions or assume answers
- Count your questions mentally: 1, 2, 3, 4, 5, 6

SCHEDULING APPROACH:
- ONLY after asking ALL 6 discovery questions, ask for scheduling preference
- Say: "Perfect! I have all the information I need. Let's schedule a call to discuss how we can help. What day would work best for you?"
- When they mention a day, acknowledge it and confirm scheduling

Remember: Start with greeting, have brief pleasant conversation, then systematically complete ALL 6 discovery questions before any scheduling discussion.`
      }
    ];

    // State management (EXACT COPY from working code)
    this.conversationState = 'introduction';
    this.bookingInfo = {
      name: this.connectionData.customerName || '',
      email: this.connectionData.customerEmail || '',
      phone: this.connectionData.customerPhone || '',
      preferredDay: '',
      schedulingLinkSent: false,
      userId: `user_${Date.now()}`
    };
    this.discoveryData = {};
    this.collectedContactInfo = !!this.connectionData.customerEmail;
    this.userHasSpoken = false;
    this.webhookSent = false;

    // Initialize (EXACT COPY from working code)
    this.initialize();
  }

  // EXACT COPY: Initialize method from working code
  async initialize() {
    // Try to fetch call metadata but don't block if it fails (EXACT COPY from working code)
    if (this.callId) {
      try {
        console.log('🔍 Fetching metadata for call:', this.callId);
        const TRIGGER_SERVER_URL = process.env.TRIGGER_SERVER_URL || config.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com';
        
        // Try multiple possible endpoints (EXACT COPY from working code)
        const possibleEndpoints = [
          `${TRIGGER_SERVER_URL}/api/get-call-data/${this.callId}`,
          `${TRIGGER_SERVER_URL}/get-call-info/${this.callId}`,
          `${TRIGGER_SERVER_URL}/call-data/${this.callId}`,
          `${TRIGGER_SERVER_URL}/api/call/${this.callId}`
        ];
        
        let metadataFetched = false;
        for (const endpoint of possibleEndpoints) {
          try {
            console.log(`Trying endpoint: ${endpoint}`);
            const response = await fetch(endpoint, { 
              timeout: 3000,
              headers: {
                'Content-Type': 'application/json'
              }
            });
            if (response.ok) {
              const callData = await response.json();
              console.log('📋 Retrieved call metadata:', callData);
              
              // Handle nested response structure (EXACT COPY from working code)
              const actualData = callData.data || callData;
              this.connectionData.metadata = actualData;
              
              // Extract data from metadata - handle both direct and nested structure (EXACT COPY from working code)
              this.connectionData.customerEmail = actualData.email || actualData.customer_email || actualData.user_email || 
                                               (actualData.metadata && actualData.metadata.customer_email);
              this.connectionData.customerName = actualData.name || actualData.customer_name || actualData.user_name ||
                                              (actualData.metadata && actualData.metadata.customer_name);
              this.connectionData.customerPhone = actualData.phone || actualData.customer_phone || actualData.to_number ||
                                               (actualData.metadata && actualData.metadata.customer_phone);
              
              console.log('📧 Extracted from metadata:', {
                email: this.connectionData.customerEmail,
                name: this.connectionData.customerName,
                phone: this.connectionData.customerPhone
              });
              
              // Check if this is an appointment confirmation call (EXACT COPY from working code)
              if (callData.call_type === 'appointment_confirmation') {
                this.connectionData.isAppointmentConfirmation = true;
                console.log('📅 This is an APPOINTMENT CONFIRMATION call');
              }
              
              metadataFetched = true;
              break;
            }
          } catch (endpointError) {
            console.log(`Endpoint ${endpoint} failed:`, endpointError.message);
          }
        }
        
        if (!metadataFetched) {
          console.log('⚠️ Could not fetch metadata from any endpoint - will try to get from WebSocket messages');
        }
        
      } catch (error) {
        console.log('❌ Error fetching call metadata:', error.message);
        console.log('🔄 Will extract data from WebSocket messages instead');
      }
    }
    
    console.log('Retell connected via WebSocket.');
    
    this.setupEventHandlers();

    // EXACT COPY: Send connecting message and auto-greeting from working code
    this.ws.send(JSON.stringify({
      content: "Hi there",
      content_complete: true,
      actions: [],
      response_id: 0
    }));

    // Send auto-greeting after a short delay (EXACT COPY from working code)
    setTimeout(() => {
      if (!this.userHasSpoken) {
        console.log('🎙️ Sending auto-greeting message');
        this.ws.send(JSON.stringify({
          content: "Hi there! This is Sarah from Nexella AI. How are you doing today?",
          content_complete: true,
          actions: [],
          response_id: 1
        }));
      }
    }, 4000);

    // Set a timer for auto-greeting if user doesn't speak first (EXACT COPY from working code)
    this.autoGreetingTimer = setTimeout(() => {
      if (!this.userHasSpoken) {
        console.log('🎙️ Sending backup auto-greeting');
        this.ws.send(JSON.stringify({
          content: "Hello! This is Sarah from Nexella AI. I'm here to help you today. How's everything going?",
          content_complete: true,
          actions: [],
          response_id: 2
        }));
      }
    }, 8000);
  }

  setupEventHandlers() {
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('error', this.handleError.bind(this));
  }

  // EXACT COPY: Message handling from working code
  async handleMessage(data) {
    try {
      clearTimeout(this.autoGreetingTimer);
      this.userHasSpoken = true;
      
      const parsed = JSON.parse(data);
      console.log('📥 Raw WebSocket Message:', JSON.stringify(parsed, null, 2));
      
      // Debug logging to see what we're receiving (EXACT COPY from working code)
      console.log('WebSocket message type:', parsed.interaction_type || 'unknown');
      if (parsed.call) {
        console.log('Call data structure:', JSON.stringify(parsed.call, null, 2));
      }
      
      // Extract call info from WebSocket messages first (EXACT COPY from working code)
      if (parsed.call && parsed.call.call_id) {
        if (!this.connectionData.callId) {
          this.connectionData.callId = parsed.call.call_id;
          console.log(`🔗 Got call ID from WebSocket: ${this.connectionData.callId}`);
        }
        
        // Extract metadata from call object (EXACT COPY from working code)
        if (parsed.call.metadata) {
          console.log('📞 Call metadata from WebSocket:', JSON.stringify(parsed.call.metadata, null, 2));
          
          if (!this.connectionData.customerEmail && parsed.call.metadata.customer_email) {
            this.connectionData.customerEmail = parsed.call.metadata.customer_email;
            this.bookingInfo.email = this.connectionData.customerEmail;
            console.log(`✅ Got email from WebSocket metadata: ${this.connectionData.customerEmail}`);
          }
          
          if (!this.connectionData.customerName && parsed.call.metadata.customer_name) {
            this.connectionData.customerName = parsed.call.metadata.customer_name;
            this.bookingInfo.name = this.connectionData.customerName;
            console.log(`✅ Got name from WebSocket metadata: ${this.connectionData.customerName}`);
          }
          
          if (!this.connectionData.customerPhone && (parsed.call.metadata.customer_phone || parsed.call.to_number)) {
            this.connectionData.customerPhone = parsed.call.metadata.customer_phone || parsed.call.to_number;
            this.bookingInfo.phone = this.connectionData.customerPhone;
            console.log(`✅ Got phone from WebSocket metadata: ${this.connectionData.customerPhone}`);
          }
        }
        
        // Extract phone from call object if not in metadata (EXACT COPY from working code)
        if (!this.connectionData.customerPhone && parsed.call.to_number) {
          this.connectionData.customerPhone = parsed.call.to_number;
          this.bookingInfo.phone = this.connectionData.customerPhone;
          console.log(`✅ Got phone from call object: ${this.connectionData.customerPhone}`);
        }
        
        // Store in active calls metadata map (EXACT COPY from working code)
        const activeCallsMetadata = getActiveCallsMetadata();
        if (activeCallsMetadata) {
          activeCallsMetadata.set(this.connectionData.callId, {
            customer_email: this.connectionData.customerEmail,
            customer_name: this.connectionData.customerName,
            phone: this.connectionData.customerPhone,
            to_number: this.connectionData.customerPhone
          });
        }
        
        this.collectedContactInfo = !!this.connectionData.customerEmail;
      }
      
      // ENHANCED: Get contact info when we connect to a call (BACKUP METHOD) - EXACT COPY from working code
      if (parsed.call && parsed.call.call_id && !this.collectedContactInfo) {
        // FIRST: Try to get contact info from trigger server using call_id
        try {
          console.log('📞 Fetching contact info from trigger server...');
          const triggerResponse = await axios.get(`${process.env.TRIGGER_SERVER_URL || config.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/get-call-info/${this.connectionData.callId}`, {
            timeout: 5000
          });
          
          if (triggerResponse.data && triggerResponse.data.success) {
            const callInfo = triggerResponse.data.data;
            if (!this.bookingInfo.email) this.bookingInfo.email = callInfo.email || '';
            if (!this.bookingInfo.name) this.bookingInfo.name = callInfo.name || '';
            if (!this.bookingInfo.phone) this.bookingInfo.phone = callInfo.phone || '';
            this.collectedContactInfo = true;
            
            console.log('✅ Got contact info from trigger server:', {
              name: this.bookingInfo.name,
              email: this.bookingInfo.email,
              phone: this.bookingInfo.phone
            });
            
            // Update system prompt with the actual customer name if we have it (EXACT COPY from working code)
            if (this.bookingInfo.name) {
              const systemPrompt = this.conversationHistory[0].content;
              this.conversationHistory[0].content = systemPrompt
                .replace(/\[Name\]/g, this.bookingInfo.name)
                .replace(/Monica/g, this.bookingInfo.name);
              console.log(`Updated system prompt with customer name: ${this.bookingInfo.name}`);
            }
          }
        } catch (triggerError) {
          console.log('⚠️ Could not fetch contact info from trigger server:', triggerError.message);
        }
      }

      if (parsed.interaction_type === 'response_required') {
        await this.processUserMessage(parsed);
      }
    } catch (error) {
      console.error('❌ Error handling message:', error.message);
      this.ws.send(JSON.stringify({
        content: "I missed that. Could you repeat it?",
        content_complete: true,
        actions: [],
        response_id: 9999
      }));
    }
  }

  // SIMPLIFIED: Process user message based on working code pattern
  async processUserMessage(parsed) {
    const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
    const userMessage = latestUserUtterance?.content || "";

    console.log('🗣️ User said:', userMessage);
    console.log('🔄 Current conversation state:', this.conversationState);
    console.log('📊 Discovery progress:', this.discoveryProgress);

    // SIMPLIFIED: Question detection (based on working code)
    if (this.conversationHistory.length >= 2) {
      const lastBotMessage = this.conversationHistory[this.conversationHistory.length - 1];
      if (lastBotMessage && lastBotMessage.role === 'assistant') {
        this.detectQuestionAsked(lastBotMessage.content);
      }
    }

    // SIMPLIFIED: Answer capture (based on working code)
    if (this.discoveryProgress.waitingForAnswer && userMessage.trim().length > 2) {
      this.captureUserAnswer(userMessage);
    }

    // Check for scheduling preference (EXACT COPY from working code)
    let schedulingDetected = false;
    if (this.discoveryProgress.allQuestionsCompleted && 
        userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow|today)\b/)) {
      
      console.log('🗓️ User mentioned scheduling after completing ALL discovery questions');
      
      const dayInfo = this.handleSchedulingPreference(userMessage);
      
      if (dayInfo && !this.webhookSent) {
        this.bookingInfo.preferredDay = dayInfo.dayName;
        schedulingDetected = true;
      }
    } else if (!this.discoveryProgress.allQuestionsCompleted && 
               userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss)\b/)) {
      console.log('⚠️ User mentioned scheduling but discovery is not complete. Continuing with questions.');
    }

    // Add user message to conversation history
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // SIMPLIFIED: Better context for GPT with question tracking (based on working code)
    let contextPrompt = this.generateContextPrompt();

    // Process with GPT
    const messages = [...this.conversationHistory];
    if (contextPrompt) {
      messages[messages.length - 1].content += contextPrompt;
    }

    try {
      const openaiResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: messages,
          temperature: 0.7
        },
        {
          headers: {
            Authorization: `Bearer ${config.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 8000
        }
      );

      const botReply = openaiResponse.data.choices[0].message.content || "Could you tell me a bit more about that?";

      // Add bot reply to conversation history (without context prompt)
      this.conversationHistory.push({ role: 'assistant', content: botReply });

      // Update conversation state (EXACT COPY from working code)
      if (this.conversationState === 'introduction') {
        this.conversationState = 'discovery';
      } else if (this.conversationState === 'discovery' && this.discoveryProgress.allQuestionsCompleted) {
        this.conversationState = 'booking';
        console.log('🔄 Transitioning to booking state - ALL 6 discovery questions completed');
      }

      // Send the AI response
      this.ws.send(JSON.stringify({
        content: botReply,
        content_complete: true,
        actions: [],
        response_id: parsed.response_id
      }));
      
      // FIXED: Enhanced webhook sending logic (EXACT COPY from working code)
      if (schedulingDetected && this.discoveryProgress.allQuestionsCompleted && !this.webhookSent) {
        console.log('🚀 SENDING WEBHOOK - All conditions met:');
        console.log('   ✅ All 6 discovery questions completed and answered');
        console.log('   ✅ Scheduling preference detected');
        console.log('   ✅ Contact info available');
        
        // Final validation of discovery data
        const finalDiscoveryData = {};
        this.discoveryQuestions.forEach((q, index) => {
          if (q.answered && q.answer) {
            finalDiscoveryData[q.field] = q.answer;
            finalDiscoveryData[`question_${index}`] = q.answer;
          }
        });
        
        console.log('📋 Final discovery data being sent:', JSON.stringify(finalDiscoveryData, null, 2));
        
        const result = await sendSchedulingPreference(
          this.bookingInfo.name || this.connectionData.customerName || '',
          this.bookingInfo.email || this.connectionData.customerEmail || '',
          this.bookingInfo.phone || this.connectionData.customerPhone || '',
          this.bookingInfo.preferredDay,
          this.connectionData.callId,
          finalDiscoveryData
        );
        
        if (result.success) {
          this.webhookSent = true;
          this.conversationState = 'completed';
          console.log('✅ Webhook sent successfully with all discovery data');
        }
      }
    } catch (error) {
      console.error('❌ Error with OpenAI:', error.message);
      this.ws.send(JSON.stringify({
        content: "I understand. Could you tell me more about that?",
        content_complete: true,
        actions: [],
        response_id: parsed.response_id
      }));
    }
  }

  // Add all the helper methods from working code
  detectQuestionAsked(botMessage) {
    // SIMPLIFIED version of working code logic
    const botContent = botMessage.toLowerCase();
    const nextQuestionIndex = this.discoveryQuestions.findIndex(q => !q.asked);
    
    if (nextQuestionIndex === -1 || this.discoveryProgress.waitingForAnswer) {
      return false;
    }
    
    const nextQuestion = this.discoveryQuestions[nextQuestionIndex];
    let detected = false;
    
    // Simple keyword detection for each question
    switch (nextQuestionIndex) {
      case 0: detected = botContent.includes('hear about') || botContent.includes('find us'); break;
      case 1: detected = (botContent.includes('industry') || botContent.includes('business')) && !botContent.includes('hear about'); break;
      case 2: detected = (botContent.includes('product') || botContent.includes('service')) && !botContent.includes('industry'); break;
      case 3: detected = (botContent.includes('running') && botContent.includes('ads')) || botContent.includes('advertising'); break;
      case 4: detected = botContent.includes('crm') || (botContent.includes('using') && botContent.includes('system')); break;
      case 5: detected = botContent.includes('pain point') || botContent.includes('challenge') || botContent.includes('biggest'); break;
    }
    
    if (detected) {
      console.log(`✅ DETECTED Question ${nextQuestionIndex + 1}: "${nextQuestion.question}"`);
      nextQuestion.asked = true;
      this.discoveryProgress.currentQuestionIndex = nextQuestionIndex;
      this.discoveryProgress.waitingForAnswer = true;
      this.userResponseBuffer = [];
      return true;
    }
    
    return false;
  }

  captureUserAnswer(userMessage) {
    if (!this.discoveryProgress.waitingForAnswer || this.isCapturingAnswer) return;
    
    const currentQ = this.discoveryQuestions[this.discoveryProgress.currentQuestionIndex];
    if (!currentQ || currentQ.answered) return;
    
    console.log(`📝 Buffering answer for Q${this.discoveryProgress.currentQuestionIndex + 1}: "${userMessage}"`);
    
    this.userResponseBuffer.push(userMessage.trim());
    
    if (this.answerCaptureTimer) {
      clearTimeout(this.answerCaptureTimer);
    }
    
    this.answerCaptureTimer = setTimeout(() => {
      if (this.isCapturingAnswer) return;
      
      this.isCapturingAnswer = true;
      
      const completeAnswer = this.userResponseBuffer.join(' ');
      
      currentQ.answered = true;
      currentQ.answer = completeAnswer;
      this.discoveryData[currentQ.field] = completeAnswer;
      this.discoveryData[`question_${this.discoveryProgress.currentQuestionIndex}`] = completeAnswer;
      
      this.discoveryProgress.questionsCompleted++;
      this.discoveryProgress.waitingForAnswer = false;
      this.discoveryProgress.allQuestionsCompleted = this.discoveryQuestions.every(q => q.answered);
      
      console.log(`✅ CAPTURED Q${this.discoveryProgress.currentQuestionIndex + 1}: "${completeAnswer}"`);
      console.log(`📊 Progress: ${this.discoveryProgress.questionsCompleted}/6 questions completed`);
      
      this.userResponseBuffer = [];
      this.isCapturingAnswer = false;
      this.answerCaptureTimer = null;
      
    }, 3000);
  }

  generateContextPrompt() {
    if (!this.discoveryProgress.allQuestionsCompleted) {
      const nextUnanswered = this.discoveryQuestions.find(q => !q.answered);
      if (nextUnanswered) {
        const questionNumber = this.discoveryQuestions.indexOf(nextUnanswered) + 1;
        const completed = this.discoveryQuestions.filter(q => q.answered).map((q, i) => `${this.discoveryQuestions.indexOf(q) + 1}. ${q.question} ✓`).join('\n');
        
        return `\n\nDISCOVERY STATUS:
COMPLETED (${this.discoveryProgress.questionsCompleted}/6):
${completed || 'None yet'}

NEXT TO ASK:
${questionNumber}. ${nextUnanswered.question}

CRITICAL: Ask question ${questionNumber} next. Do NOT repeat completed questions. Do NOT skip to scheduling until all 6 are done.`;
      }
    } else {
      return '\n\nAll 6 discovery questions completed. Proceed to scheduling.';
    }
    return '';
  }

  handleSchedulingPreference(userMessage) {
    // EXACT COPY from working code
    const dayMatch = userMessage.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow|today)\b/i);
    const nextWeekMatch = userMessage.match(/next week/i);
    
    if (nextWeekMatch) {
      let targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 7);
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
      
      if (preferredDay === 'tomorrow') {
        targetDate.setDate(targetDate.getDate() + 1);
        return { dayName: 'tomorrow', date: targetDate, isSpecific: true };
      } else if (preferredDay === 'today') {
        return { dayName: 'today', date: targetDate, isSpecific: true };
      } else {
        const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const requestedDayIndex = daysOfWeek.findIndex(d => d === preferredDay);
        
        if (requestedDayIndex !== -1) {
          const currentDay = targetDate.getDay();
          let daysToAdd = requestedDayIndex - currentDay;
          
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

  async handleClose() {
    console.log('🔌 Connection closed.');
    clearTimeout(this.autoGreetingTimer);
    
    // Clear any pending answer capture timer (EXACT COPY from working code)
    if (this.answerCaptureTimer) {
      clearTimeout(this.answerCaptureTimer);
      console.log('🧹 Cleared pending answer capture timer');
    }
    
    // If we have a pending answer in the buffer, capture it now (EXACT COPY from working code)
    if (this.userResponseBuffer.length > 0 && this.discoveryProgress.waitingForAnswer) {
      const currentQ = this.discoveryQuestions[this.discoveryProgress.currentQuestionIndex];
      if (currentQ && !currentQ.answered) {
        const completeAnswer = this.userResponseBuffer.join(' ');
        currentQ.answered = true;
        currentQ.answer = completeAnswer;
        this.discoveryData[currentQ.field] = completeAnswer;
        this.discoveryData[`question_${this.discoveryProgress.currentQuestionIndex}`] = completeAnswer;
        this.discoveryProgress.questionsCompleted++;
        console.log(`🔌 Captured buffered answer on close: "${completeAnswer}"`);
      }
    }
    
    console.log('=== FINAL CONNECTION CLOSE ANALYSIS ===');
    console.log('📋 Final discoveryData:', JSON.stringify(this.discoveryData, null, 2));
    console.log('📊 Questions completed:', this.discoveryProgress.questionsCompleted);
    console.log('📊 All questions completed:', this.discoveryProgress.allQuestionsCompleted);
    
    // Detailed breakdown of each question (EXACT COPY from working code)
    this.discoveryQuestions.forEach((q, index) => {
      console.log(`Question ${index + 1}: Asked=${q.asked}, Answered=${q.answered}, Answer="${q.answer}"`);
    });
    
    // FINAL webhook attempt only if we have meaningful data and haven't sent yet (EXACT COPY from working code)
    if (!this.webhookSent && this.connectionData.callId && this.discoveryProgress.questionsCompleted >= 2) {
      try {
        const finalEmail = this.connectionData.customerEmail || this.bookingInfo.email || '';
        const finalName = this.connectionData.customerName || this.bookingInfo.name || '';
        const finalPhone = this.connectionData.customerPhone || this.bookingInfo.phone || '';
        
        console.log('🚨 FINAL WEBHOOK ATTEMPT on connection close');
        console.log(`📊 Sending with ${this.discoveryProgress.questionsCompleted}/6 questions completed`);
        
        // Create final discovery data from answered questions
        const finalDiscoveryData = {};
        this.discoveryQuestions.forEach((q, index) => {
          if (q.answered && q.answer) {
            finalDiscoveryData[q.field] = q.answer;
            finalDiscoveryData[`question_${index}`] = q.answer;
          }
        });
        
        await sendSchedulingPreference(
          finalName,
          finalEmail,
          finalPhone,
          this.bookingInfo.preferredDay || 'Call ended early',
          this.connectionData.callId,
          finalDiscoveryData
        );
        
        console.log('✅ Final webhook sent successfully on connection close');
        this.webhookSent = true;
      } catch (finalError) {
        console.error('❌ Final webhook failed:', finalError.message);
      }
    }
    
    // Clean up (EXACT COPY from working code)
    if (this.connectionData.callId) {
      const activeCallsMetadata = getActiveCallsMetadata();
      if (activeCallsMetadata) {
        activeCallsMetadata.delete(this.connectionData.callId);
        console.log(`🧹 Cleaned up metadata for call ${this.connectionData.callId}`);
      }
    }
  }

  handleError(error) {
    console.error('❌ WebSocket Error:', error.message);
  }
}

module.exports = WebSocketHandler;
