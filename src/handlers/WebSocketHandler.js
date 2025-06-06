// src/handlers/WebSocketHandler.js - WebSocket Connection Management
const axios = require('axios');
const config = require('../config/environment');
const DiscoveryService = require('../services/discovery/DiscoveryService');
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
    this.connectionData = {
      callId: this.callId,
      customerEmail: null,
      customerName: null,
      customerPhone: null
    };
    
    // Initialize discovery service
    this.discovery = new DiscoveryService();
    
    // Conversation state
    this.conversationHistory = [
      {
        role: 'system',
        content: `You are Sarah from Nexella AI. Follow this exact flow:

1. GREETING: "Hi there! This is Sarah from Nexella AI. How are you doing today?"
2. DISCOVERY: Ask ALL 6 questions in order, one at a time
3. SCHEDULING: Only after all 6 questions, show available times

DISCOVERY QUESTIONS (exact order):
1. "How did you hear about us?"
2. "What industry or business are you in?"
3. "What's your main product or service?"  
4. "Are you currently running any ads?"
5. "Are you using any CRM system?"
6. "What are your biggest pain points or challenges?"

After each answer, briefly acknowledge then ask the next question.

SCHEDULING RULES:
- ONLY start scheduling after all 6 questions complete
- Present specific available times from calendar
- If requested time unavailable, suggest alternatives
- Confirm bookings immediately

Speak calmly and naturally. Never repeat questions or get stuck in loops.`
      }
    ];
    
    this.conversationState = 'introduction';
    this.bookingInfo = {
      name: this.connectionData.customerName || '',
      email: this.connectionData.customerEmail || '',
      phone: this.connectionData.customerPhone || '',
      preferredDay: ''
    };
    
    this.userHasSpoken = false;
    this.webhookSent = false;
    
    console.log('🔗 NEW WEBSOCKET CONNECTION');
    console.log('📞 Extracted Call ID:', this.callId);
    
    this.initialize();
  }

  extractCallId(url) {
    const callIdMatch = url.match(/\/call_([a-f0-9]+)/);
    return callIdMatch ? `call_${callIdMatch[1]}` : null;
  }

  async initialize() {
    // Try to fetch call metadata
    if (this.callId) {
      await this.fetchCallMetadata();
    }
    
    // Set up event handlers
    this.setupEventHandlers();
    
    // Send initial greeting after delay
    this.sendInitialGreeting();
  }

  async fetchCallMetadata() {
    try {
      console.log('🔍 Fetching metadata for call:', this.callId);
      const possibleEndpoints = [
        `${config.TRIGGER_SERVER_URL}/api/get-call-data/${this.callId}`,
        `${config.TRIGGER_SERVER_URL}/get-call-info/${this.callId}`,
        `${config.TRIGGER_SERVER_URL}/call-data/${this.callId}`,
        `${config.TRIGGER_SERVER_URL}/api/call/${this.callId}`
      ];
      
      let metadataFetched = false;
      for (const endpoint of possibleEndpoints) {
        try {
          console.log(`Trying endpoint: ${endpoint}`);
          const response = await fetch(endpoint, { 
            timeout: 3000,
            headers: { 'Content-Type': 'application/json' }
          });
          
          if (response.ok) {
            const callData = await response.json();
            console.log('📋 Retrieved call metadata:', callData);
            
            const actualData = callData.data || callData;
            
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
            
            // Update booking info
            this.bookingInfo.email = this.connectionData.customerEmail;
            this.bookingInfo.name = this.connectionData.customerName;
            this.bookingInfo.phone = this.connectionData.customerPhone;
            
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

  setupEventHandlers() {
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('error', this.handleError.bind(this));
  }

  sendInitialGreeting() {
    setTimeout(() => {
      if (!this.userHasSpoken) {
        console.log('🎙️ Sending auto-greeting message');
        this.sendResponse("Hi there! This is Sarah from Nexella AI. How are you doing today?", 1);
      }
    }, 3000);
  }

  sendResponse(content, responseId = null) {
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
      
      console.log('📥 Raw WebSocket Message:', JSON.stringify(parsed, null, 2));
      
      // Extract call metadata from WebSocket if available
      this.extractCallMetadataFromMessage(parsed);
      
      if (parsed.interaction_type === 'response_required') {
        await this.processUserMessage(parsed);
      }
    } catch (error) {
      console.error('❌ Error handling message:', error.message);
      await this.sendEmergencyWebhook();
      this.sendResponse("I missed that. Could you repeat it?", 9999);
    }
  }

  extractCallMetadataFromMessage(parsed) {
    if (parsed.call && parsed.call.call_id) {
      if (!this.connectionData.callId) {
        this.connectionData.callId = parsed.call.call_id;
        this.callId = this.connectionData.callId;
        console.log(`🔗 Got call ID from WebSocket: ${this.connectionData.callId}`);
      }
      
      if (parsed.call.metadata) {
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
      
      if (!this.connectionData.customerPhone && parsed.call.to_number) {
        this.connectionData.customerPhone = parsed.call.to_number;
        this.bookingInfo.phone = this.connectionData.customerPhone;
        console.log(`✅ Got phone from call object: ${this.connectionData.customerPhone}`);
      }
      
      // Store in metadata map
      addCallMetadata(this.connectionData.callId, {
        customer_email: this.connectionData.customerEmail,
        customer_name: this.connectionData.customerName,
        phone: this.connectionData.customerPhone,
        to_number: this.connectionData.customerPhone
      });
    }
  }

  async processUserMessage(parsed) {
    const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
    const userMessage = latestUserUtterance?.content || "";

    console.log('🗣️ User said:', userMessage);
    console.log('📊 Discovery progress:', this.discovery.progress.questionsCompleted, '/6');

    // Detect questions and capture answers
    if (this.conversationHistory.length >= 2) {
      const lastBotMessage = this.conversationHistory[this.conversationHistory.length - 1];
      if (lastBotMessage && lastBotMessage.role === 'assistant') {
        this.discovery.detectQuestionAsked(lastBotMessage.content);
      }
    }

    if (this.discovery.progress.waitingForAnswer && userMessage.trim().length > 2) {
      this.discovery.captureUserAnswer(userMessage);
    }

    // Handle scheduling detection
    await this.handleSchedulingLogic(userMessage);

    // Add user message to conversation history
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // Generate context prompt
    const contextPrompt = this.generateContextPrompt();

    // Get AI response
    const botReply = await this.getAIResponse(contextPrompt);
    this.conversationHistory.push({ role: 'assistant', content: botReply });

    // Update conversation state
    this.updateConversationState();

    // Send response
    this.sendResponse(botReply, parsed.response_id);

    // Send webhook if conditions met
    await this.checkAndSendWebhook();
  }

  async handleSchedulingLogic(userMessage) {
    let schedulingDetected = false;
    let calendarCheckResponse = '';
    
    if (this.discovery.canStartScheduling() && 
        userMessage.toLowerCase().match(/\b(schedule|book|appointment|call|talk|meet|discuss|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow|today|\d{1,2}\s*(am|pm)|morning|afternoon|evening)\b/)) {
      
      console.log('🗓️ SCHEDULING DETECTED - Starting booking process');
      this.discovery.markSchedulingStarted();
      
      const dayInfo = handleSchedulingPreference(userMessage);
      
      if (dayInfo && !this.webhookSent) {
        try {
          // Parse preferred time
          let preferredHour = 10;
          if (dayInfo.timePreference) {
            preferredHour = this.parsePreferredHour(dayInfo.timePreference);
          }
          
          const preferredDateTime = new Date(dayInfo.date);
          preferredDateTime.setHours(preferredHour, 0, 0, 0);
          
          const endDateTime = new Date(preferredDateTime);
          endDateTime.setHours(preferredDateTime.getHours() + 1);
          
          // Check availability
          const isAvailable = await checkAvailability(
            preferredDateTime.toISOString(), 
            endDateTime.toISOString()
          );
          
          if (isAvailable) {
            this.bookingInfo.preferredDay = `${dayInfo.dayName} at ${preferredDateTime.toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit', 
              hour12: true 
            })}`;
            schedulingDetected = true;
            
            calendarCheckResponse = `Perfect! I've got you scheduled for ${dayInfo.dayName} at ${preferredDateTime.toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit', 
              hour12: true 
            })}. You'll receive a calendar invitation shortly.`;
            
          } else {
            // Suggest alternatives
            const availableSlots = await getAvailableTimeSlots(dayInfo.date);
            calendarCheckResponse = await this.generateAlternativeResponse(availableSlots, dayInfo);
          }
        } catch (calendarError) {
          console.error('❌ Calendar error:', calendarError.message);
          calendarCheckResponse = `Let me check my calendar and get back to you with available times.`;
        }
      }
    }
    
    this.schedulingDetected = schedulingDetected;
    this.calendarCheckResponse = calendarCheckResponse;
  }

  parsePreferredHour(timePreference) {
    const timeStr = timePreference.toLowerCase();
    if (timeStr.includes('morning') || timeStr.includes('am')) {
      return 10;
    } else if (timeStr.includes('afternoon') || timeStr.includes('pm')) {
      return 14;
    } else if (timeStr.includes('evening')) {
      return 16;
    }
    
    const hourMatch = timeStr.match(/(\d{1,2})/);
    if (hourMatch) {
      const hour = parseInt(hourMatch[1]);
      if (timeStr.includes('pm') && hour !== 12) {
        return hour + 12;
      } else if (timeStr.includes('am') || hour >= 8) {
        return hour;
      }
    }
    
    return 10; // Default
  }

  async generateAlternativeResponse(availableSlots, dayInfo) {
    if (availableSlots.length > 0) {
      const firstSlot = availableSlots[0];
      const secondSlot = availableSlots[1];
      
      if (secondSlot) {
        return `I'm sorry, that time is already booked. I do have ${firstSlot.displayTime} or ${secondSlot.displayTime} available on ${dayInfo.dayName}. Which would work better?`;
      } else {
        return `I'm sorry, that time is already booked. I do have ${firstSlot.displayTime} available on ${dayInfo.dayName}. Would that work?`;
      }
    } else {
      return `I don't have any availability on ${dayInfo.dayName}. Let me check other days this week.`;
    }
  }

  generateContextPrompt() {
    if (!this.discovery.progress.allQuestionsCompleted) {
      return this.discovery.generateContextPrompt();
    } else if (this.calendarCheckResponse) {
      return `

All 6 discovery questions completed. Calendar response ready.
RESPOND EXACTLY WITH: "${this.calendarCheckResponse}"`;
    } else if (!this.discovery.progress.schedulingStarted) {
      return this.generateAvailabilityPrompt();
    }
    return '';
  }

  async generateAvailabilityPrompt() {
    try {
      const availabilityResponse = await generateAvailabilityResponse();
      return `

All 6 discovery questions completed. Show available times.
RESPOND EXACTLY WITH: "Perfect! I have all the information I need. Let's schedule a call to discuss how we can help. ${availabilityResponse}"`;
    } catch (availabilityError) {
      return `

All 6 discovery questions completed. Show scheduling options.
RESPOND EXACTLY WITH: "Perfect! I have all the information I need. Let's schedule a call. What day and time would work best for you?"`;
    }
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
      console.error('❌ OpenAI API error:', error.message);
      return "I'm having trouble processing that. Could you repeat it?";
    }
  }

  updateConversationState() {
    if (this.conversationState === 'introduction') {
      this.conversationState = 'discovery';
    } else if (this.conversationState === 'discovery' && this.discovery.progress.allQuestionsCompleted) {
      this.conversationState = 'booking';
      console.log('🔄 Transitioning to booking state - ALL 6 discovery questions completed');
    }
  }

  async checkAndSendWebhook() {
    if (this.schedulingDetected && this.discovery.progress.allQuestionsCompleted && !this.webhookSent) {
      console.log('🚀 SENDING WEBHOOK');
      
      const finalDiscoveryData = this.discovery.getFinalDiscoveryData();
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
        console.log('✅ Webhook sent successfully');
        
        // Log booking details if calendar event was created
        if (result.booking && result.booking.success) {
          console.log('📅 Calendar event created:', result.meetingDetails);
        }
      }
    }
  }

  async sendEmergencyWebhook() {
    if (!this.webhookSent && this.connectionData.callId && 
        (this.bookingInfo.email || this.connectionData.customerEmail) &&
        this.discovery.progress.questionsCompleted >= 4) {
      try {
        console.log('🚨 EMERGENCY WEBHOOK SEND - Substantial discovery data available');
        
        const emergencyDiscoveryData = this.discovery.getFinalDiscoveryData();
        
        await sendSchedulingPreference(
          this.bookingInfo.name || this.connectionData.customerName || '',
          this.bookingInfo.email || this.connectionData.customerEmail || '',
          this.bookingInfo.phone || this.connectionData.customerPhone || '',
          this.bookingInfo.preferredDay || 'Error occurred',
          this.connectionData.callId,
          emergencyDiscoveryData
        );
        
        this.webhookSent = true;
        console.log('✅ Emergency webhook sent with available discovery data');
      } catch (webhookError) {
        console.error('❌ Emergency webhook also failed:', webhookError.message);
      }
    }
  }

  async handleClose() {
    console.log('🔌 Connection closed');
    
    // Cleanup discovery timers
    this.discovery.cleanup();
    
    // Capture any buffered answers
    this.discovery.captureBufferedAnswers();
    
    console.log('=== FINAL CONNECTION CLOSE ANALYSIS ===');
    console.log('📋 Final discoveryData:', JSON.stringify(this.discovery.discoveryData, null, 2));
    console.log('📊 Questions completed:', this.discovery.progress.questionsCompleted);
    console.log('📊 All questions completed:', this.discovery.progress.allQuestionsCompleted);
    
    const discoveryInfo = this.discovery.getDiscoveryInfo();
    discoveryInfo.questions.forEach((q, index) => {
      console.log(`Question ${index + 1}: Asked=${q.asked}, Answered=${q.answered}, Answer="${this.discovery.questions[index].answer}"`);
    });
    
    // Final webhook attempt if we have substantial data
    if (!this.webhookSent && this.connectionData.callId && this.discovery.progress.questionsCompleted >= 2) {
      try {
        const finalEmail = this.connectionData.customerEmail || this.bookingInfo.email || '';
        const finalName = this.connectionData.customerName || this.bookingInfo.name || '';
        const finalPhone = this.connectionData.customerPhone || this.bookingInfo.phone || '';
        
        console.log('🚨 FINAL WEBHOOK ATTEMPT on connection close');
        console.log(`📊 Sending with ${this.discovery.progress.questionsCompleted}/6 questions completed`);
        
        const finalDiscoveryData = this.discovery.getFinalDiscoveryData();
        
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
    
    // Cleanup metadata
    if (this.connectionData.callId) {
      removeCallMetadata(this.connectionData.callId);
      console.log(`🧹 Cleaned up metadata for call ${this.connectionData.callId}`);
    }
  }

  handleError(error) {
    console.error('❌ WebSocket Error:', error);
  }
}

module.exports = WebSocketHandler;
        