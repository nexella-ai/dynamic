// src/handlers/WebSocketHandlerWithMemory.js - ENHANCED WITH TYPEFORM PERSONALIZATION
const axios = require('axios');
const config = require('../config/environment');
const { 
  autoBookAppointment,
  getAvailableTimeSlots,
  isCalendarInitialized
} = require('../services/calendar/CalendarHelpers');
const { 
  sendSchedulingPreference
} = require('../services/webhooks/WebhookService');

// Import Memory Services
let RAGMemoryService = null;
try {
  RAGMemoryService = require('../services/memory/RAGMemoryService');
} catch (error) {
  console.error('❌ RAGMemoryService not found');
}

class WebSocketHandlerWithMemory {
  constructor(ws, req) {
    this.ws = ws;
    this.req = req;
    this.callId = this.extractCallId(req.url);
    
    // Initialize RAG Memory Service
    this.memoryService = null;
    if (RAGMemoryService) {
      try {
        this.memoryService = new RAGMemoryService();
        console.log('🧠 Memory service initialized for personalized flow');
      } catch (error) {
        console.error('❌ Memory service initialization failed:', error.message);
      }
    }
    
    console.log('🔗 NEW CONNECTION WITH MEMORY - Call ID:', this.callId);
    
    // Connection data with Typeform fields
    this.connectionData = {
      callId: this.callId,
      customerEmail: null,
      customerName: null,
      firstName: null,
      lastName: null,
      companyName: null,
      customerPhone: null,
      painPoint: null,
      typeformData: null
    };

    // Enhanced conversation flow for Typeform-based interaction
    this.conversationFlow = {
      phase: 'greeting', // greeting -> rapport -> pain_point -> solution -> scheduling -> booking
      greetingCompleted: false,
      rapportBuilt: false,
      painPointDiscussed: false,
      solutionPresented: false,
      schedulingOffered: false,
      bookingInProgress: false
    };

    // Anti-loop protection
    this.appointmentBooked = false;
    this.bookingInProgress = false;
    this.lastBookingAttempt = 0;
    this.bookingCooldown = 10000;
    this.responsesSent = [];
    this.maxResponsesPerMinute = 10;
    
    // Enhanced conversation history with personalized system prompt
    this.conversationHistory = [
      {
        role: 'system',
        content: `You are Sarah from Nexella AI, a warm, empathetic customer success specialist who builds genuine rapport.

PERSONALIZED CONVERSATION FLOW:
1. WARM GREETING: Use their first name, be genuinely friendly
2. RAPPORT BUILDING: Show real interest in their well-being, respond naturally
3. PAIN POINT ACKNOWLEDGMENT: Reference their specific struggle from the form with empathy
4. SOLUTION PRESENTATION: Explain how Nexella AI specifically addresses their pain points
5. DEMO OFFER: After building trust, offer a free demo with the owner
6. BOOKING: Book immediately when they show interest

TONE GUIDELINES:
- Warm and conversational, like a helpful friend
- Use natural pauses ("...") for authenticity
- Show genuine empathy for their struggles
- Be enthusiastic but never pushy
- Personalize with their name and company

PAIN POINT SOLUTIONS:
- "Not generating enough leads" → AI Texting captures web visitors instantly, SMS Revive wakes up old leads
- "Not following up quickly" → AI responds in seconds 24/7, books appointments automatically
- "Not qualified leads" → AI asks your exact qualifying questions before booking
- "Missing calls" → AI never misses a call, texts if they can't talk
- "Can't handle volume" → Complete automation handles unlimited leads simultaneously
- "Mix of everything" → Our complete system solves all these issues at once

BOOKING RULES:
- Build rapport FIRST, don't rush to scheduling
- When booking, mention it's with Jaden (the owner)
- Hours: 8 AM - 4 PM Arizona time, Monday-Friday
- Always confirm calendar invitation will be sent

USE MEMORY: Reference any previous interactions or context naturally.`
      }
    ];
    
    this.userHasSpoken = false;
    this.hasGreeted = false;
    this.lastResponseTime = 0;
    this.minimumResponseDelay = 2000;
    this.connectionStartTime = Date.now();
    
    this.initialize();
  }

