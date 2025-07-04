// src/handlers/WebSocketHandler.js - PERSONALIZED TYPEFORM FLOW (NO FALLBACKS)
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
    
    // Store connection data
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
      typeformData: null
    };

    // Conversation flow management
    this.conversationFlow = {
      phase: 'waiting', // waiting -> greeting -> rapport -> pain_point -> solution -> scheduling -> booking
      userHasSpoken: false,
      greetingCompleted: false,
      rapportBuilt: false,
      painPointDiscussed: false,
      solutionPresented: false,
      schedulingOffered: false,
      bookingInProgress: false
    };

    // Booking state
    this.appointmentBooked = false;
    this.bookingInProgress = false;
    this.lastBookingAttempt = 0;
    this.bookingCooldown = 10000;
    
    // Response tracking
    this.responsesSent = [];
    this.maxResponsesPerMinute = 10;
    
    // Calendar booking state
    this.calendarBookingState = {
      hasDetectedBookingRequest: false,
      bookingConfirmed: false,
      lastBookingResponse: null,
      bookingResponseSent: false,
      lastAppointmentMatch: null,
      awaitingTimeSelection: false,
      offeredTimes: [],
      selectedDay: null
    };

    // System prompt
    this.conversationHistory = [
      {
        role: 'system',
        content: `You are Sarah from Nexella AI, a warm and friendly customer success specialist.

CRITICAL RULES:
1. WAIT for the user to speak first
2. Greet them by their FIRST NAME (from Typeform data)
3. Build rapport - ask how they're doing and respond warmly
4. Acknowledge their SPECIFIC pain point from the form
5. Explain how Nexella AI solves their specific problem
6. Only offer scheduling AFTER explaining the solution
7. When interrupted with questions, STOP and answer them

CONVERSATION FLOW:
Wait → Greet by name → Build rapport → Discuss pain point → Present solution → Offer scheduling → Book appointment

TONE: Warm, friendly, conversational. Use natural pauses.

BOOKING: When they give day/time, confirm and book immediately.`
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
    const calendarStatus = isCalendarInitialized();
    console.log('📅 Calendar Status:', calendarStatus ? 'ENABLED ✅' : 'DISABLED ⚠️');
    
    // Fetch customer data
    await this.fetchCustomerData();
    
    this.setupEventHandlers();

    console.log('🔇 Waiting for user to speak first...');
    console.log('👤 Customer:', this.connectionData.firstName);
    console.log('🏢 Company:', this.connectionData.companyName);
    console.log('🎯 Pain Point:', this.connectionData.painPoint);
  }

  async fetchCustomerData() {
    if (this.callId) {
      try {
        console.log('🔍 Fetching customer data for call:', this.callId);
        const TRIGGER_SERVER_URL = process.env.TRIGGER_SERVER_URL || config.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com';
        
        // Try endpoints
        const endpoints = [
          `${TRIGGER_SERVER_URL}/api/get-call-data/${this.callId}`,
          `${TRIGGER_SERVER_URL}/get-call-info/${this.callId}`,
          `${TRIGGER_SERVER_URL}/api/typeform/${this.callId}`
        ];
        
        for (const endpoint of endpoints) {
          try {
            const response = await axios.get(endpoint, { timeout: 3000 });
            
            if (response.data) {
              const data = response.data.data || response.data;
              console.log('📋 Retrieved data:', data);
              
              // Extract data
              this.connectionData.customerEmail = data.email || data.customer_email;
              this.connectionData.customerName = data.name || data.customer_name;
              this.connectionData.firstName = data.first_name || data.firstName;
              this.connectionData.lastName = data.last_name || data.lastName;
              this.connectionData.companyName = data.company_name || data.companyName;
              this.connectionData.customerPhone = data.phone || data.customer_phone;
              this.connectionData.painPoint = data.pain_point || data.struggle || data['What are you struggling the most with?'];
              
              if (this.connectionData.customerEmail && this.connectionData.firstName) {
                break;
              }
            }
          } catch (error) {
            console.log(`Failed ${endpoint}:`, error.message);
          }
        }
        
        // Check global Typeform
        if (global.lastTypeformSubmission) {
          console.log('📋 Using global Typeform data');
          const tf = global.lastTypeformSubmission;
          
          this.connectionData.customerEmail = this.connectionData.customerEmail || tf.email;
          this.connectionData.firstName = this.connectionData.firstName || tf.first_name;
          this.connectionData.lastName = this.connectionData.lastName || tf.last_name;
          this.connectionData.companyName = this.connectionData.companyName || tf.company_name;
          this.connectionData.painPoint = this.connectionData.painPoint || tf.pain_point;
        }
        
      } catch (error) {
        console.log('❌ Error fetching data:', error.message);
      }
    }
  }

  setupEventHandlers() {
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('error', this.handleError.bind(this));
  }

  async handleMessage(data) {
    try {
      const parsed = JSON.parse(data);
      
      if (parsed.interaction_type === 'response_required') {
        await this.processUserMessage(parsed);
      }
    } catch (error) {
      console.error('❌ Error handling message:', error.message);
    }
  }

  async processUserMessage(parsed) {
    const latestUserUtterance = parsed.transcript[parsed.transcript.length - 1];
    const userMessage = latestUserUtterance?.content || "";

    console.log('🗣️ User said:', userMessage);
    console.log('📊 Current phase:', this.conversationFlow.phase);

    // User has spoken
    if (!this.conversationFlow.userHasSpoken) {
      this.conversationFlow.userHasSpoken = true;
      this.conversationFlow.phase = 'greeting';
      console.log('👤 User spoke - starting greeting');
    }

    // Check if already booked
    if (this.appointmentBooked) {
      await this.sendResponse("Perfect! You're all set. Is there anything else I can help you with?", parsed.response_id);
      return;
    }

    // Add to history
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // Check for interruptions
    if (this.isInterruption(userMessage) && this.conversationFlow.phase !== 'booking') {
      await this.handleInterruption(userMessage, parsed.response_id);
      return;
    }

    // Handle phases
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
    }
  }

  isInterruption(userMessage) {
    const phrases = [
      'wait', 'hold on', 'question', 'what do you', 'how does', 
      'explain', 'tell me', 'what is', 'how much', 'pricing', 'cost'
    ];
    const lower = userMessage.toLowerCase();
    return phrases.some(p => lower.includes(p));
  }

  async handleInterruption(userMessage, responseId) {
    const messages = [...this.conversationHistory, {
      role: 'system',
      content: 'User interrupted with a question. Answer directly, then ask if they have other questions.'
    }];
    
    const response = await this.generateAIResponseWithMessages(messages);
    this.conversationHistory.push({ role: 'assistant', content: response });
    await this.sendResponse(response, responseId);
  }

  async handleGreetingPhase(userMessage, responseId) {
    console.log('👋 Greeting phase');
    
    const greeting = `Hi ${this.connectionData.firstName}! This is Sarah from Nexella AI. How are you doing today?`;
    
    this.conversationHistory.push({ role: 'assistant', content: greeting });
    await this.sendResponse(greeting, responseId);
    
    this.conversationFlow.phase = 'rapport';
    this.conversationFlow.greetingCompleted = true;
  }

  async handleRapportPhase(userMessage, responseId) {
    console.log('🤝 Building rapport');
    
    const messages = [...this.conversationHistory, {
      role: 'system',
      content: `Respond warmly to their greeting. Then mention you saw from their form they're struggling with "${this.connectionData.painPoint}". Show empathy.`
    }];
    
    const response = await this.generateAIResponseWithMessages(messages);
    this.conversationHistory.push({ role: 'assistant', content: response });
    await this.sendResponse(response, responseId);
    
    this.conversationFlow.phase = 'pain_point';
    this.conversationFlow.rapportBuilt = true;
  }

  async handlePainPointPhase(userMessage, responseId) {
    console.log('🎯 Discussing pain point');
    
    const painPointMap = {
      "we're not generating enough leads": {
        services: ["AI Texting", "SMS Revive", "Review Collector"],
        response: "I completely understand how frustrating it can be when you're not getting enough leads coming in. It's like having a great business but no one knows about it, right?"
      },
      "we're not following up with leads quickly enough": {
        services: ["AI Voice Calls", "SMS Follow-Ups", "Appointment Bookings"],
        response: "Oh, I hear this all the time! You get a lead but by the time you follow up, they've already moved on to someone else. Those first few minutes are so critical."
      },
      "we're not speaking to qualified leads": {
        services: ["AI qualification system", "CRM Integration"],
        response: "That's so frustrating when you spend time talking to people who aren't even a good fit for your services. It's such a waste of valuable time."
      },
      "we miss calls too much": {
        services: ["AI Voice Calls", "SMS Follow-Ups"],
        response: "Missing calls is literally missing opportunities, isn't it? Especially when you know that could have been your next big client."
      },
      "we can't handle the amount of leads": {
        services: ["Complete automation suite", "CRM Integration"],
        response: "What a great problem to have, but also overwhelming! It's like being so successful that success becomes the challenge."
      },
      "a mix of everything above": {
        services: ["Complete AI Revenue Rescue System"],
        response: "Wow, it sounds like you're dealing with the full spectrum of growth challenges. That must feel pretty overwhelming at times."
      }
    };
    
    const painLower = this.connectionData.painPoint.toLowerCase();
    let matched = null;
    
    for (const [key, value] of Object.entries(painPointMap)) {
      if (painLower.includes(key.replace("we're ", "").replace("we ", ""))) {
        matched = value;
        break;
      }
    }
    
    if (matched) {
      this.recommendedServices = matched.services;
      this.conversationHistory.push({ role: 'assistant', content: matched.response });
      await this.sendResponse(matched.response, responseId);
    }
    
    this.conversationFlow.phase = 'solution';
    this.conversationFlow.painPointDiscussed = true;
  }

  async handleSolutionPhase(userMessage, responseId) {
    console.log('💡 Presenting solution');
    
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    let solution = "";
    
    if (this.recommendedServices?.includes("Complete AI Revenue Rescue System")) {
      solution = `So here's what we do... We basically put your entire lead management on autopilot. From the moment someone shows interest - whether they call, text, or fill out a form - our AI takes over. It responds instantly, has natural conversations just like I'm having with you now, qualifies them based on YOUR criteria, and books them directly into your calendar. ${this.connectionData.firstName}, imagine waking up to a calendar full of qualified appointments that happened while you were sleeping!`;
    } else if (this.recommendedServices) {
      solution = `Here's exactly how we solve this... `;
      
      if (this.recommendedServices.includes("AI Voice Calls")) {
        solution += "Our AI answers every single call, 24/7, and sounds just like a real person. ";
      }
      if (this.recommendedServices.includes("SMS Follow-Ups")) {
        solution += "We follow up with every lead instantly by text, so they never go cold. ";
      }
      if (this.recommendedServices.includes("SMS Revive")) {
        solution += "We can even wake up all those old leads you thought were dead! ";
      }
      
      solution += `Everything integrates with your current systems seamlessly.`;
    }
    
    this.conversationHistory.push({ role: 'assistant', content: solution });
    await this.sendResponse(solution, responseId);
    
    setTimeout(async () => {
      const offer = `You know what? I'd love to show you exactly how this would work for ${this.connectionData.companyName || 'your business'}. Our owner, Jaden, does these personalized demo calls where he can show you the system live and create a custom solution just for you. It's completely free and super valuable. Would you be interested in seeing it in action?`;
      
      this.conversationHistory.push({ role: 'assistant', content: offer });
      await this.sendResponse(offer, responseId);
      
      this.conversationFlow.phase = 'scheduling';
      this.conversationFlow.solutionPresented = true;
    }, 3000);
  }

  async handleSchedulingPhase(userMessage, responseId) {
    console.log('📅 Handling scheduling');
    
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('yes') || lower.includes('sure') || lower.includes('yeah') || 
        lower.includes('ok') || lower.includes('sounds good')) {
      
      this.conversationFlow.phase = 'booking';
      
      const response = "Awesome! Let me check our calendar. What day works best for you this week?";
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
      
    } else if (lower.includes('no') || lower.includes('not')) {
      
      const response = `No problem at all, ${this.connectionData.firstName}! If you change your mind, we're always here. Is there anything specific you'd like to know more about?`;
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
      
    } else {
      const response = "Would you like me to check some available times for a demo call with Jaden?";
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
    }
  }

  async handleBookingPhase(userMessage, responseId) {
    console.log('📅 Processing booking');
    
    const appointmentMatch = this.detectSpecificAppointmentRequest(userMessage);
    
    if (appointmentMatch) {
      console.log('🎯 Detected:', appointmentMatch);
      await this.handleImmediateAppointmentBooking(appointmentMatch, responseId);
    } else {
      const dayMatch = userMessage.match(/\b(monday|tuesday|wednesday|thursday|friday|tomorrow|today)\b/i);
      
      if (dayMatch) {
        const day = dayMatch[0];
        this.calendarBookingState.selectedDay = day;
        const targetDate = this.calculateTargetDate(day, 10, 0);
        
        const slots = await getAvailableTimeSlots(targetDate);
        
        if (slots.length > 0) {
          this.calendarBookingState.offeredTimes = slots.slice(0, 3);
          this.calendarBookingState.awaitingTimeSelection = true;
          
          const times = this.calendarBookingState.offeredTimes.map(s => s.displayTime);
          const response = `Perfect! I have ${times.join(', or ')} available on ${day}. Which time works best?`;
          
          this.conversationHistory.push({ role: 'assistant', content: response });
          await this.sendResponse(response, responseId);
        }
      } else if (this.calendarBookingState.awaitingTimeSelection) {
        // Check time selection
        const timeMatch = userMessage.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (timeMatch) {
          const hour = parseInt(timeMatch[1]);
          const period = timeMatch[3] || (hour >= 8 && hour <= 11 ? 'am' : 'pm');
          
          const selected = this.calendarBookingState.offeredTimes.find(slot => 
            slot.displayTime.toLowerCase().includes(`${hour}:00 ${period.toLowerCase()}`)
          );
          
          if (selected) {
            const appointment = {
              dateTime: new Date(selected.startTime),
              dayName: this.calendarBookingState.selectedDay,
              timeString: selected.displayTime,
              hour: hour,
              isBusinessHours: true
            };
            await this.handleImmediateAppointmentBooking(appointment, responseId);
          }
        }
      } else {
        const response = "What day works best - Tuesday or Thursday? I have mornings and afternoons available.";
        this.conversationHistory.push({ role: 'assistant', content: response });
        await this.sendResponse(response, responseId);
      }
    }
  }

  detectSpecificAppointmentRequest(userMessage) {
    const patterns = [
      /\b(monday|tuesday|wednesday|thursday|friday)\s+(?:at\s+)?(\d{1,2}|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm)?/i,
      /\b(\d{1,2}|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday)/i,
      /\b(monday|tuesday|wednesday|thursday|friday)\s+(\d{1,2})\b/i
    ];

    for (let i = 0; i < patterns.length; i++) {
      const match = userMessage.match(patterns[i]);
      if (match) {
        return this.parseAppointmentMatch(match, i);
      }
    }
    return null;
  }

  parseAppointmentMatch(match, patternIndex) {
    let day, hour, minutes = 0, period = null;
    
    const wordToNum = { 'ten': 10, 'eleven': 11, 'twelve': 12 };
    
    switch (patternIndex) {
      case 0: // "Tuesday at 10am"
        day = match[1];
        hour = wordToNum[match[2]?.toLowerCase()] || parseInt(match[2]);
        minutes = parseInt(match[3] || '0');
        period = match[4];
        break;
      case 1: // "10am Tuesday"
        hour = wordToNum[match[1]?.toLowerCase()] || parseInt(match[1]);
        minutes = parseInt(match[2] || '0');
        period = match[3];
        day = match[4];
        break;
      case 2: // "Tuesday 10"
        day = match[1];
        hour = parseInt(match[2]);
        period = (hour >= 8 && hour <= 11) ? 'am' : 'pm';
        break;
    }

    if (period) {
      period = period.toLowerCase().replace(/[.\s]/g, '');
      if (period.includes('p') && hour !== 12) hour += 12;
      else if (period.includes('a') && hour === 12) hour = 0;
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
  }

  async handleImmediateAppointmentBooking(appointmentRequest, responseId) {
    console.log('🎯 Booking appointment');
    
    if (!appointmentRequest.isBusinessHours) {
      const response = `Our demo calls are available between 8 AM and 4 PM Arizona time. Would you prefer morning or afternoon?`;
      await this.sendResponse(response, responseId);
      return;
    }

    const confirmResponse = `Perfect! I'm booking your demo with Jaden for ${appointmentRequest.dayName} at ${appointmentRequest.timeString} Arizona time. You'll receive a calendar invitation at ${this.connectionData.customerEmail} shortly!`;
    await this.sendResponse(confirmResponse, responseId);

    this.appointmentBooked = true;
    this.calendarBookingState.bookingConfirmed = true;
    this.conversationFlow.phase = 'completed';

    // Book appointment
    setTimeout(async () => {
      const bookingResult = await autoBookAppointment(
        this.connectionData.customerName || `${this.connectionData.firstName} ${this.connectionData.lastName}`,
        this.connectionData.customerEmail,
        this.connectionData.customerPhone,
        appointmentRequest.dateTime,
        {
          first_name: this.connectionData.firstName,
          last_name: this.connectionData.lastName,
          company_name: this.connectionData.companyName,
          pain_point: this.connectionData.painPoint,
          source: 'Typeform + AI Call'
        }
      );

      if (bookingResult.success) {
        console.log('✅ Calendar booking successful!');
        await this.sendBookingWebhook(appointmentRequest, bookingResult, 'success');
      } else {
        console.log('❌ Booking failed:', bookingResult.error);
        await this.sendBookingWebhook(appointmentRequest, null, 'failed');
      }
    }, 1000);
  }

  async generateAIResponseWithMessages(messages) {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4',
        messages: messages,
        temperature: 0.7,
        max_tokens: 150
      },
      {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.choices[0].message.content;
  }

  async sendResponse(content, responseId) {
    const now = Date.now();
    
    this.responsesSent = this.responsesSent.filter(time => now - time < 60000);
    
    if (this.responsesSent.length >= this.maxResponsesPerMinute) {
      console.log('🚫 Rate limit reached');
      return;
    }
    
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
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayIndex = days.indexOf(day.toLowerCase());
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
    
    while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6) {
      tomorrow.setDate(tomorrow.getDate() + 1);
    }
    
    return dayNames[tomorrow.getDay()];
  }

  async sendBookingWebhook(appointmentRequest, bookingResult, status) {
    const webhookData = {
      first_name: this.connectionData.firstName,
      last_name: this.connectionData.lastName,
      company_name: this.connectionData.companyName,
      pain_point: this.connectionData.painPoint,
      appointment_requested: true,
      requested_time: appointmentRequest.timeString,
      requested_day: appointmentRequest.dayName,
      booking_status: status
    };
    
    if (bookingResult?.success) {
      webhookData.meeting_link = bookingResult.meetingLink || '';
      webhookData.event_id = bookingResult.eventId || '';
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
  }

  async handleClose() {
    console.log('🔌 Connection closed.');
    
    if (!this.webhookSent && this.callId && this.conversationFlow.rapportBuilt) {
      const conversationData = {
        first_name: this.connectionData.firstName,
        last_name: this.connectionData.lastName,
        company_name: this.connectionData.companyName,
        pain_point: this.connectionData.painPoint,
        conversation_phase: this.conversationFlow.phase,
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
    }
  }

  handleError(error) {
    console.error('❌ WebSocket Error:', error.message);
  }
}

module.exports = WebSocketHandler;
