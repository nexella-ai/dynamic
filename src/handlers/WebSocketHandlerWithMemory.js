// src/handlers/WebSocketHandlerWithMemory.js - COMPLETE WITH ENHANCED CALENDAR BOOKING
const axios = require('axios');
const config = require('../config/environment');
const globalDiscoveryManager = require('../services/discovery/GlobalDiscoveryManager');
const { 
  autoBookAppointment,
  getAvailableTimeSlots,
  generateAvailabilityResponse,
  isCalendarInitialized
} = require('../services/calendar/CalendarHelpers');
const { 
  sendSchedulingPreference
} = require('../services/webhooks/WebhookService');

// Safe import for getActiveCallsMetadata - may not exist
let getActiveCallsMetadata = null;
try {
  const webhookService = require('../services/webhooks/WebhookService');
  getActiveCallsMetadata = webhookService.getActiveCallsMetadata;
} catch (error) {
  console.log('⚠️ getActiveCallsMetadata not available - using fallback');
}

// Import Memory Service
let RAGMemoryService = null;
try {
  RAGMemoryService = require('../services/memory/RAGMemoryService');
} catch (error) {
  console.error('❌ RAGMemoryService not found - memory features disabled');
}

class WebSocketHandlerWithMemory {
  constructor(ws, req) {
    this.ws = ws;
    this.req = req;
    this.callId = this.extractCallId(req.url);
    
    // Initialize RAG Memory Service if available
    this.memoryService = null;
    if (RAGMemoryService) {
      try {
        this.memoryService = new RAGMemoryService();
        console.log('🧠 Memory service initialized for call:', this.callId);
      } catch (error) {
        console.error('❌ Memory service initialization failed:', error.message);
      }
    }
    
    console.log('🔗 NEW CONNECTION WITH MEMORY - Call ID:', this.callId);
    console.log('📅 Calendar Status:', isCalendarInitialized() ? 'ENABLED ✅' : 'DISABLED ⚠️');
    
    // FIXED: Get REAL customer data aggressively from all sources
    this.connectionData = this.getRealCustomerDataAggressively();
    
    this.conversationHistory = [
      {
        role: 'system',
        content: `You are Sarah from Nexella AI, a friendly professional assistant with memory of past interactions.

CONVERSATION FLOW:
1. GREETING: Wait for user to speak first, then greet (using memory if available) and ask first question
2. DISCOVERY: Ask these 6 questions ONE AT A TIME:
   - "How did you hear about us?"
   - "What industry or business are you in?" 
   - "What's your main product or service?"
   - "Are you currently running any ads?"
   - "Are you using any CRM system?"
   - "What are your biggest pain points or challenges?"
3. SCHEDULING: After ALL 6 questions, transition to scheduling

CRITICAL APPOINTMENT BOOKING RULES:
- When customer specifies a day AND time (like "Tuesday at 10 AM"), IMMEDIATELY book it
- Say: "Perfect! I'm booking you for [day] at [time] Arizona time right now."
- Then confirm: "Your appointment is confirmed for [day] at [time] Arizona time. You'll receive a calendar invitation shortly!"
- Do NOT ask for confirmation - just book it immediately
- Do NOT offer alternatives unless the specific time is unavailable
- ALWAYS mention they'll receive a calendar invitation at their email

SCHEDULING APPROACH:
- Our business hours are 8 AM to 4 PM Arizona time (MST), Monday through Friday
- When suggesting times, use proper Arizona times: 8:00 AM, 9:00 AM, 10:00 AM, 11:00 AM, 1:00 PM, 2:00 PM, 3:00 PM
- When customer specifies a day and time, book the appointment immediately
- Always confirm Arizona timezone in booking confirmations

MEMORY USAGE:
- Reference previous conversations naturally when relevant
- Skip questions already answered in previous calls
- Acknowledge returning customers warmly
- Use business context from memory to personalize responses

CALENDAR INTEGRATION:
- We have automatic Google Calendar booking enabled
- When booking appointments, customers receive automatic calendar invitations with meeting links
- Always confirm the email address where they'll receive the invitation
- Meeting links are generated automatically for each appointment

CRITICAL RULES:
- WAIT for user to speak first before greeting
- Ask questions slowly, one at a time
- CAPTURE answers properly before moving to next question
- Be conversational but follow the exact question order
- Use memory to enhance, not replace, the conversation flow
- When they specify a time, book it IMMEDIATELY without asking for confirmation
- Always mention calendar invitation delivery

KEEP IT SHORT AND FOCUSED.`
      }
    ];
    
    this.userHasSpoken = false;
    this.hasGreeted = false;
    this.lastResponseTime = 0;
    this.minimumResponseDelay = 2000;
    this.conversationContext = '';
    this.customerProfile = null;
    this.appointmentBooked = false; // CRITICAL: Track if appointment is already booked
    
    this.initialize();
  }

  async initialize() {
    // FIXED: Try much harder to get real customer data
    await this.attemptRealDataRetrieval();
    
    // Load customer memory context
    await this.loadCustomerMemory();
    
    this.initializeDiscoverySession();
    this.setupEventHandlers();
    
    console.log('🔇 WAITING for user to speak first before greeting...');
    console.log('👤 Customer data source:', this.connectionData.source);
    console.log('📧 Customer email:', this.connectionData.customerEmail);
    console.log('🧠 Memory context loaded:', this.conversationContext ? 'Yes' : 'No');
    console.log('📅 Calendar integration:', isCalendarInitialized() ? 'Active' : 'Inactive');
  }