  async initialize() {
    console.log('🚀 Initializing with memory-enhanced Typeform flow');
    
    // Load customer data from all sources
    await this.loadCustomerDataWithMemory();
    
    // Store Typeform data in memory if we have it
    if (this.connectionData.typeformData) {
      await this.storeTypeformDataInMemory();
    }
    
    this.setupEventHandlers();
    
    console.log('🔇 Waiting for user to speak first...');
    console.log('👤 Customer:', this.connectionData.firstName || 'Unknown');
    console.log('🏢 Company:', this.connectionData.companyName || 'Unknown');
    console.log('🎯 Pain Point:', this.connectionData.painPoint || 'Unknown');
  }

  async loadCustomerDataWithMemory() {
    console.log('🔍 Loading customer data with memory enhancement...');
    
    // First, try to get data from standard sources
    await this.fetchCustomerDataFromSources();
    
    // Then enhance with memory if available
    if (this.memoryService && this.connectionData.customerEmail) {
      try {
        console.log('🧠 Retrieving customer memories...');
        
        // Get customer profile from memory
        const customerProfile = await this.memoryService.getCustomerContext(this.connectionData.customerEmail);
        
        if (customerProfile && customerProfile.totalInteractions > 0) {
          console.log('✅ Found customer in memory with', customerProfile.totalInteractions, 'previous interactions');
          
          // Retrieve Typeform submission from memory
          const typeformMemories = await this.memoryService.getMemoriesByType(
            this.connectionData.customerEmail,
            'typeform_submission',
            1
          );
          
          if (typeformMemories.length > 0) {
            const typeformData = typeformMemories[0].metadata;
            console.log('📋 Retrieved Typeform data from memory:', typeformData);
            
            // Update connection data with memory data
            this.connectionData.firstName = this.connectionData.firstName || typeformData.first_name;
            this.connectionData.lastName = this.connectionData.lastName || typeformData.last_name;
            this.connectionData.companyName = this.connectionData.companyName || typeformData.company_name;
            this.connectionData.painPoint = this.connectionData.painPoint || typeformData.pain_point;
            this.connectionData.typeformData = typeformData;
          }
          
          // Get previous pain points and solutions discussed
          const painPointMemories = await this.memoryService.getMemoriesByType(
            this.connectionData.customerEmail,
            'pain_points',
            3
          );
          
          if (painPointMemories.length > 0) {
            this.previousPainPoints = painPointMemories.map(m => m.content);
            console.log('📝 Previous pain points discussed:', this.previousPainPoints);
          }
        }
        
        // Generate conversation context
        this.conversationContext = await this.memoryService.generateEnhancedConversationContext(
          this.connectionData.customerEmail,
          'typeform submission pain points'
        );
        
        if (this.conversationContext) {
          console.log('🎯 Generated conversation context:', this.conversationContext.substring(0, 100) + '...');
          // Add context to system prompt
          this.conversationHistory[0].content += `\n\nCUSTOMER CONTEXT: ${this.conversationContext}`;
        }
        
      } catch (error) {
        console.error('❌ Error loading customer memory:', error.message);
      }
    }
  }

  async fetchCustomerDataFromSources() {
    // Try to get data from various sources
    if (this.callId) {
      try {
        const TRIGGER_SERVER_URL = config.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com';
        const endpoints = [
          `${TRIGGER_SERVER_URL}/api/get-call-data/${this.callId}`,
          `${TRIGGER_SERVER_URL}/get-call-info/${this.callId}`,
          `${TRIGGER_SERVER_URL}/api/typeform-data/${this.callId}`
        ];
        
        for (const endpoint of endpoints) {
          try {
            const response = await axios.get(endpoint, { timeout: 3000 });
            if (response.data) {
              const data = response.data.data || response.data;
              
              this.connectionData.customerEmail = data.email || data.customer_email;
              this.connectionData.customerName = data.name || data.customer_name;
              this.connectionData.firstName = data.first_name || data.firstName;
              this.connectionData.lastName = data.last_name || data.lastName;
              this.connectionData.companyName = data.company_name || data.companyName;
              this.connectionData.customerPhone = data.phone || data.customer_phone;
              this.connectionData.painPoint = data.pain_point || data.struggle;
              
              if (data.typeform_data) {
                this.connectionData.typeformData = data.typeform_data;
              }
              
              console.log('✅ Retrieved customer data from:', endpoint);
              break;
            }
          } catch (error) {
            continue;
          }
        }
      } catch (error) {
        console.log('⚠️ Could not fetch customer data:', error.message);
      }
    }
    
    // Check global Typeform submission
    if (global.lastTypeformSubmission && !this.connectionData.typeformData) {
      console.log('📋 Using global Typeform submission');
      const typeform = global.lastTypeformSubmission;
      this.connectionData.customerEmail = this.connectionData.customerEmail || typeform.email;
      this.connectionData.firstName = this.connectionData.firstName || typeform.first_name;
      this.connectionData.lastName = this.connectionData.lastName || typeform.last_name;
      this.connectionData.companyName = this.connectionData.companyName || typeform.company_name;
      this.connectionData.painPoint = this.connectionData.painPoint || typeform.pain_point;
      this.connectionData.typeformData = typeform;
    }
  }

