// src/handlers/DynamicWebSocketHandler.js - ULTRA SIMPLE & FAST VERSION
const configLoader = require('../services/config/ConfigurationLoader');
const { autoBookAppointment, isCalendarInitialized } = require('../services/calendar/CalendarHelpers');
const { sendSchedulingPreference } = require('../services/webhooks/WebhookService');

class DynamicWebSocketHandler {
  constructor(ws, req, companyId) {
    this.ws = ws;
    this.req = req;
    this.companyId = companyId;
    this.config = null;
    
    // Extract call ID
    const callIdMatch = req.url.match(/\/call_([a-f0-9]+)/);
    this.callId = callIdMatch ? `call_${callIdMatch[1]}` : `call_${Date.now()}`;
    
    // Track conversation
    this.messageCount = 0;
    this.customerInfo = {
      name: null,
      need: null,
      day: null,
      time: null,
      phoneFromCall: req.headers['x-caller-phone'] || null
    };
    
    // Immediate initialization
    this.initialize();
  }
  
  async initialize() {
    try {
      this.config = await configLoader.loadCompanyConfig(this.companyId);
      console.log(`🏢 ${this.config.companyName} ready`);
      
      // Set up handlers
      this.ws.on('message', async (data) => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.interaction_type === 'response_required') {
            // IMMEDIATE response - no delays
            await this.respond(parsed);
          }
        } catch (error) {
          console.error('❌ Error:', error);
        }
      });
      
      this.ws.on('close', () => this.handleClose());
      
    } catch (error) {
      console.error('❌ Init failed:', error);
      this.ws.close();
    }
  }
  
  async respond(parsed) {
    const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
    console.log(`🗣️ User: ${userMessage}`);
    
    // Increment message count
    this.messageCount++;
    
    // Get response based on what we need to know
    let response = this.getResponse(userMessage);
    
    // Send immediately
    if (response) {
      console.log(`🤖 Mike: ${response}`);
      this.ws.send(JSON.stringify({
        content: response,
        content_complete: true,
        actions: [],
        response_id: parsed.response_id
      }));
    }
  }
  
  getResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    // Message 1: Greeting
    if (this.messageCount === 1) {
      return "Hey! Mike from Half Price Roof here. How's it going today?";
    }
    
    // Message 2: Acknowledge and pivot
    if (this.messageCount === 2) {
      if (lower.includes('good') || lower.includes('fine')) {
        return "Awesome! So what's going on with your roof?";
      } else {
        return "Thanks for taking my call! What can I help you with - repair, replacement, or inspection?";
      }
    }
    
    // Message 3+: Get what they need
    if (!this.customerInfo.need) {
      if (lower.includes('replac')) {
        this.customerInfo.need = 'replacement';
        return "Perfect, I can help with that replacement. Is this for your own home?";
      } else if (lower.includes('repair') || lower.includes('leak')) {
        this.customerInfo.need = 'repair';
        return "Got it, let's get that fixed. Is this your property?";
      } else if (lower.includes('inspect')) {
        this.customerInfo.need = 'inspection';
        return "Smart move! Is this for your own home?";
      } else {
        return "Are you looking for a repair, replacement, or just a free inspection?";
      }
    }
    
    // After we know their need, check ownership
    if (this.customerInfo.need && !this.customerInfo.day) {
      // They just answered ownership question
      if (this.messageCount === 4 || this.messageCount === 5) {
        if (lower.includes('ye') || lower.includes('own') || !lower.includes('no')) {
          return "Great! I can get someone out there this week. What day works best - Thursday or Friday?";
        } else {
          return "No problem! What day works for an inspection - Thursday or Friday?";
        }
      }
    }
    
    // Get the day
    if (!this.customerInfo.day) {
      if (lower.includes('thursday')) {
        this.customerInfo.day = 'Thursday';
        return "Thursday it is! Morning or afternoon better for you?";
      } else if (lower.includes('friday')) {
        this.customerInfo.day = 'Friday';
        return "Friday works! Morning or afternoon?";
      } else if (lower.includes('monday') || lower.includes('tuesday') || lower.includes('wednesday')) {
        const day = lower.match(/(monday|tuesday|wednesday)/)[0];
        this.customerInfo.day = day.charAt(0).toUpperCase() + day.slice(1);
        return `${this.customerInfo.day} works! Morning or afternoon?`;
      } else {
        return "What day works best for you this week?";
      }
    }
    
    // Get the time
    if (!this.customerInfo.time && this.customerInfo.day) {
      if (lower.includes('morning') || lower.includes('am')) {
        this.customerInfo.time = 'morning';
        return `Perfect! ${this.customerInfo.day} morning it is. Can I get your first name for the appointment?`;
      } else if (lower.includes('afternoon') || lower.includes('pm')) {
        this.customerInfo.time = 'afternoon';
        return `Great! ${this.customerInfo.day} afternoon. What's your first name?`;
      } else {
        return "Do you prefer morning or afternoon?";
      }
    }
    
    // Get their name
    if (!this.customerInfo.name && this.customerInfo.time) {
      // Assume this message is their name
      this.customerInfo.name = userMessage.trim().split(' ')[0]; // Get first word as first name
      
      // Try to book if calendar is available
      this.attemptBooking();
      
      return `Thanks ${this.customerInfo.name}! I've got you scheduled for ${this.customerInfo.day} ${this.customerInfo.time}. Our inspector will call 30 minutes before arrival. Sound good?`;
    }
    
    // Final confirmation
    if (this.customerInfo.name) {
      return "Perfect! You're all set. We'll see you then. Have a great day!";
    }
    
    // Fallback
    return "Sorry, what was that?";
  }
  
  async attemptBooking() {
    try {
      if (!isCalendarInitialized()) {
        console.log('📅 Calendar not available - manual booking needed');
        return;
      }
      
      // Calculate the date
      const bookingDate = this.getNextDate(this.customerInfo.day);
      
      // Set time based on preference
      if (this.customerInfo.time === 'morning') {
        bookingDate.setHours(9, 0, 0, 0); // 9 AM
      } else {
        bookingDate.setHours(14, 0, 0, 0); // 2 PM
      }
      
      // Try to book
      const result = await autoBookAppointment(
        this.customerInfo.name,
        '', // No email yet
        this.customerInfo.phoneFromCall || '',
        bookingDate,
        {
          service: this.customerInfo.need,
          source: 'Phone Call',
          company: this.config.companyName
        }
      );
      
      if (result.success) {
        console.log('✅ Appointment booked:', result.eventId);
      }
      
    } catch (error) {
      console.error('❌ Booking error:', error);
    }
  }
  
  getNextDate(dayName) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = new Date();
    const todayIndex = today.getDay();
    const targetIndex = days.indexOf(dayName.toLowerCase());
    
    let daysUntil = targetIndex - todayIndex;
    if (daysUntil <= 0) daysUntil += 7;
    
    const targetDate = new Date();
    targetDate.setDate(today.getDate() + daysUntil);
    return targetDate;
  }
  
  async handleClose() {
    console.log('🔌 Call ended');
    
    // Send webhook if we have info
    if (this.customerInfo.name && this.customerInfo.day) {
      await sendSchedulingPreference(
        this.customerInfo.name,
        '',
        this.customerInfo.phoneFromCall || 'Unknown',
        `${this.customerInfo.day} ${this.customerInfo.time}`,
        this.callId,
        {
          service: this.customerInfo.need,
          company: this.config.companyName,
          callDuration: Date.now()
        }
      );
    }
  }
}

module.exports = DynamicWebSocketHandler;