  // FIXED: Aggressive real customer data retrieval
  async attemptRealDataRetrieval() {
    console.log('🔍 ATTEMPTING AGGRESSIVE REAL CUSTOMER DATA RETRIEVAL...');
    
    // Method 1: Try trigger server endpoints aggressively
    if (this.callId) {
      const triggerEndpoints = [
        `${config.TRIGGER_SERVER_URL}/get-call-info/${this.callId}`,
        `${config.TRIGGER_SERVER_URL}/api/calls/${this.callId}/metadata`,
        `${config.TRIGGER_SERVER_URL}/api/customer-data/${this.callId}`,
        `${config.TRIGGER_SERVER_URL}/calls/${this.callId}/info`,
        `${config.TRIGGER_SERVER_URL}/api/get-call-data/${this.callId}`,
        `${config.TRIGGER_SERVER_URL}/call-data/${this.callId}`
      ];
      
      for (const endpoint of triggerEndpoints) {
        try {
          console.log(`🔄 Trying trigger server endpoint: ${endpoint}`);
          const response = await axios.get(endpoint, { 
            timeout: 3000,
            headers: {
              'Authorization': `Bearer ${config.API_KEY || 'nexella-api-key'}`,
              'Content-Type': 'application/json'
            }
          });
          
          if (response.data && response.data.success && response.data.data) {
            const data = response.data.data;
            console.log('✅ FOUND REAL CUSTOMER DATA FROM TRIGGER SERVER:', data);
            
            this.connectionData = {
              callId: this.callId,
              customerEmail: data.email || data.customer_email || '',
              customerName: data.name || data.customer_name || '',
              customerPhone: data.phone || data.customer_phone || data.to_number || '',
              source: 'trigger_server_success'
            };
            
            if (this.connectionData.customerEmail && this.connectionData.customerEmail !== 'prospect@example.com') {
              console.log('🎉 SUCCESS: Retrieved real customer email:', this.connectionData.customerEmail);
              return;
            }
          }
        } catch (error) {
          console.log(`❌ Trigger server endpoint ${endpoint} failed:`, error.message);
        }
      }
    }
    
    // Method 2: Check global Typeform submission
    if (global.lastTypeformSubmission) {
      console.log('📋 Using global Typeform submission:', global.lastTypeformSubmission);
      this.connectionData = {
        callId: this.callId,
        customerEmail: global.lastTypeformSubmission.email,
        customerName: global.lastTypeformSubmission.name || 'Customer',
        customerPhone: global.lastTypeformSubmission.phone || '',
        source: 'global_typeform'
      };
      
      if (this.connectionData.customerEmail && this.connectionData.customerEmail !== 'prospect@example.com') {
        console.log('✅ Using real email from Typeform:', this.connectionData.customerEmail);
        return;
      }
    }
    
    // Method 3: Check active calls metadata
    if (getActiveCallsMetadata && typeof getActiveCallsMetadata === 'function') {
      try {
        const activeCallsMetadata = getActiveCallsMetadata();
        if (activeCallsMetadata && activeCallsMetadata.has && activeCallsMetadata.has(this.callId)) {
          const callMetadata = activeCallsMetadata.get(this.callId);
          console.log('📞 Using active calls metadata:', callMetadata);
          
          this.connectionData = {
            callId: this.callId,
            customerEmail: callMetadata.customer_email || callMetadata.email || '',
            customerName: callMetadata.customer_name || callMetadata.name || '',
            customerPhone: callMetadata.customer_phone || callMetadata.phone || callMetadata.to_number || '',
            source: 'active_calls_metadata'
          };
          
          if (this.connectionData.customerEmail && this.connectionData.customerEmail !== 'prospect@example.com') {
            console.log('✅ Using real email from active calls:', this.connectionData.customerEmail);
            return;
          }
        }
      } catch (error) {
        console.log('❌ Error checking active calls metadata:', error.message);
      }
    }
    
    // Method 4: Extract from URL parameters
    const urlParams = new URLSearchParams(this.req.url.split('?')[1] || '');
    const emailFromUrl = urlParams.get('customer_email') || urlParams.get('email');
    const nameFromUrl = urlParams.get('customer_name') || urlParams.get('name');
    const phoneFromUrl = urlParams.get('customer_phone') || urlParams.get('phone');
    
    if (emailFromUrl && emailFromUrl !== 'prospect@example.com') {
      console.log('📧 Using email from URL parameters:', emailFromUrl);
      this.connectionData = {
        callId: this.callId,
        customerEmail: emailFromUrl,
        customerName: nameFromUrl || 'Customer',
        customerPhone: phoneFromUrl || '',
        source: 'url_parameters'
      };
      return;
    }
    
    // LAST RESORT: Create a placeholder but don't use fallback email
    console.warn('⚠️ NO REAL CUSTOMER DATA FOUND - Using minimal placeholder');
    this.connectionData = {
      callId: this.callId,
      customerEmail: null, // Don't use fallback email
      customerName: 'Customer',
      customerPhone: '',
      source: 'no_data_found'
    };
  }

  async loadCustomerMemory() {
    try {
      if (!this.memoryService) {
        console.log('⚠️ Memory service not available');
        return;
      }

      if (!this.connectionData.customerEmail || this.connectionData.customerEmail === 'prospect@example.com') {
        console.log('⚠️ No valid customer email for memory lookup');
        return;
      }

      console.log('🧠 Loading customer memory...');
      
      // Generate conversation context from memory
      this.conversationContext = await this.memoryService.generateConversationContext(
        this.connectionData.customerEmail,
        'customer interaction history'
      );
      
      // Get customer profile for personalization
      this.customerProfile = await this.memoryService.getCustomerContext(this.connectionData.customerEmail);
      
      if (this.conversationContext) {
        console.log('✅ Customer memory loaded:', this.conversationContext.substring(0, 100) + '...');
        
        // Add memory context to system message
        this.conversationHistory[0].content += `\n\nCUSTOMER MEMORY CONTEXT: ${this.conversationContext}`;
      }
      
    } catch (error) {
      console.error('❌ Error loading customer memory:', error.message);
    }
  }