  async storeTypeformDataInMemory() {
    if (!this.memoryService || !this.connectionData.customerEmail || !this.connectionData.typeformData) {
      return;
    }
    
    try {
      console.log('💾 Storing Typeform submission in memory...');
      
      const typeformContent = `Typeform submission from ${this.connectionData.firstName} ${this.connectionData.lastName} 
        Company: ${this.connectionData.companyName}
        Email: ${this.connectionData.customerEmail}
        Pain Point: ${this.connectionData.painPoint}
        Struggling with: ${this.connectionData.painPoint}`;
      
      const embedding = await this.memoryService.createEmbedding(typeformContent);
      
      await this.memoryService.storeMemories([{
        id: `typeform_${this.callId}_${Date.now()}`,
        values: embedding,
        metadata: {
          memory_type: 'typeform_submission',
          customer_email: this.connectionData.customerEmail,
          first_name: this.connectionData.firstName,
          last_name: this.connectionData.lastName,
          company_name: this.connectionData.companyName,
          pain_point: this.connectionData.painPoint,
          timestamp: new Date().toISOString(),
          call_id: this.callId,
          content: typeformContent
        }
      }]);
      
      console.log('✅ Typeform data stored in memory');
      
    } catch (error) {
      console.error('❌ Error storing Typeform data:', error.message);
    }
  }

  extractCallId(url) {
    const callIdMatch = url.match(/\/call_([a-f0-9]+)/);
    return callIdMatch ? `call_${callIdMatch[1]}` : null;
  }

  setupEventHandlers() {
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('error', this.handleError.bind(this));
  }

