// src/handlers/WebSocketHandler.js - ENHANCED WITH PERSONALIZED TYPEFORM FLOW
const axios = require('axios');
const config = require('../config/environment');
const globalDiscoveryManager = require('../services/discovery/GlobalDiscoveryManager');
const { 
  autoBookAppointment,
  getAvailableTimeSlots,
  generateAvailabilityResponse,
  checkAvailability,
  isCalendarInitialized
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
      firstName: null,
      lastName: null,
      companyName: null,
      painPoint: null,
      isOutboundCall: false,
      isAppointmentConfirmation: false
    };

    // Conversation flow management
    this.conversationFlow = {
      phase: 'greeting', // greeting -> rapport -> pain_point -> solution -> scheduling -> booking
      greetingCompleted: false,
      rapportBuilt: false,
      painPointDiscussed: false,
      solutionPresented: false,
      schedulingOffered: false,
      bookingInProgress: false
    };

    // Anti-loop state management for calendar booking
    this.appointmentBooked = false;
    this.bookingInProgress = false;
    this.lastBookingAttempt = 0;
    this.bookingCooldown = 10000;
    
    // Response tracking to prevent loops
    this.responsesSent = [];
    this.maxResponsesPerMinute = 10;
    
    // Calendar booking state tracking
    this.calendarBookingState = {
      hasDetectedBookingRequest: false,
      bookingConfirmed: false,
      lastBookingResponse: null,
      bookingResponseSent: false,
      lastAppointmentMatch: null
    };

    // Enhanced system prompt for personalized flow
    this.conversationHistory = [
      {
        role: 'system',
        content: `You are Sarah from Nexella AI, a warm and friendly customer success specialist who builds genuine rapport before discussing business.

CONVERSATION FLOW:
1. PERSONALIZED GREETING: Greet the customer by their first name warmly and ask how they're doing
2. RAPPORT BUILDING: Respond to their greeting naturally, show genuine interest in their well-being
3. PAIN POINT ACKNOWLEDGMENT: Naturally transition to acknowledging their specific struggle from the form
4. SOLUTION PRESENTATION: Explain how Nexella AI specifically solves their pain point using our services
5. SCHEDULING OFFER: After building rapport and discussing solutions, offer a free demo call with the owner
6. BOOKING: If they're interested, book immediately without asking for confirmation

TONE AND STYLE:
- Warm, friendly, and conversational - like talking to a helpful friend
- Use natural speech patterns with appropriate pauses (use "..." for pauses)
- Show empathy and understanding for their struggles
- Be enthusiastic about how we can help, but not pushy
- Use their first name occasionally to personalize the conversation

NEXELLA AI SERVICES TO MENTION BASED ON PAIN POINTS:
- "Not generating enough leads" → AI Texting, SMS Revive, Review Collector
- "Not following up quickly" → AI Voice Calls, SMS Follow-Ups, Appointment Bookings
- "Not speaking to qualified leads" → AI qualification system, CRM Integration
- "Missing calls" → AI Voice Calls (24/7 availability), SMS Follow-Ups
- "Can't handle lead volume" → Complete automation suite, CRM Integration
- "Mix of everything" → Our complete AI Revenue Rescue System

SCHEDULING RULES:
- Only offer scheduling AFTER discussing their pain points and solutions
- When they agree to schedule, book immediately
- Business hours: 8 AM to 4 PM Arizona time (MST), Monday-Friday
- Always confirm they'll receive a calendar invitation at their email

Remember: Build rapport first, show you understand their struggle, then offer help.`
      }
    ];
    
    this.userHasSpoken = false;
    this.hasGreeted = false;
    this.lastResponseTime = 0;
    this.minimumResponseDelay = 2000;
    this.webhookSent = false;

    this.initialize();
  }

  async initialize() {
    // Check calendar status
    const calendarStatus = isCalendarInitialized();
    console.log('📅 Calendar Status:', calendarStatus ? 'ENABLED ✅' : 'DISABLED ⚠️');
    
    // Try to fetch customer data including Typeform data
    await this.fetchCustomerData();
    
    this.setupEventHandlers();

    // Wait for user to speak first
    console.log('🔇 Waiting for user to speak first...');
  }

  async fetchCustomerData() {
    if (this.callId) {
      try {
        console.log('🔍 Fetching customer data for call:', this.callId);
        const TRIGGER_SERVER_URL = process.env.TRIGGER_SERVER_URL || config.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com';
        
        // Try multiple endpoints to get customer data
        const possibleEndpoints = [
          `${TRIGGER_SERVER_URL}/api/get-call-data/${this.callId}`,
          `${TRIGGER_SERVER_URL}/get-call-info/${this.callId}`,
          `${TRIGGER_SERVER_URL}/call-data/${this.callId}`,
          `${TRIGGER_SERVER_URL}/api/call/${this.callId}`
        ];
        
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
              
              // Extract Typeform data
              this.connectionData.customerEmail = actualData.email || actualData.customer_email;
              this.connectionData.customerName = actualData.name || actualData.customer_name;
              this.connectionData.firstName = actualData.first_name || actualData.firstName || this.extractFirstName(this.connectionData.customerName);
              this.connectionData.lastName = actualData.last_name || actualData.lastName;
              this.connectionData.companyName = actualData.company_name || actualData.companyName;
              this.connectionData.customerPhone = actualData.phone || actualData.customer_phone;
              this.connectionData.painPoint = actualData.pain_point || actualData.struggle || actualData.painPoint;
              
              console.log('📧 Extracted customer data:', {
                email: this.connectionData.customerEmail,
                firstName: this.connectionData.firstName,
                painPoint: this.connectionData.painPoint,
                company: this.connectionData.companyName
              });
              
              break;
            }
          } catch (endpointError) {
            console.log(`Endpoint ${endpoint} failed:`, endpointError.message);
          }
        }
        
        // Also check global Typeform submission
        if (global.lastTypeformSubmission && !this.connectionData.painPoint) {
          console.log('📋 Using global Typeform submission data');
          const typeform = global.lastTypeformSubmission;
          this.connectionData.customerEmail = this.connectionData.customerEmail || typeform.email;
          this.connectionData.firstName = this.connectionData.firstName || typeform.first_name || typeform.firstName;
          this.connectionData.lastName = this.connectionData.lastName || typeform.last_name || typeform.lastName;
          this.connectionData.companyName = this.connectionData.companyName || typeform.company_name || typeform.companyName;
          this.connectionData.painPoint = this.connectionData.painPoint || typeform.pain_point || typeform.struggle;
        }
        
      } catch (error) {
        console.log('❌ Error fetching call metadata:', error.message);
      }
    }
  }

  extractFirstName(fullName) {
    if (!fullName) return null;
    return fullName.split(' ')[0];
  }

  setupEventHandlers() {
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('error', this.handleError.bind(this));
  }

  async handleMessage(data) {
    try {
      const parsed = JSON.parse(data);
      console.log('📥 Raw WebSocket Message:', JSON.stringify(parsed, null, 2));
      
      // Extract metadata from WebSocket messages
      if (parsed.call && parsed.call.metadata) {
        console.log('📞 Extracting metadata from WebSocket');
        const metadata = parsed.call.metadata;
        
        // Update connection data with any new information
        this.connectionData.customerEmail = this.connectionData.customerEmail || metadata.customer_email || metadata.email;
        this.connectionData.firstName = this.connectionData.firstName || metadata.first_name || metadata.firstName;
        this.connectionData.lastName = this.connectionData.lastName || metadata.last_name || metadata.lastName;
        this.connectionData.companyName = this.connectionData.companyName || metadata.company_name || metadata.companyName;
        this.connectionData.painPoint = this.connectionData.painPoint || metadata.pain_point || metadata.struggle;
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

    console.log('🗣️ User said:', userMessage);
    console.log('📊 Current phase:', this.conversationFlow.phase);
    console.log('👤 Customer:', this.connectionData.firstName || 'Unknown');

    // Mark that user has spoken
    if (!this.userHasSpoken) {
      this.userHasSpoken = true;
      console.log('👤 User spoke first - starting personalized flow');
    }

    // Check if appointment already booked
    if (this.appointmentBooked) {
      console.log('✅ Appointment already booked - wrapping up');
      await this.sendResponse("Perfect! You're all set. Is there anything else I can help you with today?", parsed.response_id);
      return;
    }

    // Add user message to conversation history
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // Handle conversation based on current phase
    switch (this.conversationFlow.phase) {
      case 'greeting':
        await this.handleGreetingPhase(userMessage, parsed.response_id);
        break;
      
      case 'rapport':
        await this.handleRapportPhase(userMessage, parsed.response_id);
        break;
      
      case 'pain_point':
        await this.handlePainPointPhase(userMessage, parsed.response_id);
        break;
      
      case 'solution':
        await this.handleSolutionPhase(userMessage, parsed.response_id);
        break;
      
      case 'scheduling':
        await this.handleSchedulingPhase(userMessage, parsed.response_id);
        break;
      
      case 'booking':
        await this.handleBookingPhase(userMessage, parsed.response_id);
        break;
      
      default:
        // Use AI for general conversation
        await this.generateAIResponse(userMessage, parsed.response_id);
    }
  }

  async handleGreetingPhase(userMessage, responseId) {
    console.log('👋 Handling greeting phase');
    
    // Create personalized greeting
    let greeting = "";
    if (this.connectionData.firstName) {
      greeting = `Hi ${this.connectionData.firstName}! This is Sarah from Nexella AI. How are you doing today?`;
    } else {
      greeting = "Hi there! This is Sarah from Nexella AI. How are you doing today?";
    }
    
    this.conversationHistory.push({ role: 'assistant', content: greeting });
    await this.sendResponse(greeting, responseId);
    
    // Move to rapport phase
    this.conversationFlow.phase = 'rapport';
    this.conversationFlow.greetingCompleted = true;
  }

  async handleRapportPhase(userMessage, responseId) {
    console.log('🤝 Building rapport');
    
    // Generate natural response to their greeting
    const messages = [...this.conversationHistory];
    messages.push({
      role: 'system',
      content: 'Respond naturally to their greeting. Show genuine interest. After responding, naturally transition to mentioning you noticed they submitted a form about some challenges they\'re facing. Keep it conversational and warm.'
    });
    
    try {
      const response = await this.generateAIResponseWithMessages(messages);
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
      
      // Move to pain point phase after rapport response
      this.conversationFlow.phase = 'pain_point';
      this.conversationFlow.rapportBuilt = true;
      
    } catch (error) {
      // Fallback response
      const fallback = "That's great to hear! I noticed you recently filled out our form about some challenges you're facing with your business. I'd love to hear more about what's been going on.";
      this.conversationHistory.push({ role: 'assistant', content: fallback });
      await this.sendResponse(fallback, responseId);
      
      this.conversationFlow.phase = 'pain_point';
      this.conversationFlow.rapportBuilt = true;
    }
  }

  async handlePainPointPhase(userMessage, responseId) {
    console.log('🎯 Discussing pain points');
    
    // Get specific pain point and create targeted response
    const painPointMap = {
      "not generating enough leads": {
        services: ["AI Texting", "SMS Revive", "Review Collector"],
        response: "I completely understand how frustrating it can be when you're not getting enough leads coming in. It's like having a great business but no one knows about it, right?"
      },
      "not following up with leads quickly enough": {
        services: ["AI Voice Calls", "SMS Follow-Ups", "Appointment Bookings"],
        response: "Oh, I hear this all the time! You get a lead but by the time you follow up, they've already moved on to someone else. Those first few minutes are so critical."
      },
      "not speaking to qualified leads": {
        services: ["AI qualification system", "CRM Integration"],
        response: "That's so frustrating when you spend time talking to people who aren't even a good fit for your services. It's such a waste of valuable time."
      },
      "miss calls too much": {
        services: ["AI Voice Calls", "SMS Follow-Ups"],
        response: "Missing calls is literally missing opportunities, isn't it? Especially when you know that could have been your next big client."
      },
      "can't handle the amount of leads": {
        services: ["Complete automation suite", "CRM Integration"],
        response: "What a great problem to have, but also overwhelming! It's like being so successful that success becomes the challenge."
      },
      "mix of everything above": {
        services: ["Complete AI Revenue Rescue System"],
        response: "Wow, it sounds like you're dealing with the full spectrum of growth challenges. That must feel pretty overwhelming at times."
      }
    };
    
    // Find the matching pain point
    let painPointKey = null;
    if (this.connectionData.painPoint) {
      const painPointLower = this.connectionData.painPoint.toLowerCase();
      for (const [key, value] of Object.entries(painPointMap)) {
        if (painPointLower.includes(key) || key.includes(painPointLower)) {
          painPointKey = key;
          break;
        }
      }
    }
    
    if (painPointKey) {
      const painData = painPointMap[painPointKey];
      const response = `${painData.response} And from what you shared in your form about ${this.connectionData.painPoint}, I can see this is really impacting your business.`;
      
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
      
      // Store services for solution phase
      this.recommendedServices = painData.services;
      
    } else {
      // Generic response if no specific pain point
      const response = "I'd love to understand more about the specific challenges you're facing. What's been the biggest frustration for you lately?";
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
    }
    
    // Move to solution phase
    this.conversationFlow.phase = 'solution';
    this.conversationFlow.painPointDiscussed = true;
  }

  async handleSolutionPhase(userMessage, responseId) {
    console.log('💡 Presenting solution');
    
    let solutionResponse = "";
    
    if (this.recommendedServices && this.recommendedServices.length > 0) {
      if (this.recommendedServices.includes("Complete AI Revenue Rescue System")) {
        solutionResponse = `Here's the good news... Our AI Revenue Rescue System is designed to handle exactly what you're going through. We basically put your entire lead management on autopilot - from the moment someone shows interest to booking them for appointments. Our AI never sleeps, never misses a call, and follows up instantly. ${this.connectionData.companyName ? `For a company like ${this.connectionData.companyName}, ` : 'Many of our clients say '}this completely transforms how they handle leads.`;
      } else {
        solutionResponse = `So here's how we can help... We use ${this.recommendedServices.join(' and ')} to solve this exact problem. ${this.recommendedServices.includes('AI Voice Calls') ? 'Our AI can answer calls 24/7 so you never miss an opportunity. ' : ''}${this.recommendedServices.includes('SMS Revive') ? 'We can even revive those old leads that went cold. ' : ''}The best part? Everything is automated and integrated with your existing systems.`;
      }
    } else {
      solutionResponse = "Based on what you've shared, I think our AI automation could really help streamline your lead management and ensure you're not leaving money on the table.";
    }
    
    this.conversationHistory.push({ role: 'assistant', content: solutionResponse });
    await this.sendResponse(solutionResponse, responseId);
    
    // Wait a moment then offer scheduling
    setTimeout(async () => {
      const schedulingOffer = `I'd love to show you exactly how this would work for ${this.connectionData.companyName || 'your business'}. Our owner, Jaden, does free personalized demos where he can show you the system in action and create a custom plan for your specific situation. Would you be interested in scheduling a quick demo call?`;
      
      this.conversationHistory.push({ role: 'assistant', content: schedulingOffer });
      await this.sendResponse(schedulingOffer, responseId);
      
      this.conversationFlow.phase = 'scheduling';
      this.conversationFlow.solutionPresented = true;
    }, 2000);
  }

  async handleSchedulingPhase(userMessage, responseId) {
    console.log('📅 Handling scheduling response');
    
    const userLower = userMessage.toLowerCase();
    
    // Check for positive intent
    if (userLower.includes('yes') || userLower.includes('sure') || userLower.includes('interested') || 
        userLower.includes('yeah') || userLower.includes('ok') || userLower.includes('sounds good') ||
        userLower.includes('let\'s do it') || userLower.includes('schedule')) {
      
      // Move to booking phase
      this.conversationFlow.phase = 'booking';
      
      const response = "Awesome! Let me check our calendar for available times. What day works best for you this week?";
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
      
    } else if (userLower.includes('no') || userLower.includes('not') || userLower.includes('maybe later')) {
      // Handle rejection gracefully
      const response = `No problem at all, ${this.connectionData.firstName || 'I'} completely understand! If you change your mind or want to learn more, we're always here. Is there anything specific about our services you'd like to know more about?`;
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
      
    } else {
      // Unclear response - use AI to handle
      await this.generateAIResponse(userMessage, responseId);
    }
  }

  async handleBookingPhase(userMessage, responseId) {
    console.log('📅 Processing booking request');
    
    // Check for specific appointment request
    const appointmentMatch = this.detectSpecificAppointmentRequest(userMessage);
    
    if (appointmentMatch) {
      console.log('🎯 Specific appointment time detected:', appointmentMatch);
      await this.handleImmediateAppointmentBooking(appointmentMatch, responseId);
    } else {
      // Check for day preference without specific time
      const dayMatch = userMessage.match(/\b(monday|tuesday|wednesday|thursday|friday|tomorrow|today)\b/i);
      
      if (dayMatch) {
        // Get available times for that day
        try {
          const preferredDay = dayMatch[0];
          const targetDate = this.calculateTargetDate(preferredDay, 10, 0);
          const availableSlots = await getAvailableTimeSlots(targetDate);
          
          if (availableSlots.length > 0) {
            const times = availableSlots.slice(0, 3).map(slot => slot.displayTime).join(', ');
            const response = `Great! I have ${availableSlots[0].displayTime}${availableSlots.length > 1 ? `, ${availableSlots[1].displayTime}` : ''}${availableSlots.length > 2 ? `, or ${availableSlots[2].displayTime}` : ''} available on ${preferredDay}. Which time works best for you?`;
            
            this.conversationHistory.push({ role: 'assistant', content: response });
            await this.sendResponse(response, responseId);
          } else {
            const response = `I don't have any openings on ${preferredDay}. How about ${this.getNextAvailableDay()}?`;
            this.conversationHistory.push({ role: 'assistant', content: response });
            await this.sendResponse(response, responseId);
          }
        } catch (error) {
          console.error('Error getting available slots:', error);
          await this.generateAIResponse(userMessage, responseId);
        }
      } else {
        // No specific day mentioned - offer options
        const response = "I have openings throughout the week. Would you prefer morning or afternoon? And what day works best - perhaps Tuesday or Thursday?";
        this.conversationHistory.push({ role: 'assistant', content: response });
        await this.sendResponse(response, responseId);
      }
    }
  }

  detectSpecificAppointmentRequest(userMessage) {
    console.log('🎯 Checking for specific appointment request:', userMessage);
    
    const patterns = [
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i,
      /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
      /\b(tomorrow|today)\s+(?:at\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i
    ];

    for (let i = 0; i < patterns.length; i++) {
      const match = userMessage.match(patterns[i]);
      if (match) {
        console.log('✅ Pattern matched:', match);
        return this.parseAppointmentMatch(match, i);
      }
    }
    
    return null;
  }

  parseAppointmentMatch(match, patternIndex) {
    let day, hour, minutes = 0, period = null;
    
    const wordToNum = {
      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
      'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
      'eleven': 11, 'twelve': 12
    };
    
    try {
      switch (patternIndex) {
        case 0: // "Thursday at 10am"
          day = match[1];
          hour = wordToNum[match[2]?.toLowerCase()] || parseInt(match[2]);
          minutes = parseInt(match[3] || '0');
          period = match[4];
          break;
        case 1: // "10am Thursday"
          hour = wordToNum[match[1]?.toLowerCase()] || parseInt(match[1]);
          minutes = parseInt(match[2] || '0');
          period = match[3];
          day = match[4];
          break;
        case 2: // "tomorrow at 10am"
          day = match[1];
          hour = wordToNum[match[2]?.toLowerCase()] || parseInt(match[2]);
          minutes = parseInt(match[3] || '0');
          period = match[4];
          break;
      }

      // Default to business hours if no period specified
      if (!period) {
        period = (hour >= 8 && hour <= 11) ? 'am' : 'pm';
      }

      // Convert to 24-hour format
      period = period.toLowerCase().replace(/[.\s]/g, '');
      if (period.includes('p') && hour !== 12) {
        hour += 12;
      } else if (period.includes('a') && hour === 12) {
        hour = 0;
      }

      const targetDate = this.calculateTargetDate(day, hour, minutes);
      
      const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
      const displayPeriod = hour >= 12 ? 'PM' : 'AM';
      
      return {
        dateTime: targetDate,
        dayName: day,
        timeString: `${displayHour}:${minutes.toString().padStart(2, '0')} ${displayPeriod}`,
        originalMatch: match[0],
        isBusinessHours: hour >= 8 && hour < 16,
        hour: hour
      };
      
    } catch (error) {
      console.error('Error parsing appointment:', error);
      return null;
    }
  }

  async handleImmediateAppointmentBooking(appointmentRequest, responseId) {
    try {
      console.log('🎯 Processing immediate appointment booking');
      
      // Validate business hours
      if (!appointmentRequest.isBusinessHours) {
        const response = `I'd love to schedule you for ${appointmentRequest.dayName} at ${appointmentRequest.timeString}, but our demo calls are available between 8 AM and 4 PM Arizona time. Would you like to choose a time in that window?`;
        await this.sendResponse(response, responseId);
        return;
      }

      // Validate customer email
      if (!this.connectionData.customerEmail) {
        const response = `Perfect timing! I just need your email address to send the calendar invitation.`;
        await this.sendResponse(response, responseId);
        return;
      }

      // Create discovery/form data for the appointment
      const appointmentData = {
        first_name: this.connectionData.firstName,
        last_name: this.connectionData.lastName,
        company_name: this.connectionData.companyName,
        pain_point: this.connectionData.painPoint,
        source: 'Typeform + AI Call',
        call_type: 'Demo Call with Owner'
      };

      // Immediately confirm
      const confirmationResponse = `Perfect! I'm booking your demo call with Jaden for ${appointmentRequest.dayName} at ${appointmentRequest.timeString} Arizona time. You'll receive a calendar invitation at ${this.connectionData.customerEmail} shortly!`;
      await this.sendResponse(confirmationResponse, responseId);

      // Mark as booked
      this.appointmentBooked = true;
      this.calendarBookingState.bookingConfirmed = true;
      this.conversationFlow.phase = 'completed';

      // Attempt real booking
      setTimeout(async () => {
        try {
          const bookingResult = await autoBookAppointment(
            this.connectionData.customerName || `${this.connectionData.firstName} ${this.connectionData.lastName}`,
            this.connectionData.customerEmail,
            this.connectionData.customerPhone,
            appointmentRequest.dateTime,
            appointmentData
          );

          if (bookingResult.success) {
            console.log('✅ Calendar booking successful!');
            await this.sendBookingWebhook(appointmentRequest, appointmentData, bookingResult, 'success');
          } else {
            console.log('❌ Calendar booking failed:', bookingResult.error);
            await this.sendBookingWebhook(appointmentRequest, appointmentData, null, 'failed');
          }
        } catch (error) {
          console.error('❌ Booking error:', error);
        }
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error in appointment booking:', error);
      const fallbackResponse = `I'll get that scheduled for you right away. You'll receive the details at ${this.connectionData.customerEmail}.`;
      await this.sendResponse(fallbackResponse, responseId);
      this.appointmentBooked = true;
    }
  }

  async generateAIResponse(userMessage, responseId) {
    try {
      const messages = [...this.conversationHistory];
      const response = await this.generateAIResponseWithMessages(messages);
      
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
      
    } catch (error) {
      console.error('AI response error:', error);
      const fallback = "I understand. Let me know if you have any questions about how we can help your business.";
      this.conversationHistory.push({ role: 'assistant', content: fallback });
      await this.sendResponse(fallback, responseId);
    }
  }

  async generateAIResponseWithMessages(messages) {
    const openaiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: messages,
        temperature: 0.7,
        max_tokens: 150
      },
      {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      }
    );

    return openaiResponse.data.choices[0].message.content;
  }

  async sendResponse(content, responseId) {
    const now = Date.now();
    
    // Anti-loop protection
    this.responsesSent = this.responsesSent.filter(time => now - time < 60000);
    
    if (this.responsesSent.length >= this.maxResponsesPerMinute) {
      console.log('🚫 Response rate limit reached');
      return;
    }
    
    // Enforce minimum delay
    const timeSinceLastResponse = now - this.lastResponseTime;
    if (timeSinceLastResponse < this.minimumResponseDelay) {
      const waitTime = this.minimumResponseDelay - timeSinceLastResponse;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    console.log('🤖 Sending:', content);
    
    this.ws.send(JSON.stringify({
      content: content,
      content_complete: true,
      actions: [],
      response_id: responseId || Date.now()
    }));
    
    this.lastResponseTime = Date.now();
    this.responsesSent.push(this.lastResponseTime);
  }

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
        if (daysToAdd <= 0) daysToAdd += 7;
        targetDate.setDate(targetDate.getDate() + daysToAdd);
      }
    }
    
    targetDate.setHours(hour, minutes, 0, 0);
    return targetDate;
  }

  getNextAvailableDay() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Skip weekends
    while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6) {
      tomorrow.setDate(tomorrow.getDate() + 1);
    }
    
    return dayNames[tomorrow.getDay()];
  }

  async sendBookingWebhook(appointmentRequest, discoveryData, bookingResult, status) {
    try {
      const webhookData = {
        ...discoveryData,
        appointment_requested: true,
        requested_time: appointmentRequest.timeString,
        requested_day: appointmentRequest.dayName,
        booking_status: status,
        calendar_status: status,
        booking_confirmed_to_user: true
      };
      
      if (bookingResult?.success) {
        webhookData.appointment_booked = true;
        webhookData.meeting_link = bookingResult.meetingLink || '';
        webhookData.event_id = bookingResult.eventId || '';
        webhookData.event_link = bookingResult.eventLink || '';
      }
      
      await sendSchedulingPreference(
        this.connectionData.customerName || `${this.connectionData.firstName} ${this.connectionData.lastName}`,
        this.connectionData.customerEmail,
        this.connectionData.customerPhone,
        `${appointmentRequest.dayName} at ${appointmentRequest.timeString}`,
        this.callId,
        webhookData
      );
      
      console.log(`✅ ${status} webhook sent`);
      
    } catch (error) {
      console.error('❌ Webhook error:', error.message);
    }
  }

  async handleClose() {
    console.log('🔌 Connection closed.');
    
    if (!this.webhookSent && this.callId && this.conversationFlow.rapportBuilt) {
      try {
        const conversationData = {
          first_name: this.connectionData.firstName,
          last_name: this.connectionData.lastName,
          company_name: this.connectionData.companyName,
          pain_point: this.connectionData.painPoint,
          conversation_phase: this.conversationFlow.phase,
          scheduling_interest: this.conversationFlow.schedulingOffered,
          appointment_booked: this.appointmentBooked
        };
        
        await sendSchedulingPreference(
          this.connectionData.customerName || `${this.connectionData.firstName} ${this.connectionData.lastName}`,
          this.connectionData.customerEmail,
          this.connectionData.customerPhone,
          'Call ended',
          this.callId,
          conversationData
        );
        
        console.log('✅ Final webhook sent on close');
      } catch (error) {
        console.error('❌ Final webhook failed:', error.message);
      }
    }
  }

  handleError(error) {
    console.error('❌ WebSocket Error:', error.message);
  }
}

module.exports = WebSocketHandler;
