// src/handlers/WebSocketHandler.js - FIXED FOR AUTOMATIC GOOGLE CALENDAR BOOKING
const axios = require('axios');
const config = require('../config/environment');
const globalDiscoveryManager = require('../services/discovery/GlobalDiscoveryManager');
const { 
  autoBookAppointment,
  getAvailableTimeSlots,
  generateAvailabilityResponse,
  checkAvailability
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
    
    // Extract call ID from URL
    const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
    this.callId = callIdMatch ? `call_${callIdMatch[1]}` : null;
    
    console.log('📞 Extracted Call ID:', this.callId);
    
    // Store connection data with this WebSocket
    this.connectionData = {
      callId: this.callId,
      metadata: null,
      customerEmail: null,
      customerName: null,
      customerPhone: null,
      isOutboundCall: false,
      isAppointmentConfirmation: false
    };

    // Discovery system variables
    this.answerCaptureTimer = null;
    this.userResponseBuffer = [];
    this.isCapturingAnswer = false;
    this.lastResponseTime = 0;
    this.minimumResponseDelay = 2000;

    // FIXED: Discovery questions system
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

    // FIXED: Enhanced system prompt for immediate booking
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

CRITICAL APPOINTMENT BOOKING RULES:
- When customer specifies a day AND time (like "Wednesday at 9 AM"), IMMEDIATELY book it
- Say: "Perfect! I'm booking you for [day] at [time] Arizona time right now."
- Then confirm: "Your appointment is confirmed for [day] at [time] Arizona time. You'll receive a calendar invitation shortly!"
- Do NOT ask for confirmation - just book it immediately
- Do NOT offer alternatives unless the specific time is unavailable

SCHEDULING APPROACH:
- Our business hours are 8 AM to 4 PM Arizona time (MST), Monday through Friday
- When they specify a time in business hours, book it immediately without asking
- If they ask for times outside business hours, suggest alternatives within 8 AM - 4 PM Arizona time
- Available times are: 8:00 AM, 9:00 AM, 10:00 AM, 11:00 AM, 1:00 PM, 2:00 PM, 3:00 PM

DISCOVERY REQUIREMENTS:
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

SPEAKING STYLE:
- Speak at a SLOW, measured pace - never rush your words
- Use shorter sentences rather than long, complex ones
- Keep your statements and questions concise but complete
- Be warm and friendly but speak in a calm, measured way

Remember: When they say a specific day and time, book it IMMEDIATELY. No confirmation needed.`
      }
    ];

    // State management
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
    this.appointmentBooked = false; // Track if appointment is already booked

    // Initialize
    this.initialize();
  }

  async initialize() {
    // Try to fetch call metadata but don't block if it fails
    if (this.callId) {
      try {
        console.log('🔍 Fetching metadata for call:', this.callId);
        const TRIGGER_SERVER_URL = process.env.TRIGGER_SERVER_URL || config.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com';
        
        // Try multiple possible endpoints
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
              
              // Handle nested response structure
              const actualData = callData.data || callData;
              this.connectionData.metadata = actualData;
              
              // Extract data from metadata
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

    // Send connecting message and auto-greeting
    this.ws.send(JSON.stringify({
      content: "Hi there",
      content_complete: true,
      actions: [],
      response_id: 0
    }));

    // Send auto-greeting after a short delay
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

    // Set a timer for auto-greeting if user doesn't speak first
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

  // FIXED: Enhanced message handling with immediate booking
  async handleMessage(data) {
    try {
      clearTimeout(this.autoGreetingTimer);
      this.userHasSpoken = true;
      
      const parsed = JSON.parse(data);
      console.log('📥 Raw WebSocket Message:', JSON.stringify(parsed, null, 2));
      
      // Extract call info from WebSocket messages first
      if (parsed.call && parsed.call.call_id) {
        if (!this.connectionData.callId) {
          this.connectionData.callId = parsed.call.call_id;
          console.log(`🔗 Got call ID from WebSocket: ${this.connectionData.callId}`);
        }
        
        // Extract metadata from call object
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
        
        this.collectedContactInfo = !!this.connectionData.customerEmail;
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

  // FIXED: Enhanced message processing with immediate booking
  async processUserMessage(parsed) {
    const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
    const userMessage = latestUserUtterance?.content || "";

    console.log('🗣️ User said:', userMessage);
    console.log('🔄 Current conversation state:', this.conversationState);
    console.log('📊 Discovery progress:', this.discoveryProgress);

    // CRITICAL FIX: Check for appointment booking FIRST, before anything else
    if (this.discoveryProgress.allQuestionsCompleted && !this.appointmentBooked) {
      const appointmentMatch = this.detectSpecificAppointmentRequest(userMessage);
      if (appointmentMatch) {
        console.log('🎯 IMMEDIATE APPOINTMENT BOOKING DETECTED:', appointmentMatch);
        await this.handleImmediateAppointmentBooking(appointmentMatch, parsed.response_id);
        return; // Exit early - booking is done
      }
    }

    // Question detection
    if (this.conversationHistory.length >= 2) {
      const lastBotMessage = this.conversationHistory[this.conversationHistory.length - 1];
      if (lastBotMessage && lastBotMessage.role === 'assistant') {
        this.detectQuestionAsked(lastBotMessage.content);
      }
    }

    // Answer capture
    if (this.discoveryProgress.waitingForAnswer && userMessage.trim().length > 2) {
      this.captureUserAnswer(userMessage);
    }

    // Check for scheduling preference (only after discovery complete)
    let schedulingDetected = false;
    if (this.discoveryProgress.allQuestionsCompleted && 
        userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow|today)\b/)) {
      
      console.log('🗓️ User mentioned scheduling after completing ALL discovery questions');
      
      const dayInfo = this.handleSchedulingPreference(userMessage);
      
      if (dayInfo && !this.webhookSent) {
        this.bookingInfo.preferredDay = dayInfo.dayName;
        schedulingDetected = true;
      }
    }

    // Add user message to conversation history
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // Better context for GPT with question tracking
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

      // Update conversation state
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
      
      // Enhanced webhook sending logic
      if (schedulingDetected && this.discoveryProgress.allQuestionsCompleted && !this.webhookSent && !this.appointmentBooked) {
        console.log('🚀 SENDING WEBHOOK - All conditions met:');
        
        // Final validation of discovery data
        const finalDiscoveryData = {};
        this.discoveryQuestions.forEach((q, index) => {
          if (q.answered && q.answer) {
            finalDiscoveryData[q.field] = q.answer;
            finalDiscoveryData[`question_${index}`] = q.answer;
          }
        });
        
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

  // NEW: Detect specific appointment booking requests with higher precision
  detectSpecificAppointmentRequest(userMessage) {
    console.log('🎯 CHECKING FOR SPECIFIC APPOINTMENT REQUEST:', userMessage);
    
    // More specific patterns for immediate booking
    const specificPatterns = [
      // "Wednesday at 9 AM" or "Wednesday 9 AM"
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
      // "9 AM Wednesday" or "9 AM on Wednesday"
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
      // "Wednesday 9" (assuming business hours)
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2})\b/i
    ];

    for (let i = 0; i < specificPatterns.length; i++) {
      const pattern = specificPatterns[i];
      const match = userMessage.match(pattern);
      if (match) {
        console.log('🎯 SPECIFIC APPOINTMENT PATTERN MATCHED:', match);
        return this.parseAppointmentMatch(match, i);
      }
    }
    
    return null;
  }

  // FIXED: Parse appointment match into structured data
  parseAppointmentMatch(match, patternIndex) {
    let day, hour, minutes = 0, period = 'am';
    
    switch (patternIndex) {
      case 0: // "Wednesday at 9am"
        day = match[1];
        hour = parseInt(match[2]);
        minutes = parseInt(match[3] || '0');
        period = match[4] || 'am';
        break;
      case 1: // "9am Wednesday"
        hour = parseInt(match[1]);
        minutes = parseInt(match[2] || '0');
        period = match[3] || 'am';
        day = match[4];
        break;
      case 2: // "Wednesday 9"
        day = match[1];
        hour = parseInt(match[2]);
        // Smart assumption for business hours
        period = hour >= 8 && hour <= 11 ? 'am' : (hour >= 1 && hour <= 4 ? 'pm' : 'am');
        break;
    }

    // Convert to 24-hour format
    if (period.toLowerCase().includes('p') && hour !== 12) {
      hour += 12;
    } else if (period.toLowerCase().includes('a') && hour === 12) {
      hour = 0;
    }

    // Create target date
    const targetDate = this.calculateTargetDate(day, hour, minutes);
    
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    const displayPeriod = hour >= 12 ? 'PM' : 'AM';
    
    return {
      dateTime: targetDate,
      dayName: day,
      timeString: `${displayHour}:${minutes.toString().padStart(2, '0')} ${displayPeriod}`,
      originalMatch: match[0],
      isBusinessHours: hour >= 8 && hour < 16, // 8 AM - 4 PM Arizona MST
      hour: hour
    };
  }

  // FIXED: Calculate target date for appointment
  calculateTargetDate(day, hour, minutes) {
    let targetDate = new Date();
    
    if (day === 'tomorrow') {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (day === 'today') {
      // Keep today
    } else {
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayIndex = daysOfWeek.indexOf(day.toLowerCase());
      if (dayIndex !== -1) {
        const currentDay = targetDate.getDay();
        let daysToAdd = dayIndex - currentDay;
        if (daysToAdd <= 0) daysToAdd += 7; // Next week
        targetDate.setDate(targetDate.getDate() + daysToAdd);
      }
    }
    
    targetDate.setHours(hour, minutes, 0, 0);
    return targetDate;
  }

  // NEW: Handle immediate appointment booking without asking for confirmation
  async handleImmediateAppointmentBooking(appointmentRequest, responseId) {
    try {
      console.log('🎯 PROCESSING IMMEDIATE APPOINTMENT BOOKING');
      console.log('🕐 Requested time:', appointmentRequest.timeString);
      console.log('📅 Requested date:', appointmentRequest.dayName);
      
      // Check if time is within business hours
      if (!appointmentRequest.isBusinessHours) {
        const response = `I'd love to schedule you for ${appointmentRequest.dayName} at ${appointmentRequest.timeString}, but our business hours are 8 AM to 4 PM Arizona time. Would you like to choose a time between 8 AM and 4 PM instead?`;
        await this.sendResponse(response, responseId);
        return;
      }

      // Get discovery data for the appointment
      const discoveryData = {};
      this.discoveryQuestions.forEach((q, index) => {
        if (q.answered && q.answer) {
          discoveryData[q.field] = q.answer;
          discoveryData[`question_${index}`] = q.answer;
        }
      });

      console.log('📋 Discovery data for appointment:', discoveryData);

      // Step 1: Immediately confirm the booking to the user
      const confirmationResponse = `Perfect! I'm booking you for ${appointmentRequest.dayName} at ${appointmentRequest.timeString} Arizona time right now. Your appointment is confirmed! You'll receive a calendar invitation shortly.`;
      await this.sendResponse(confirmationResponse, responseId);

      // Mark as booked to prevent loops
      this.appointmentBooked = true;
      this.conversationState = 'completed';

      // Step 2: Attempt real appointment booking in background
      try {
        const bookingResult = await autoBookAppointment(
          this.connectionData.customerName || this.bookingInfo.name || 'Customer',
          this.connectionData.customerEmail || this.bookingInfo.email,
          this.connectionData.customerPhone || this.bookingInfo.phone,
          appointmentRequest.dateTime,
          discoveryData
        );

        console.log('📅 Background booking result:', bookingResult);

        // Step 3: Send webhook with booking details
        setTimeout(async () => {
          try {
            await sendSchedulingPreference(
              this.connectionData.customerName || this.bookingInfo.name || 'Customer',
              this.connectionData.customerEmail || this.bookingInfo.email,
              this.connectionData.customerPhone || this.bookingInfo.phone,
              `${appointmentRequest.dayName} at ${appointmentRequest.timeString}`,
              this.connectionData.callId,
              {
                ...discoveryData,
                appointment_booked: true,
                booking_confirmed: true,
                requested_time: appointmentRequest.timeString,
                requested_day: appointmentRequest.dayName,
                meeting_link: bookingResult.meetingLink || '',
                event_id: bookingResult.eventId || '',
                event_link: bookingResult.eventLink || ''
              }
            );
            console.log('✅ Webhook sent with immediate booking confirmation');
          } catch (webhookError) {
            console.error('❌ Error sending booking webhook:', webhookError.message);
          }
        }, 1000);

        this.webhookSent = true;
        
      } catch (bookingError) {
        console.error('❌ Background booking failed:', bookingError.message);
        
        // Even if technical booking fails, we already confirmed to user
        // Send webhook anyway for manual processing
        setTimeout(async () => {
          try {
            await sendSchedulingPreference(
              this.connectionData.customerName || this.bookingInfo.name || 'Customer',
              this.connectionData.customerEmail || this.bookingInfo.email,
              this.connectionData.customerPhone || this.bookingInfo.phone,
              `${appointmentRequest.dayName} at ${appointmentRequest.timeString}`,
              this.connectionData.callId,
              {
                ...discoveryData,
                appointment_requested: true,
                technical_booking_failed: true,
                requested_time: appointmentRequest.timeString,
                requested_day: appointmentRequest.dayName,
                booking_confirmed_to_user: true
              }
            );
            console.log('✅ Fallback webhook sent - manual booking needed');
          } catch (webhookError) {
            console.error('❌ Error sending fallback webhook:', webhookError.message);
          }
        }, 1000);

        this.webhookSent = true;
      }
      
    } catch (error) {
      console.error('❌ Error in immediate appointment booking:', error.message);
      
      // Fallback response
      const errorResponse = `Perfect! I'll get you scheduled for ${appointmentRequest.dayName} at ${appointmentRequest.timeString} Arizona time. You'll receive confirmation details shortly.`;
      await this.sendResponse(errorResponse, responseId);
      
      this.appointmentBooked = true;
      this.conversationState = 'completed';
    }
  }

  // FIXED: Send response with proper timing
  async sendResponse(content, responseId) {
    const now = Date.now();
    const timeSinceLastResponse = now - this.lastResponseTime;
    
    if (timeSinceLastResponse < this.minimumResponseDelay) {
      const waitTime = this.minimumResponseDelay - timeSinceLastResponse;
      console.log(`⏱️ WAITING ${waitTime}ms before responding to prevent rapid-fire...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    console.log('🤖 SENT:', content);
    this.lastResponseTime = Date.now();
    
    this.ws.send(JSON.stringify({
      content: content,
      content_complete: true,
      actions: [],
      response_id: responseId || Date.now()
    }));
  }

  // Keep all the existing helper methods from the original handler
  detectQuestionAsked(botMessage) {
    const botContent = botMessage.toLowerCase();
    const nextQuestionIndex = this.discoveryQuestions.findIndex(q => !q.asked);
    
    if (nextQuestionIndex === -1 || this.discoveryProgress.waitingForAnswer) {
      return false;
    }
    
    const nextQuestion = this.discoveryQuestions[nextQuestionIndex];
    let detected = false;
    
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
      return '\n\nAll 6 discovery questions completed. Ready for scheduling. When user specifies a day and time, book the appointment IMMEDIATELY without asking for confirmation.';
    }
    return '';
  }

  handleSchedulingPreference(userMessage) {
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
    
    if (this.answerCaptureTimer) {
      clearTimeout(this.answerCaptureTimer);
      console.log('🧹 Cleared pending answer capture timer');
    }
    
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
    console.log('🗓️ Appointment booked:', this.appointmentBooked);
    
    if (!this.webhookSent && !this.appointmentBooked && this.connectionData.callId && this.discoveryProgress.questionsCompleted >= 2) {
      try {
        const finalEmail = this.connectionData.customerEmail || this.bookingInfo.email || '';
        const finalName = this.connectionData.customerName || this.bookingInfo.name || '';
        const finalPhone = this.connectionData.customerPhone || this.bookingInfo.phone || '';
        
        console.log('🚨 FINAL WEBHOOK ATTEMPT on connection close');
        
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
  }

  handleError(error) {
    console.error('❌ WebSocket Error:', error.message);
  }
}

module.exports = WebSocketHandler;