  extractCallId(url) {
    const callIdMatch = url.match(/\/call_([a-f0-9]+)/);
    return callIdMatch ? `call_${callIdMatch[1]}` : null;
  }

  getRealCustomerDataAggressively() {
    console.log('🔍 GETTING REAL CUSTOMER DATA FROM ALL SOURCES...');
    
    // Check global Typeform submission first (highest priority)
    if (global.lastTypeformSubmission && global.lastTypeformSubmission.email !== 'prospect@example.com') {
      console.log('✅ Using data from global Typeform submission:', global.lastTypeformSubmission);
      return {
        callId: this.callId,
        customerEmail: global.lastTypeformSubmission.email,
        customerName: global.lastTypeformSubmission.name || 'Customer',
        customerPhone: global.lastTypeformSubmission.phone || '',
        source: 'typeform'
      };
    }
    
    // Check active calls metadata
    let activeCallsMetadata = null;
    try {
      if (getActiveCallsMetadata && typeof getActiveCallsMetadata === 'function') {
        activeCallsMetadata = getActiveCallsMetadata();
      }
    } catch (error) {
      console.log('⚠️ Error getting active calls metadata:', error.message);
    }
    
    if (activeCallsMetadata && activeCallsMetadata.has && activeCallsMetadata.has(this.callId)) {
      const callMetadata = activeCallsMetadata.get(this.callId);
      if (callMetadata.customer_email && callMetadata.customer_email !== 'prospect@example.com') {
        console.log('✅ Using data from webhook active calls metadata:', callMetadata);
        return {
          callId: this.callId,
          customerEmail: callMetadata.customer_email || callMetadata.email,
          customerName: callMetadata.customer_name || callMetadata.name || 'Customer',
          customerPhone: callMetadata.customer_phone || callMetadata.phone || callMetadata.to_number || '',
          source: 'webhook_metadata'
        };
      }
    }
    
    // Extract from URL parameters
    const urlParams = new URLSearchParams(this.req.url.split('?')[1] || '');
    const emailFromUrl = urlParams.get('customer_email') || urlParams.get('email');
    const nameFromUrl = urlParams.get('customer_name') || urlParams.get('name');
    const phoneFromUrl = urlParams.get('customer_phone') || urlParams.get('phone');
    
    if (emailFromUrl && emailFromUrl !== 'prospect@example.com') {
      console.log('✅ Using data from URL parameters');
      return {
        callId: this.callId,
        customerEmail: emailFromUrl,
        customerName: nameFromUrl || 'Customer',
        customerPhone: phoneFromUrl || '',
        source: 'url_params'
      };
    }
    
    // Return minimal data without fallback email
    console.warn('⚠️ NO REAL CUSTOMER DATA FOUND - Will try to get from WebSocket messages');
    return {
      callId: this.callId,
      customerEmail: null, // No fallback email
      customerName: 'Customer',
      customerPhone: '',
      source: 'awaiting_websocket_data'
    };
  }

  initializeDiscoverySession() {
    const session = globalDiscoveryManager.getSession(this.callId, this.connectionData);
    console.log(`📊 SESSION INITIALIZED: ${session.progress.questionsCompleted}/6 questions`);
  }

  setupEventHandlers() {
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('error', this.handleError.bind(this));
  }