  async handleMessage(data) {
    try {
      const parsed = JSON.parse(data);
      
      // Extract any additional metadata from WebSocket
      if (parsed.call && parsed.call.metadata) {
        const metadata = parsed.call.metadata;
        this.connectionData.customerEmail = this.connectionData.customerEmail || metadata.customer_email;
        this.connectionData.firstName = this.connectionData.firstName || metadata.first_name;
        this.connectionData.painPoint = this.connectionData.painPoint || metadata.pain_point;
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

    // Mark user has spoken
    if (!this.userHasSpoken) {
      this.userHasSpoken = true;
      console.log('👤 User spoke first - starting personalized flow');
    }

    if (this.appointmentBooked) {
      console.log('✅ Appointment already booked');
      await this.sendResponse("Wonderful! You're all set. Looking forward to showing you how we can help your business grow!", parsed.response_id);
      return;
    }

    // Add to conversation history
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // Route based on conversation phase
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
        await this.generateMemoryEnhancedResponse(userMessage, parsed.response_id);
    }
  }

  async handleGreetingPhase(userMessage, responseId) {
    console.log('👋 Personalized greeting phase');
    
    let greeting = "";
    
    // Check if returning customer
    if (this.previousPainPoints && this.previousPainPoints.length > 0) {
      greeting = `Hi ${this.connectionData.firstName}! It's Sarah from Nexella AI again. Great to hear from you! How have things been going since we last spoke?`;
    } else if (this.connectionData.firstName) {
      greeting = `Hi ${this.connectionData.firstName}! This is Sarah from Nexella AI. Thanks for taking the time to fill out our form. How are you doing today?`;
    } else {
      greeting = "Hi there! This is Sarah from Nexella AI. I saw you submitted a form about some challenges you're facing. How are you doing today?";
    }
    
    this.conversationHistory.push({ role: 'assistant', content: greeting });
    await this.sendResponse(greeting, responseId);
    
    this.conversationFlow.phase = 'rapport';
    this.conversationFlow.greetingCompleted = true;
  }

  async handleRapportPhase(userMessage, responseId) {
    console.log('🤝 Building rapport with memory context');
    
    // Use memory-enhanced response generation
    const messages = [...this.conversationHistory];
    
    // Add memory context for rapport building
    if (this.conversationContext) {
      messages.push({
        role: 'system',
        content: `Build rapport naturally. After responding to their greeting, smoothly transition to acknowledging their form submission about ${this.connectionData.painPoint || 'their business challenges'}. Show you've reviewed their information. Be warm and empathetic.`
      });
    } else {
      messages.push({
        role: 'system',
        content: 'Build rapport naturally. After responding warmly to their greeting, mention you noticed they submitted a form about some business challenges. Be conversational and caring.'
      });
    }
    
    try {
      const response = await this.generateAIResponseWithMemory(messages);
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
      
      this.conversationFlow.phase = 'pain_point';
      this.conversationFlow.rapportBuilt = true;
      
    } catch (error) {
      const fallback = `That's great to hear! So I was looking at what you shared with us about ${this.connectionData.companyName || 'your business'}... it sounds like you're dealing with some real challenges. I'd love to understand more about what's been happening.`;
      this.conversationHistory.push({ role: 'assistant', content: fallback });
      await this.sendResponse(fallback, responseId);
      
      this.conversationFlow.phase = 'pain_point';
      this.conversationFlow.rapportBuilt = true;
    }
  }

  async handlePainPointPhase(userMessage, responseId) {
    console.log('🎯 Discussing pain points with empathy');
    
    // Map pain points to empathetic responses and solutions
    const painPointResponses = {
      "not generating enough leads": {
        empathy: "I completely understand how frustrating that must be... You have this great business but it feels like you're invisible online, right? Like potential customers just aren't finding you?",
        solutions: ["AI Texting", "SMS Revive", "Review Collector"],
        transition: "The good news is, we see this all the time and have some really effective ways to turn that around..."
      },
      "not following up with leads quickly enough": {
        empathy: "Oh, that's such a common struggle! You know those leads are gold, but by the time you get to them, they've already moved on to someone else. It's like watching money slip through your fingers...",
        solutions: ["AI Voice Calls", "SMS Follow-Ups", "Appointment Bookings"],
        transition: "What if I told you we could respond to every lead within seconds, 24/7?"
      },
      "not speaking to qualified leads": {
        empathy: "That must be so frustrating... spending all that time and energy talking to people who aren't even a good fit. It's exhausting and takes you away from the customers who really need what you offer.",
        solutions: ["AI qualification system", "CRM Integration"],
        transition: "We actually have a really smart way to filter out the tire-kickers before they even get to you..."
      },
      "miss calls too much": {
        empathy: "Missing calls is literally missing opportunities, isn't it? And the worst part is, you know each one could have been your next best customer. That feeling when you see a missed call... ugh!",
        solutions: ["AI Voice Calls", "SMS Follow-Ups"],
        transition: "Imagine never missing another call, even at 2 AM on a Sunday..."
      },
      "can't handle the amount of leads": {
        empathy: "What a great problem to have, but I totally get it... success can become overwhelming when you don't have the systems to handle it. It's like being too successful is actually hurting your business!",
        solutions: ["Complete automation suite", "CRM Integration"],
        transition: "This is exactly why we built our complete automation system..."
      },
      "mix of everything above": {
        empathy: "Wow, it sounds like you're getting hit from all angles. That must feel really overwhelming... like you're playing whack-a-mole with your business problems.",
        solutions: ["Complete AI Revenue Rescue System"],
        transition: "The good news is, all these problems actually have the same root cause, and we can fix them all at once..."
      }
    };
    
    // Find matching pain point
    let matchedPainPoint = null;
    let painPointKey = null;
    
    if (this.connectionData.painPoint) {
      const painLower = this.connectionData.painPoint.toLowerCase();
      for (const [key, value] of Object.entries(painPointResponses)) {
        if (painLower.includes(key) || key.includes(painLower)) {
          matchedPainPoint = value;
          painPointKey = key;
          break;
        }
      }
    }
    
    if (matchedPainPoint) {
      // Send empathetic response
      const response = `${matchedPainPoint.empathy} ${this.connectionData.companyName ? `Especially for a company like ${this.connectionData.companyName}...` : ''}`;
      
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
      
      // Store recommended services
      this.recommendedServices = matchedPainPoint.solutions;
      this.transitionPhrase = matchedPainPoint.transition;
      
      // Store pain point in memory
      if (this.memoryService && this.connectionData.customerEmail) {
        await this.storePainPointInMemory(painPointKey, response);
      }
      
    } else {
      // Ask for clarification
      const response = "I'd love to understand more about the specific challenges you're facing. What's been the biggest frustration for you lately with managing leads and customers?";
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
    }
    
    this.conversationFlow.phase = 'solution';
    this.conversationFlow.painPointDiscussed = true;
  }

  async handleSolutionPhase(userMessage, responseId) {
    console.log('💡 Presenting personalized solution');
    
    // Wait a bit for natural flow
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Use transition phrase if available
    if (this.transitionPhrase) {
      await this.sendResponse(this.transitionPhrase, responseId);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Build solution response based on services
    let solutionResponse = "";
    
    if (this.recommendedServices && this.recommendedServices.includes("Complete AI Revenue Rescue System")) {
      solutionResponse = `So here's what we do... We basically put your entire customer journey on autopilot. From the second someone shows interest - whether they call, text, or fill out a form - our AI takes over. It responds instantly, has natural conversations, qualifies them based on YOUR criteria, and books them directly into your calendar. ${this.connectionData.firstName ? `${this.connectionData.firstName}, ` : ''}imagine waking up to a calendar full of qualified appointments that happened while you were sleeping!`;
    } else if (this.recommendedServices) {
      solutionResponse = `Here's exactly how we solve this... `;
      
      if (this.recommendedServices.includes("AI Voice Calls")) {
        solutionResponse += "Our AI answers every single call, 24/7, and sounds just like a real person. ";
      }
      if (this.recommendedServices.includes("SMS Follow-Ups")) {
        solutionResponse += "We follow up with every lead instantly by text, so they never go cold. ";
      }
      if (this.recommendedServices.includes("SMS Revive")) {
        solutionResponse += "We can even wake up all those old leads you thought were dead - it's like finding money in your couch cushions! ";
      }
      if (this.recommendedServices.includes("AI Texting")) {
        solutionResponse += "When someone visits your website, our AI chats with them immediately and captures their info. ";
      }
      
      solutionResponse += `The best part? Everything integrates with your current systems, and we handle all the tech stuff for you.`;
    } else {
      solutionResponse = "Based on what you've shared, I have some ideas on how we can really help transform your lead management...";
    }
    
    this.conversationHistory.push({ role: 'assistant', content: solutionResponse });
    await this.sendResponse(solutionResponse, responseId);
    
    // Wait then offer demo
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const demoOffer = `You know what? I'd love to show you exactly how this would work for ${this.connectionData.companyName || 'your specific business'}. Our owner, Jaden, does these personalized demo calls where he can show you the system live and create a custom solution just for you. It's completely free and super valuable - even if you decide not to move forward. Would you be interested in seeing it in action?`;
    
    this.conversationHistory.push({ role: 'assistant', content: demoOffer });
    await this.sendResponse(demoOffer, responseId);
    
    this.conversationFlow.phase = 'scheduling';
    this.conversationFlow.solutionPresented = true;
  }

  async handleSchedulingPhase(userMessage, responseId) {
    console.log('📅 Handling scheduling interest');
    
    const userLower = userMessage.toLowerCase();
    
    if (userLower.includes('yes') || userLower.includes('sure') || userLower.includes('interested') || 
        userLower.includes('yeah') || userLower.includes('sounds good') || userLower.includes('ok')) {
      
      this.conversationFlow.phase = 'booking';
      
      const response = `Awesome, ${this.connectionData.firstName || 'I'} love your enthusiasm! Let me pull up Jaden's calendar... What day this week would work best for you?`;
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
      
    } else if (userLower.includes('no') || userLower.includes('not') || userLower.includes('later')) {
      
      const response = `No worries at all! I totally understand. Just so you know, we're here whenever you're ready. Is there anything specific about our services you'd like to know more about? Sometimes people have questions about pricing or how it all works...`;
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
      
      // Store in memory that they declined scheduling
      if (this.memoryService && this.connectionData.customerEmail) {
        await this.storeSchedulingDeclineInMemory();
      }
      
    } else {
      // Unclear response - use memory-enhanced AI
      await this.generateMemoryEnhancedResponse(userMessage, responseId);
    }
  }

  async handleBookingPhase(userMessage, responseId) {
    console.log('📅 Processing booking with memory enhancement');
    
    // Check for specific appointment request
    const appointmentMatch = this.detectSpecificAppointmentRequest(userMessage);
    
    if (appointmentMatch) {
      await this.handleImmediateAppointmentBooking(appointmentMatch, responseId);
    } else {
      // Check for day preference
      const dayMatch = userMessage.match(/\b(monday|tuesday|wednesday|thursday|friday|tomorrow|today)\b/i);
      
      if (dayMatch) {
        const preferredDay = dayMatch[0];
        const targetDate = this.calculateTargetDate(preferredDay, 10, 0);
        
        try {
          const availableSlots = await getAvailableTimeSlots(targetDate);
          
          if (availableSlots.length > 0) {
            const times = availableSlots.slice(0, 3).map(slot => slot.displayTime);
            let response = `Perfect! I have `;
            if (times.length === 1) {
              response += `${times[0]} available`;
            } else if (times.length === 2) {
              response += `${times[0]} or ${times[1]} available`;
            } else {
              response += `${times[0]}, ${times[1]}, or ${times[2]} available`;
            }
            response += ` on ${preferredDay}. Which time works best for you?`;
            
            this.conversationHistory.push({ role: 'assistant', content: response });
            await this.sendResponse(response, responseId);
          } else {
            const response = `Hmm, looks like ${preferredDay} is fully booked. How about ${this.getNextAvailableDay()}? I can check what times are open.`;
            this.conversationHistory.push({ role: 'assistant', content: response });
            await this.sendResponse(response, responseId);
          }
        } catch (error) {
          console.error('Error checking availability:', error);
          await this.generateMemoryEnhancedResponse(userMessage, responseId);
        }
      } else {
        // No specific day - offer suggestions
        const response = "I have good availability this week! Do you prefer mornings or afternoons? And what days generally work best for you - maybe Tuesday or Thursday?";
        this.conversationHistory.push({ role: 'assistant', content: response });
        await this.sendResponse(response, responseId);
      }
    }
  }

  detectSpecificAppointmentRequest(userMessage) {
    const patterns = [
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i,
      /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
      /\b(tomorrow|today)\s+(?:at\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i
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
    
    const wordToNum = {
      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
      'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
      'eleven': 11, 'twelve': 12
    };
    
    try {
      switch (patternIndex) {
        case 0:
          day = match[1];
          hour = wordToNum[match[2]?.toLowerCase()] || parseInt(match[2]);
          minutes = parseInt(match[3] || '0');
          period = match[4];
          break;
        case 1:
          hour = wordToNum[match[1]?.toLowerCase()] || parseInt(match[1]);
          minutes = parseInt(match[2] || '0');
          period = match[3];
          day = match[4];
          break;
        case 2:
          day = match[1];
          hour = wordToNum[match[2]?.toLowerCase()] || parseInt(match[2]);
          minutes = parseInt(match[3] || '0');
          period = match[4];
          break;
      }

      if (!period) {
        period = (hour >= 8 && hour <= 11) ? 'am' : 'pm';
      }

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
      console.log('🎯 Processing immediate booking with memory');
      
      if (!appointmentRequest.isBusinessHours) {
        const response = `I'd love to book that time, but Jaden's demo calls are available between 8 AM and 4 PM Arizona time. Would morning or afternoon work better for you on ${appointmentRequest.dayName}?`;
        await this.sendResponse(response, responseId);
        return;
      }

      if (!this.connectionData.customerEmail) {
        const response = `Perfect! I just need to confirm your email address to send the calendar invitation. What's the best email for you?`;
        await this.sendResponse(response, responseId);
        return;
      }

      // Create comprehensive appointment data
      const appointmentData = {
        first_name: this.connectionData.firstName,
        last_name: this.connectionData.lastName,
        company_name: this.connectionData.companyName,
        pain_point: this.connectionData.painPoint,
        recommended_services: this.recommendedServices?.join(', '),
        source: 'Typeform + AI Call',
        call_type: 'Demo Call with Owner',
        has_memory_context: !!this.conversationContext
      };

      // Immediate confirmation
      const confirmationResponse = `Excellent! I'm booking your demo with Jaden for ${appointmentRequest.dayName} at ${appointmentRequest.timeString} Arizona time right now... Done! You'll get a calendar invitation at ${this.connectionData.customerEmail} with all the details including a meeting link. Jaden's really looking forward to showing you how we can solve those ${this.connectionData.painPoint || 'challenges'} you mentioned!`;
      
      await this.sendResponse(confirmationResponse, responseId);

      this.appointmentBooked = true;
      this.conversationFlow.phase = 'completed';

      // Store successful booking in memory
      if (this.memoryService && this.connectionData.customerEmail) {
        await this.storeSuccessfulBookingInMemory(appointmentRequest, appointmentData);
      }

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
            console.log('✅ Calendar booking successful with memory context!');
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
      const fallbackResponse = `Perfect! I'll get that demo scheduled with Jaden right away. You'll receive all the details at ${this.connectionData.customerEmail}.`;
      await this.sendResponse(fallbackResponse, responseId);
      this.appointmentBooked = true;
    }
  }

  async generateMemoryEnhancedResponse(userMessage, responseId) {
    console.log('🤖 Generating memory-enhanced response');
    
    try {
      let relevantMemories = [];
      
      // Search for relevant memories if available
      if (this.memoryService && this.connectionData.customerEmail) {
        relevantMemories = await this.memoryService.retrieveRelevantMemories(
          this.connectionData.customerEmail,
          userMessage,
          3
        );
      }
      
      // Also search Nexella knowledge base
      let nexellaKnowledge = [];
      if (this.memoryService) {
        try {
          const queryEmbedding = await this.memoryService.createEmbedding(userMessage);
          const knowledgeResults = await this.memoryService.index.query({
            vector: queryEmbedding,
            filter: { source: { $eq: 'nexella_knowledge' } },
            topK: 2,
            includeMetadata: true
          });
          
          if (knowledgeResults.matches) {
            nexellaKnowledge = knowledgeResults.matches.map(m => m.metadata);
          }
        } catch (error) {
          console.log('Could not search Nexella knowledge:', error.message);
        }
      }
      
      // Build enhanced messages with context
      const messages = [...this.conversationHistory];
      
      if (relevantMemories.length > 0 || nexellaKnowledge.length > 0) {
        let contextAddition = '\n\nRELEVANT CONTEXT: ';
        
        if (relevantMemories.length > 0) {
          contextAddition += 'Previous interactions show: ';
          relevantMemories.forEach(m => {
            contextAddition += `${m.content}. `;
          });
        }
        
        if (nexellaKnowledge.length > 0) {
          contextAddition += '\nNexella information: ';
          nexellaKnowledge.forEach(k => {
            if (k.answer) {
              contextAddition += `${k.answer}. `;
            }
          });
        }
        
        messages[messages.length - 1].content += contextAddition;
      }
      
      const response = await this.generateAIResponseWithMemory(messages);
      this.conversationHistory.push({ role: 'assistant', content: response });
      await this.sendResponse(response, responseId);
      
    } catch (error) {
      console.error('Error generating memory-enhanced response:', error);
      await this.generateAIResponseWithMemory(this.conversationHistory);
    }
  }

  async generateAIResponseWithMemory(messages) {
    const openaiResponse = await axios.post(
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
        },
        timeout: 8000
      }
    );

    return openaiResponse.data.choices[0].message.content;
  }

  async sendResponse(content, responseId) {
    const now = Date.now();
    
    // Rate limiting
    this.responsesSent = this.responsesSent.filter(time => now - time < 60000);
    if (this.responsesSent.length >= this.maxResponsesPerMinute) {
      console.log('🚫 Rate limit reached');
      return;
    }
    
    // Minimum delay
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

  // Memory storage methods
  async storePainPointInMemory(painPoint, response) {
    if (!this.memoryService || !this.connectionData.customerEmail) return;
    
    try {
      const content = `${this.connectionData.firstName} from ${this.connectionData.companyName} struggles with: ${painPoint}. We discussed how our ${this.recommendedServices?.join(', ')} can help.`;
      const embedding = await this.memoryService.createEmbedding(content);
      
      await this.memoryService.storeMemories([{
        id: `pain_point_${this.callId}_${Date.now()}`,
        values: embedding,
        metadata: {
          memory_type: 'pain_points',
          customer_email: this.connectionData.customerEmail,
          pain_point: painPoint,
          recommended_services: this.recommendedServices,
          timestamp: new Date().toISOString(),
          call_id: this.callId,
          content: content
        }
      }]);
    } catch (error) {
      console.error('Error storing pain point:', error);
    }
  }

  async storeSchedulingDeclineInMemory() {
    if (!this.memoryService || !this.connectionData.customerEmail) return;
    
    try {
      const content = `${this.connectionData.firstName} declined scheduling a demo call after discussing ${this.connectionData.painPoint}. May need follow-up later.`;
      const embedding = await this.memoryService.createEmbedding(content);
      
      await this.memoryService.storeMemories([{
        id: `scheduling_decline_${this.callId}_${Date.now()}`,
        values: embedding,
        metadata: {
          memory_type: 'interaction_summary',
          customer_email: this.connectionData.customerEmail,
          outcome: 'declined_scheduling',
          timestamp: new Date().toISOString(),
          call_id: this.callId,
          content: content
        }
      }]);
    } catch (error) {
      console.error('Error storing scheduling decline:', error);
    }
  }

  async storeSuccessfulBookingInMemory(appointmentRequest, appointmentData) {
    if (!this.memoryService || !this.connectionData.customerEmail) return;
    
    try {
      const content = `Successfully booked demo call for ${this.connectionData.firstName} from ${this.connectionData.companyName} on ${appointmentRequest.dayName} at ${appointmentRequest.timeString}. Pain point: ${this.connectionData.painPoint}. Recommended services: ${this.recommendedServices?.join(', ')}.`;
      const embedding = await this.memoryService.createEmbedding(content);
      
      await this.memoryService.storeMemories([{
        id: `booking_success_${this.callId}_${Date.now()}`,
        values: embedding,
        metadata: {
          memory_type: 'appointment_booking',
          customer_email: this.connectionData.customerEmail,
          booking_time: appointmentRequest.timeString,
          booking_day: appointmentRequest.dayName,
          pain_point: this.connectionData.painPoint,
          recommended_services: this.recommendedServices,
          timestamp: new Date().toISOString(),
          call_id: this.callId,
          content: content
        }
      }]);
    } catch (error) {
      console.error('Error storing successful booking:', error);
    }
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
        booking_confirmed_to_user: true,
        memory_enhanced: true,
        conversation_context: this.conversationContext ? 'yes' : 'no'
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
      
      console.log(`✅ ${status} webhook sent with memory context`);
      
    } catch (error) {
      console.error('❌ Webhook error:', error.message);
    }
  }

  async handleClose() {
    console.log('🔌 Connection closed - saving conversation to memory');
    
    try {
      if (this.memoryService && this.connectionData.customerEmail && this.conversationFlow.rapportBuilt) {
        const conversationData = {
          duration: Math.round((Date.now() - (this.connectionStartTime || Date.now())) / 60000),
          questionsCompleted: 0, // Not using discovery questions in this flow
          schedulingCompleted: this.appointmentBooked,
          userSentiment: this.detectUserSentiment(),
          callEndReason: 'user_disconnect',
          appointmentBooked: this.appointmentBooked,
          conversationPhase: this.conversationFlow.phase,
          painPointDiscussed: this.conversationFlow.painPointDiscussed,
          solutionPresented: this.conversationFlow.solutionPresented
        };
        
        const typeformData = {
          first_name: this.connectionData.firstName,
          last_name: this.connectionData.lastName,
          company_name: this.connectionData.companyName,
          pain_point: this.connectionData.painPoint,
          recommended_services: this.recommendedServices?.join(', ')
        };
        
        await this.memoryService.storeEnhancedConversationMemory(
          this.callId,
          this.connectionData,
          conversationData,
          typeformData
        );
        
        console.log('✅ Conversation saved to memory');
      }
      
      // Send final webhook
      if (this.connectionData.customerEmail && this.conversationFlow.rapportBuilt) {
        await sendSchedulingPreference(
          this.connectionData.customerName || `${this.connectionData.firstName} ${this.connectionData.lastName}`,
          this.connectionData.customerEmail,
          this.connectionData.customerPhone,
          'Call ended',
          this.callId,
          {
            conversation_phase: this.conversationFlow.phase,
            pain_point_discussed: this.conversationFlow.painPointDiscussed,
            solution_presented: this.conversationFlow.solutionPresented,
            scheduling_offered: this.conversationFlow.schedulingOffered,
            appointment_booked: this.appointmentBooked
          }
        );
      }
      
    } catch (error) {
      console.error('Error in connection close handler:', error);
    }
  }

  detectUserSentiment() {
    const lastUserMessages = this.conversationHistory
      .filter(msg => msg.role === 'user')
      .slice(-3)
      .map(msg => msg.content.toLowerCase())
      .join(' ');
    
    if (lastUserMessages.includes('great') || lastUserMessages.includes('perfect') || 
        lastUserMessages.includes('awesome') || lastUserMessages.includes('love')) {
      return 'positive';
    } else if (lastUserMessages.includes('no') || lastUserMessages.includes('not interested') || 
               lastUserMessages.includes('maybe later')) {
      return 'negative';
    }
    
    return 'neutral';
  }

  handleError(error) {
    console.error('❌ WebSocket Error:', error.message);
  }
}

module.exports = WebSocketHandlerWithMemory;