  async sendResponse(content, responseId = null) {
    // Enforce minimum delay between responses to prevent rapid-fire
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

  async handleMessage(data) {
    try {
      const parsed = JSON.parse(data);
      
      // FIXED: Extract real customer data from WebSocket messages
      if (parsed.call && parsed.call.call_id) {
        if (!this.connectionData.callId) {
          this.connectionData.callId = parsed.call.call_id;
          console.log(`🔗 Got call ID from WebSocket: ${this.connectionData.callId}`);
        }
        
        // Extract metadata from call object and update if we don't have real data
        if (parsed.call.metadata && (!this.connectionData.customerEmail || this.connectionData.customerEmail === 'prospect@example.com')) {
          console.log('📞 Extracting customer data from WebSocket metadata:', JSON.stringify(parsed.call.metadata, null, 2));
          
          const email = parsed.call.metadata.customer_email || parsed.call.metadata.email;
          const name = parsed.call.metadata.customer_name || parsed.call.metadata.name;
          const phone = parsed.call.metadata.customer_phone || parsed.call.metadata.phone || parsed.call.to_number;
          
          if (email && email !== 'prospect@example.com') {
            this.connectionData.customerEmail = email;
            this.connectionData.customerName = name || 'Customer';
            this.connectionData.customerPhone = phone || '';
            this.connectionData.source = 'websocket_metadata';
            
            console.log(`✅ UPDATED with real customer data from WebSocket:`, {
              email: this.connectionData.customerEmail,
              name: this.connectionData.customerName,
              phone: this.connectionData.customerPhone
            });
          }
        }
        
        // Also check call.to_number for phone
        if (parsed.call.to_number && !this.connectionData.customerPhone) {
          this.connectionData.customerPhone = parsed.call.to_number;
          console.log(`✅ Got phone from call object: ${this.connectionData.customerPhone}`);
        }
      }
      
      if (parsed.interaction_type === 'response_required') {
        await this.processUserMessage(parsed);
      }
    } catch (error) {
      console.error('❌ Error handling message:', error.message);
      await this.sendResponse("I missed that. Could you repeat it?", 9999);
    }
  }

  async processUserMessage(parsed) {
    const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
    const userMessage = latestUserUtterance?.content || "";

    console.log(`🗣️ USER: "${userMessage}"`);
    
    // Mark that user has spoken
    if (!this.userHasSpoken) {
      this.userHasSpoken = true;
      this.connectionStartTime = Date.now();
      console.log('👤 USER SPOKE FIRST - Now we can start conversation');
    }
    
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // Handle first greeting when user speaks
    if (!this.hasGreeted && this.userHasSpoken) {
      await this.handleInitialGreeting(userMessage, parsed.response_id);
      return;
    }

    const progress = globalDiscoveryManager.getProgress(this.callId);
    console.log(`📊 CURRENT PROGRESS: ${progress?.questionsCompleted || 0}/6 questions, Phase: ${progress?.conversationPhase || 'greeting'}`);

    // CRITICAL FIX: Check for appointment booking FIRST, before anything else
    if (progress?.questionsCompleted >= 6 && !this.appointmentBooked) {
      const appointmentMatch = this.detectSpecificAppointmentRequest(userMessage);
      if (appointmentMatch) {
        console.log('🎯 IMMEDIATE APPOINTMENT BOOKING DETECTED:', appointmentMatch);
        await this.handleImmediateAppointmentBooking(appointmentMatch, parsed.response_id);
        return; // Exit early - booking is done
      }
    }

    // Handle discovery phase with memory enhancement
    if (progress?.questionsCompleted < 6 && !progress?.schedulingStarted) {
      await this.handleDiscoveryPhaseWithMemory(userMessage, parsed.response_id);
      return;
    }

    // Handle scheduling phase
    if (progress?.questionsCompleted >= 6 || progress?.schedulingStarted) {
      await this.handleSchedulingPhase(userMessage, parsed.response_id);
      return;
    }

    // Fallback - Use enhanced response with memory
    await this.generateEnhancedResponse(userMessage, parsed.response_id);
  }

  // NEW: Detect specific appointment booking requests
  detectSpecificAppointmentRequest(userMessage) {
    console.log('🎯 CHECKING FOR SPECIFIC APPOINTMENT REQUEST:', userMessage);
    
    // More specific patterns for immediate booking
    const specificPatterns = [
      // "Tuesday at 10 AM" or "Tuesday 10 AM"
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
      // "10 AM Tuesday" or "10 AM on Tuesday"
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
      // "Tuesday 10" (assuming business hours)
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2})\b/i,
      // "Tuesday, ten AM" or "Tuesday ten AM"
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+(ten|nine|eight|eleven|one|two|three)\s*(am|pm)?/i
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
      case 0: // "Tuesday at 10am"
        day = match[1];
        hour = parseInt(match[2]);
        minutes = parseInt(match[3] || '0');
        period = match[4] || 'am';
        break;
      case 1: // "10am Tuesday"
        hour = parseInt(match[1]);
        minutes = parseInt(match[2] || '0');
        period = match[3] || 'am';
        day = match[4];
        break;
      case 2: // "Tuesday 10"
        day = match[1];
        hour = parseInt(match[2]);
        // Smart assumption for business hours
        period = hour >= 8 && hour <= 11 ? 'am' : (hour >= 1 && hour <= 4 ? 'pm' : 'am');
        break;
      case 3: // "Tuesday, ten AM"
        day = match[1];
        const wordToNum = {
          'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11,
          'one': 1, 'two': 2, 'three': 3
        };
        hour = wordToNum[match[2].toLowerCase()] || 10;
        period = match[3] || (hour >= 8 && hour <= 11 ? 'am' : 'pm');
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

  // ENHANCED: Handle immediate appointment booking with calendar integration
  async handleImmediateAppointmentBooking(appointmentRequest, responseId) {
    try {
      console.log('🎯 PROCESSING IMMEDIATE APPOINTMENT BOOKING WITH MEMORY & CALENDAR');
      console.log('🕐 Requested time:', appointmentRequest.timeString);
      console.log('📅 Requested date:', appointmentRequest.dayName);
      console.log('👤 Customer data:', {
        name: this.connectionData.customerName,
        email: this.connectionData.customerEmail,
        phone: this.connectionData.customerPhone
      });
      
      // Check if time is within business hours
      if (!appointmentRequest.isBusinessHours) {
        const response = `I'd love to schedule you for ${appointmentRequest.dayName} at ${appointmentRequest.timeString}, but our business hours are 8 AM to 4 PM Arizona time. Would you like to choose a time between 8 AM and 4 PM instead?`;
        await this.sendResponse(response, responseId);
        return;
      }

      // Validate customer email
      if (!this.connectionData.customerEmail || this.connectionData.customerEmail === 'prospect@example.com') {
        console.log('❌ No valid customer email for booking');
        const response = `I'd love to book that appointment for you! Could you provide your email address so I can send you the calendar invitation?`;
        await this.sendResponse(response, responseId);
        return;
      }

      // Get discovery data for the appointment
      const discoveryData = globalDiscoveryManager.getFinalDiscoveryData(this.callId);
      console.log('📋 Discovery data for appointment:', discoveryData);

      // Step 1: Immediately confirm the booking to the user
      const confirmationResponse = `Perfect! I'm booking you for ${appointmentRequest.dayName} at ${appointmentRequest.timeString} Arizona time right now. Your appointment is confirmed! You'll receive a calendar invitation at ${this.connectionData.customerEmail} shortly.`;
      await this.sendResponse(confirmationResponse, responseId);

      // Mark as booked to prevent loops
      this.appointmentBooked = true;
      globalDiscoveryManager.markSchedulingStarted(this.callId);

      // Step 2: Attempt real appointment booking
      console.log('📅 ATTEMPTING REAL CALENDAR BOOKING WITH MEMORY...');
      try {
        // Check if calendar is available
        if (!isCalendarInitialized()) {
          throw new Error('Google Calendar not initialized');
        }

        const bookingResult = await autoBookAppointment(
          this.connectionData.customerName || 'Customer',
          this.connectionData.customerEmail,
          this.connectionData.customerPhone,
          appointmentRequest.dateTime,
          discoveryData
        );

        console.log('📅 Calendar booking result:', bookingResult);

        if (bookingResult.success) {
          console.log('✅ REAL CALENDAR BOOKING SUCCESSFUL WITH MEMORY!');
          console.log('📧 Calendar invitation sent to:', this.connectionData.customerEmail);
          console.log('🔗 Meeting link:', bookingResult.meetingLink);
          console.log('📅 Event ID:', bookingResult.eventId);

          // Store successful booking in memory
          if (this.memoryService) {
            await this.handleSuccessfulBooking(appointmentRequest, discoveryData);
          }

          // Send success webhook with calendar details
          setTimeout(async () => {
            try {
              await sendSchedulingPreference(
                this.connectionData.customerName || 'Customer',
                this.connectionData.customerEmail,
                this.connectionData.customerPhone,
                `${appointmentRequest.dayName} at ${appointmentRequest.timeString}`,
                this.callId,
                {
                  ...discoveryData,
                  appointment_booked: true,
                  booking_confirmed: true,
                  requested_time: appointmentRequest.timeString,
                  requested_day: appointmentRequest.dayName,
                  meeting_link: bookingResult.meetingLink || '',
                  event_id: bookingResult.eventId || '',
                  event_link: bookingResult.eventLink || '',
                  calendar_status: 'success',
                  customer_email_confirmed: this.connectionData.customerEmail,
                  memory_enhanced: true
                }
              );
              console.log('✅ Success webhook sent with calendar details and memory context');
            } catch (webhookError) {
              console.error('❌ Error sending success webhook:', webhookError.message);
            }
          }, 1000);

        } else {
          // Booking failed - send webhook for manual processing
          console.log('❌ CALENDAR BOOKING FAILED:', bookingResult.error);
          
          setTimeout(async () => {
            try {
              await sendSchedulingPreference(
                this.connectionData.customerName || 'Customer',
                this.connectionData.customerEmail,
                this.connectionData.customerPhone,
                `${appointmentRequest.dayName} at ${appointmentRequest.timeString}`,
                this.callId,
                {
                  ...discoveryData,
                  appointment_requested: true,
                  calendar_booking_failed: true,
                  booking_error: bookingResult.error,
                  requested_time: appointmentRequest.timeString,
                  requested_day: appointmentRequest.dayName,
                  booking_confirmed_to_user: true,
                  calendar_status: 'failed',
                  needs_manual_booking: true,
                  memory_enhanced: true
                }
              );
              console.log('✅ Fallback webhook sent - manual booking needed');
            } catch (webhookError) {
              console.error('❌ Error sending fallback webhook:', webhookError.message);
            }
          }, 1000);
        }
        
      } catch (bookingError) {
        console.error('❌ Calendar booking exception:', bookingError.message);
        
        // Send webhook for manual processing with error details
        setTimeout(async () => {
          try {
            await sendSchedulingPreference(
              this.connectionData.customerName || 'Customer',
              this.connectionData.customerEmail,
              this.connectionData.customerPhone,
              `${appointmentRequest.dayName} at ${appointmentRequest.timeString}`,
              this.callId,
              {
                ...discoveryData,
                appointment_requested: true,
                calendar_system_error: true,
                error_details: bookingError.message,
                requested_time: appointmentRequest.timeString,
                requested_day: appointmentRequest.dayName,
                booking_confirmed_to_user: true,
                calendar_status: 'error',
                needs_manual_booking: true,
                memory_enhanced: true
              }
            );
            console.log('✅ Error webhook sent - manual booking needed');
          } catch (webhookError) {
            console.error('❌ Error sending error webhook:', webhookError.message);
          }
        }, 1000);
      }
      
    } catch (error) {
      console.error('❌ Error in immediate appointment booking:', error.message);
      
      // Fallback response
      const errorResponse = `Perfect! I'll get you scheduled for ${appointmentRequest.dayName} at ${appointmentRequest.timeString} Arizona time. You'll receive confirmation details at ${this.connectionData.customerEmail || 'your email'} shortly.`;
      await this.sendResponse(errorResponse, responseId);
      
      this.appointmentBooked = true;
      globalDiscoveryManager.markSchedulingStarted(this.callId);
    }
  }

  async handleInitialGreeting(userMessage, responseId) {
    console.log('👋 HANDLING INITIAL GREETING WITH MEMORY - USER SPOKE FIRST');
    this.hasGreeted = true;
    
    // Check if this is a returning customer
    const isReturningCustomer = this.customerProfile && this.customerProfile.totalInteractions > 0;
    
    let greeting;
    if (isReturningCustomer) {
      const customerName = this.connectionData.customerName !== 'Customer' 
        ? ` ${this.connectionData.customerName}` 
        : '';
      
      greeting = `Hi${customerName}! Great to hear from you again. This is Sarah from Nexella AI. How are things going?`;
      console.log('🔄 RETURNING CUSTOMER DETECTED - Using personalized greeting');
    } else {
      const customerName = this.connectionData.customerName !== 'Customer' 
        ? ` ${this.connectionData.customerName}` 
        : '';
      
      greeting = `Hi${customerName}! This is Sarah from Nexella AI. How are you doing today?`;
      console.log('✨ NEW CUSTOMER - Using standard greeting');
    }
    
    await this.sendResponse(greeting, responseId);
    
    // Mark greeting as completed
    globalDiscoveryManager.markGreetingCompleted(this.callId);
  }

  async handleDiscoveryPhaseWithMemory(userMessage, responseId) {
    console.log('📝 HANDLING DISCOVERY PHASE WITH MEMORY');
    
    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    // Check if we can skip questions based on memory
    if (this.customerProfile && progress?.questionsCompleted === 0 && !progress?.waitingForAnswer) {
      console.log('🧠 CHECKING MEMORY FOR PREVIOUS ANSWERS...');
      await this.handleMemoryBasedDiscovery(userMessage, responseId);
      return;
    }
    
    // Continue with regular discovery flow
    await this.handleDiscoveryPhaseFixed(userMessage, responseId);
  }

  async handleMemoryBasedDiscovery(userMessage, responseId) {
    if (!this.memoryService) {
      await this.handleRegularDiscovery(userMessage, responseId);
      return;
    }

    // Get previous business context from memory
    const businessMemories = await this.memoryService.getMemoriesByType(
      this.connectionData.customerEmail, 
      'business_context', 
      1
    );
    
    if (businessMemories.length > 0 && businessMemories[0].relevance !== 'very_low') {
      console.log('🎯 FOUND BUSINESS CONTEXT IN MEMORY - Acknowledging and starting with appropriate question');
      
      const acknowledgment = this.getGreetingAcknowledgment(userMessage);
      
      // Reference their business and ask a follow-up question
      const businessInfo = businessMemories[0].content;
      let response = `${acknowledgment} I remember we spoke about your ${businessInfo.includes('industry') ? 'business' : 'work'}. `;
      
      // Start with an appropriate question based on what we know
      if (businessInfo.includes('industry') || businessInfo.includes('business')) {
        // We know their industry, ask about current challenges
        response += "What are the biggest challenges you're facing right now?";
        
        // Mark as if we've answered the first few questions
        globalDiscoveryManager.markQuestionAsked(this.callId, 0, "How did you hear about us?");
        globalDiscoveryManager.captureAnswer(this.callId, 0, "Previous conversation");
        globalDiscoveryManager.markQuestionAsked(this.callId, 1, "What industry or business are you in?");
        globalDiscoveryManager.captureAnswer(this.callId, 1, "From memory: " + businessInfo);
        globalDiscoveryManager.markQuestionAsked(this.callId, 5, response);
      } else {
        // We have some info but not complete, start normally
        response += "How did you hear about us?";
        globalDiscoveryManager.markQuestionAsked(this.callId, 0, response);
      }
      
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
    } else {
      // No useful memory, start normally
      await this.handleRegularDiscovery(userMessage, responseId);
    }
  }

  async handleRegularDiscovery(userMessage, responseId) {
    console.log('📝 NO USEFUL MEMORY FOUND - Starting normal discovery');
    const firstQuestion = "How did you hear about us?";
    
    const acknowledgment = this.getGreetingAcknowledgment(userMessage);
    const response = `${acknowledgment} ${firstQuestion}`;
    
    globalDiscoveryManager.markQuestionAsked(this.callId, 0, firstQuestion);
    
    this.conversationHistory.push({ role: 'assistant', content: response });
    await this.sendResponse(response, responseId);
  }

  async handleDiscoveryPhaseFixed(userMessage, responseId) {
    console.log('📝 HANDLING DISCOVERY PHASE - FIXED VERSION WITH MEMORY');
    
    const progress = globalDiscoveryManager.getProgress(this.callId);
    
    // If we just completed greeting and no questions asked yet, ask first question
    if (progress?.greetingCompleted && progress?.questionsCompleted === 0 && !progress?.waitingForAnswer) {
      console.log('🎯 ASKING FIRST QUESTION AFTER GREETING');
      const firstQuestion = "How did you hear about us?";
      
      const acknowledgment = this.getGreetingAcknowledgment(userMessage);
      const response = `${acknowledgment} ${firstQuestion}`;
      
      // Mark question as asked
      globalDiscoveryManager.markQuestionAsked(this.callId, 0, firstQuestion);
      
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
      return;
    }
    
    // If we're waiting for an answer, capture it
    if (progress?.waitingForAnswer) {
      console.log(`📝 ATTEMPTING TO CAPTURE ANSWER for Q${progress.currentQuestionIndex + 1}: "${userMessage}"`);
      
      if (this.isValidDiscoveryAnswer(userMessage)) {
        const captured = globalDiscoveryManager.captureAnswer(
          this.callId, 
          progress.currentQuestionIndex, 
          userMessage.trim()
        );
        
        console.log(`📝 Answer capture result: ${captured}`);
        
        if (captured) {
          // Wait a moment before asking next question
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Check updated progress after capture
          const updatedProgress = globalDiscoveryManager.getProgress(this.callId);
          console.log(`📊 UPDATED PROGRESS: ${updatedProgress?.questionsCompleted}/6 questions`);
          
          if (updatedProgress?.questionsCompleted >= 6) {
            // All questions complete, transition to scheduling
            console.log('🎉 ALL DISCOVERY QUESTIONS COMPLETE - TRANSITIONING TO SCHEDULING');
            globalDiscoveryManager.markSchedulingStarted(this.callId);
            
            const response = "Perfect! I have all the information I need. Let's find you a time that works. What day works best for you?";
            this.conversationHistory.push({ role: 'assistant', content: response });
            await this.sendResponse(response, responseId);
            return;
          }
          
          // Ask next question
          const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
          if (nextQuestion) {
            const questionIndex = globalDiscoveryManager.getSession(this.callId).questions.findIndex(q => q.question === nextQuestion.question);
            const acknowledgment = this.getContextualAcknowledgment(userMessage, questionIndex - 1);
            const response = `${acknowledgment} ${nextQuestion.question}`;
            
            // Mark question as asked
            const marked = globalDiscoveryManager.markQuestionAsked(this.callId, questionIndex, response);
            
            if (marked) {
              this.conversationHistory.push({ role: 'assistant', content: response });
              await this.sendResponse(response, responseId);
            }
          }
          return;
        }
      }
      
      // If answer wasn't captured, re-ask the current question
      const currentQuestion = globalDiscoveryManager.getSession(this.callId).questions[progress.currentQuestionIndex];
      if (currentQuestion) {
        const response = `I didn't catch that. ${currentQuestion.question}`;
        await this.sendResponse(response, responseId);
      }
      return;
    }
    
    // If not waiting for answer, ask next question
    const nextQuestion = globalDiscoveryManager.getNextUnansweredQuestion(this.callId);
    if (nextQuestion) {
      const questionIndex = globalDiscoveryManager.getSession(this.callId).questions.findIndex(q => q.question === nextQuestion.question);
      const response = nextQuestion.question;
      
      // Mark question as asked
      const marked = globalDiscoveryManager.markQuestionAsked(this.callId, questionIndex, response);
      
      if (marked) {
        this.conversationHistory.push({ role: 'assistant', content: response });
        await this.sendResponse(response, responseId);
      }
    }
  }

  async handleSchedulingPhase(userMessage, responseId) {
    console.log('🗓️ HANDLING SCHEDULING PHASE WITH MEMORY & CALENDAR');
    
    // Mark scheduling as started if not already
    globalDiscoveryManager.markSchedulingStarted(this.callId);
    
    // If no specific appointment detected, generate availability response
    try {
      const availabilityResponse = await this.generateRealAvailabilityResponse();
      this.conversationHistory.push({ role: 'assistant', content: availabilityResponse });
      await this.sendResponse(availabilityResponse, responseId);
    } catch (error) {
      console.error('❌ Error generating availability:', error.message);
      await this.sendResponse("Let me check my calendar for available times. What day and time would work best for you?", responseId);
    }
  }

  async handleSuccessfulBooking(timeRequest, discoveryData) {
    if (!this.memoryService) return;

    try {
      console.log('✅ BOOKING SUCCESSFUL - STORING COMPLETE INTERACTION MEMORY');
      
      // Enhanced conversation data for successful bookings
      const conversationData = {
        duration: this.calculateCallDuration(),
        questionsCompleted: 6,
        schedulingCompleted: true,
        appointmentScheduled: timeRequest.timeString,
        userSentiment: 'positive',
        callEndReason: 'successful_booking',
        outcome: 'appointment_booked'
      };
      
      // Store complete interaction in memory
      await this.memoryService.storeConversationMemory(
        this.callId,
        this.connectionData,
        conversationData,
        discoveryData
      );
      
    } catch (error) {
      console.error('❌ Error storing successful booking memory:', error.message);
    }
  }

  async generateEnhancedResponse(userMessage, responseId) {
    console.log('🤖 GENERATING ENHANCED RESPONSE WITH MEMORY CONTEXT');
    
    try {
      // Get relevant memories for context if memory service available
      let relevantMemories = [];
      if (this.memoryService && this.connectionData.customerEmail) {
        relevantMemories = await this.memoryService.retrieveRelevantMemories(
          this.connectionData.customerEmail,
          userMessage,
          2
        );
      }
      
      // Add memory context to conversation history
      let enhancedSystemMessage = this.conversationHistory[0].content;
      
      if (relevantMemories.length > 0) {
        enhancedSystemMessage += '\n\nRELEVANT MEMORIES: ';
        relevantMemories.forEach(memory => {
          enhancedSystemMessage += `${memory.content}. `;
        });
      }
      
      // Create enhanced conversation history
      const enhancedHistory = [
        { role: 'system', content: enhancedSystemMessage },
        ...this.conversationHistory.slice(1)
      ];
      
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o',
        messages: enhancedHistory,
        temperature: 0.7,
        max_tokens: 150
      }, {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      });

      const reply = response.data.choices[0].message.content;
      this.conversationHistory.push({ role: 'assistant', content: reply });
      await this.sendResponse(reply, responseId);
      
    } catch (error) {
      console.log('⚡ Using fallback response due to AI error');
      const fallback = "I understand. How can I help you further?";
      this.conversationHistory.push({ role: 'assistant', content: fallback });
      await this.sendResponse(fallback, responseId);
    }
  }

  async handleClose() {
    console.log('🔌 CONNECTION CLOSED WITH MEMORY SAVE');
    
    try {
      // Get session info for memory storage
      const sessionInfo = globalDiscoveryManager.getSessionInfo(this.callId);
      
      if (sessionInfo && sessionInfo.questionsCompleted > 0 && this.memoryService && this.connectionData.customerEmail) {
        console.log(`💾 Saving conversation to memory: ${sessionInfo.questionsCompleted}/6 questions`);
        
        // Prepare conversation data for memory storage
        const conversationData = {
          duration: this.calculateCallDuration(),
          questionsCompleted: sessionInfo.questionsCompleted,
          schedulingCompleted: sessionInfo.schedulingStarted || false,
          userSentiment: this.detectUserSentiment(),
          callEndReason: 'user_disconnect',
          appointmentBooked: this.appointmentBooked || false
        };
        
        // Get discovery data
        const discoveryData = globalDiscoveryManager.getFinalDiscoveryData(this.callId);
        
        // Store in RAG memory system
        await this.memoryService.storeConversationMemory(
          this.callId,
          this.connectionData,
          conversationData,
          discoveryData
        );
        
        // Send final webhook
        setTimeout(() => {
          sendSchedulingPreference(
            this.connectionData.customerName,
            this.connectionData.customerEmail, 
            this.connectionData.customerPhone,
            'Call ended early',
            this.callId,
            discoveryData
          ).catch(err => console.error('Final webhook error:', err));
        }, 1000);
      }
    } catch (error) {
      console.error('Error in memory-enabled connection close handler:', error.message);
    }
  }

  // UTILITY METHODS FOR MEMORY

  calculateCallDuration() {
    const now = Date.now();
    const startTime = this.connectionStartTime || now;
    return Math.round((now - startTime) / 60000);
  }

  detectUserSentiment() {
    const lastUserMessages = this.conversationHistory
      .filter(msg => msg.role === 'user')
      .slice(-3)
      .map(msg => msg.content.toLowerCase())
      .join(' ');
    
    if (lastUserMessages.includes('great') || lastUserMessages.includes('perfect') || lastUserMessages.includes('thanks')) {
      return 'positive';
    } else if (lastUserMessages.includes('problem') || lastUserMessages.includes('difficult') || lastUserMessages.includes('frustrated')) {
      return 'negative';
    }
    
    return 'neutral';
  }

  // UTILITY METHODS FROM ORIGINAL HANDLER

  getGreetingAcknowledgment(userAnswer) {
    const answer = userAnswer.toLowerCase();
    
    if (answer.includes('good') || answer.includes('great') || answer.includes('well')) {
      return "That's wonderful to hear!";
    } else if (answer.includes('busy') || answer.includes('hectic')) {
      return "I totally understand.";
    } else if (answer.includes('fine') || answer.includes('ok')) {
      return "Great!";
    } else {
      return "Nice!";
    }
  }

  getContextualAcknowledgment(userAnswer, questionIndex) {
    if (questionIndex < 0) return "Great!";
    
    const acknowledgments = [
      "Great!",
      "Perfect!", 
      "Excellent!",
      "That's helpful!",
      "I understand.",
      "Thank you!"
    ];
    
    return acknowledgments[questionIndex % acknowledgments.length];
  }

  isValidDiscoveryAnswer(userMessage) {
    const message = userMessage.toLowerCase().trim();
    
    // More lenient validation - accept most answers except obvious echoes
    const invalidPatterns = [
      /^(what|how|where|when|why|who)\b/,  // Questions
      /hear about/,
      /industry or business/,
      /main product/,
      /running.*ads/,
      /crm system/,
      /pain points/,
      /^(uh|um|er|ah)$/,  // Fillers only
    ];
    
    // Must be at least 2 characters and not match invalid patterns
    return message.length >= 2 && !invalidPatterns.some(pattern => pattern.test(message));
  }

  async generateRealAvailabilityResponse() {
    console.log('🤖 Generating REAL availability response with calendar integration...');
    
    try {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      
      // Check next 5 business days
      const availableDays = [];
      for (let i = 1; i <= 7; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() + i);
        
        // Skip weekends
        if (checkDate.getDay() === 0 || checkDate.getDay() === 6) continue;
        
        const slots = await getAvailableTimeSlots(checkDate);
        if (slots.length > 0) {
          availableDays.push({
            dayName: checkDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
            slots: slots.slice(0, 3) // Take first 3 slots
          });
        }
        
        if (availableDays.length >= 3) break; // Show 3 days max
      }
      
      if (availableDays.length === 0) {
        return "I don't have any availability this week. Let me check next week for you.";
      }
      
      if (availableDays.length === 1) {
        const day = availableDays[0];
        const times = day.slots.map(s => s.displayTime).join(', ');
        return `I have availability on ${day.dayName} at ${times}. Which time works best for you?`;
      }
      
      // Multiple days available
      let response = "I have a few options available. ";
      availableDays.forEach((day, index) => {
        const times = day.slots.map(s => s.displayTime).join(', ');
        if (index === 0) {
          response += `${day.dayName} at ${times}`;
        } else if (index === availableDays.length - 1) {
          response += `, or ${day.dayName} at ${times}`;
        } else {
          response += `, ${day.dayName} at ${times}`;
        }
      });
      response += ". What works better for you?";
      
      console.log(`✅ Generated real availability response with calendar: ${response}`);
      return response;
      
    } catch (error) {
      console.error('❌ Error generating real availability:', error.message);
      return "Let me check my calendar for available times. What day and time would work best for you?";
    }
  }

  async sendWebhookData(timeRequest, discoveryData) {
    try {
      const preferredTime = `${timeRequest.dayName} at ${timeRequest.timeString}`;
      
      await sendSchedulingPreference(
        this.connectionData.customerName,
        this.connectionData.customerEmail,
        this.connectionData.customerPhone,
        preferredTime,
        this.callId,
        discoveryData
      );
      
      console.log('✅ Webhook sent successfully');
    } catch (error) {
      console.error('❌ Webhook error:', error.message);
    }
  }

  handleError(error) {
    console.error('❌ WebSocket Error:', error.message);
  }
}

module.exports = WebSocketHandlerWithMemory;
