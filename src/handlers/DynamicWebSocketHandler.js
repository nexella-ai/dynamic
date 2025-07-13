// src/handlers/DynamicWebSocketHandler.js - ENHANCED WITH BETTER DISCOVERY & NAME RECOGNITION
const configLoader = require('../services/config/ConfigurationLoader');
const { autoBookAppointment, isCalendarInitialized, initializeCalendarService } = require('../services/calendar/CalendarHelpers');
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
    
    // Track conversation with enhanced discovery
    this.messageCount = 0;
    this.customerInfo = {
      name: null,
      firstName: null,
      phone: this.req.headers['x-caller-phone'] || null,
      // Roofing specific info
      propertyType: null,      // residential/commercial
      roofAge: null,          // how old is the roof
      issue: null,            // leak, damage, replacement, inspection
      urgency: null,          // emergency, this week, planning
      insuranceClaim: null,   // yes/no/maybe
      propertyAddress: null,  // for accurate scheduling
      // Scheduling
      day: null,
      time: null,
      readyToSchedule: false
    };
    
    // Discovery questions tracker
    this.discoveryPhase = 'greeting'; // greeting -> need -> details -> scheduling
    this.questionsAsked = {
      need: false,
      propertyType: false,
      urgency: false,
      roofAge: false,
      insuranceClaim: false,
      address: false
    };
    
    // Response cache to prevent repeats
    this.lastResponse = null;
    this.lastUserMessage = null;
    
    // Initialize immediately
    this.initialize();
  }
  
  async initialize() {
    try {
      // Ensure calendar is initialized
      if (!isCalendarInitialized()) {
        console.log('📅 Initializing calendar service...');
        await initializeCalendarService();
      }
      
      this.config = await configLoader.loadCompanyConfig(this.companyId);
      console.log(`🏢 ${this.config.companyName} ready`);
      console.log(`📅 Calendar status: ${isCalendarInitialized() ? 'READY ✅' : 'NOT READY ❌'}`);
      
      // Set up handlers
      this.ws.on('message', async (data) => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.interaction_type === 'response_required') {
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
    
    // Prevent responding to the same message twice
    if (userMessage === this.lastUserMessage) {
      console.log('🚫 Duplicate message ignored');
      return;
    }
    this.lastUserMessage = userMessage;
    
    // Increment message count
    this.messageCount++;
    
    // Get response based on discovery phase
    let response = await this.getResponse(userMessage);
    
    // Send immediately if we have a response
    if (response && response !== this.lastResponse) {
      console.log(`🤖 Mike: ${response}`);
      this.lastResponse = response;
      
      this.ws.send(JSON.stringify({
        content: response,
        content_complete: true,
        actions: [],
        response_id: parsed.response_id
      }));
    }
  }
  
  async getResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    // Phase 1: Initial Greeting
    if (this.messageCount === 1) {
      this.discoveryPhase = 'greeting';
      return "Hey! Mike from Half Price Roof here. How's it going today?";
    }
    
    // Phase 2: Acknowledge greeting and ask about need
    if (this.discoveryPhase === 'greeting' && this.messageCount === 2) {
      this.discoveryPhase = 'need';
      if (lower.includes('good') || lower.includes('fine') || lower.includes('well')) {
        return "Awesome! So what's going on with your roof? Are you dealing with a leak, need a replacement, or just looking for an inspection?";
      } else {
        return "I hear you. Well, I'm here to help with any roofing needs. What's going on with your roof?";
      }
    }
    
    // Phase 3: Capture their need and ask property type
    if (this.discoveryPhase === 'need' && !this.customerInfo.issue) {
      if (lower.includes('replac')) {
        this.customerInfo.issue = 'replacement';
        this.discoveryPhase = 'details';
        return "Got it, full roof replacement. Is this for your home or a commercial property?";
      } else if (lower.includes('leak') || lower.includes('water')) {
        this.customerInfo.issue = 'leak';
        this.discoveryPhase = 'details';
        return "Oh no, a leak! Those need quick attention. Is this at your home or a business?";
      } else if (lower.includes('inspect') || lower.includes('check')) {
        this.customerInfo.issue = 'inspection';
        this.discoveryPhase = 'details';
        return "Smart to get it inspected! Is this for a residential or commercial property?";
      } else if (lower.includes('damage') || lower.includes('storm')) {
        this.customerInfo.issue = 'storm damage';
        this.discoveryPhase = 'details';
        return "Storm damage can be serious. Is this your home or a commercial building?";
      } else {
        // They said something else, probe more
        return "I can help with repairs, replacements, or free inspections. Which one are you looking for?";
      }
    }
    
    // Phase 4: Get property type and ask urgency
    if (this.discoveryPhase === 'details' && !this.customerInfo.propertyType) {
      if (lower.includes('home') || lower.includes('house') || lower.includes('residential') || lower.includes('yes')) {
        this.customerInfo.propertyType = 'residential';
        this.questionsAsked.propertyType = true;
        
        if (this.customerInfo.issue === 'leak') {
          return "I'll make sure we get someone out quickly. Is water actively coming in right now, or is it more of a slow leak?";
        } else {
          return "Perfect. How urgent is this - do you need someone out right away or are you planning ahead?";
        }
      } else if (lower.includes('commercial') || lower.includes('business') || lower.includes('building')) {
        this.customerInfo.propertyType = 'commercial';
        this.questionsAsked.propertyType = true;
        return "We handle a lot of commercial properties. How urgent is this for your business?";
      }
    }
    
    // Phase 5: Get urgency and ask about roof age (for replacements)
    if (!this.customerInfo.urgency && this.questionsAsked.propertyType) {
      if (lower.includes('emergency') || lower.includes('asap') || lower.includes('right away') || 
          lower.includes('active') || lower.includes('coming in')) {
        this.customerInfo.urgency = 'emergency';
        this.questionsAsked.urgency = true;
        return "We have emergency crews available. Do you know roughly how old your roof is?";
      } else if (lower.includes('week') || lower.includes('soon')) {
        this.customerInfo.urgency = 'this week';
        this.questionsAsked.urgency = true;
        return "We can definitely get someone out this week. About how old is your current roof?";
      } else if (lower.includes('planning') || lower.includes('quote') || lower.includes('slow')) {
        this.customerInfo.urgency = 'planning';
        this.questionsAsked.urgency = true;
        return "Good to plan ahead! Do you know approximately how old your roof is?";
      }
    }
    
    // Phase 6: Get roof age and ask about insurance
    if (!this.customerInfo.roofAge && this.questionsAsked.urgency) {
      // Try to extract age from response
      const ageMatch = lower.match(/(\d+)\s*(year|yr)/);
      if (ageMatch) {
        this.customerInfo.roofAge = `${ageMatch[1]} years`;
      } else if (lower.includes('new') || lower.includes('recent')) {
        this.customerInfo.roofAge = 'less than 5 years';
      } else if (lower.includes('old') || lower.includes("don't know") || lower.includes('not sure')) {
        this.customerInfo.roofAge = 'unknown';
      } else {
        // Assume they gave a non-specific answer
        this.customerInfo.roofAge = 'not specified';
      }
      
      this.questionsAsked.roofAge = true;
      
      if (this.customerInfo.issue === 'storm damage' || this.customerInfo.issue === 'leak') {
        return "Thanks. Are you planning to file an insurance claim for this?";
      } else {
        // Skip insurance question for regular replacements/inspections
        this.questionsAsked.insuranceClaim = true;
        this.customerInfo.insuranceClaim = 'N/A';
        return "Great! Now let me check our schedule. What's your first name for the appointment?";
      }
    }
    
    // Phase 7: Get insurance info and ask for name
    if (!this.customerInfo.insuranceClaim && this.questionsAsked.roofAge) {
      if (lower.includes('yes') || lower.includes('file') || lower.includes('claim')) {
        this.customerInfo.insuranceClaim = 'yes';
        return "We work with all insurance companies and can help with that process. What's your first name for the appointment?";
      } else if (lower.includes('no') || lower.includes('not')) {
        this.customerInfo.insuranceClaim = 'no';
        return "No problem, we have great cash pricing too. What's your first name?";
      } else if (lower.includes('maybe') || lower.includes('not sure')) {
        this.customerInfo.insuranceClaim = 'maybe';
        return "We can help you figure that out during the inspection. What's your first name?";
      }
    }
    
    // Phase 8: CRITICAL - Better name capture
    if (!this.customerInfo.firstName && 
        (this.questionsAsked.insuranceClaim || this.questionsAsked.roofAge)) {
      // Look for common name patterns
      const namePatterns = [
        /my name is (\w+)/i,
        /i'm (\w+)/i,
        /i am (\w+)/i,
        /call me (\w+)/i,
        /it's (\w+)/i,
        /this is (\w+)/i,
        /^(\w+)$/i  // Just a single word (likely their name)
      ];
      
      let extractedName = null;
      for (const pattern of namePatterns) {
        const match = userMessage.match(pattern);
        if (match) {
          extractedName = match[1];
          break;
        }
      }
      
      // If no pattern matched, take the first word if it's capitalized
      if (!extractedName && userMessage.length < 20) {
        const firstWord = userMessage.trim().split(' ')[0];
        if (firstWord && firstWord[0] === firstWord[0].toUpperCase()) {
          extractedName = firstWord;
        }
      }
      
      if (extractedName) {
        this.customerInfo.firstName = extractedName;
        this.customerInfo.name = extractedName;
        this.discoveryPhase = 'scheduling';
        
        // Personalized response based on urgency
        if (this.customerInfo.urgency === 'emergency') {
          return `Thanks ${extractedName}! Let me get our emergency crew scheduled. We can have someone there today or tomorrow. Which works better?`;
        } else {
          return `Perfect, ${extractedName}! I can get someone out to take a look. What day works best - we have openings Thursday and Friday?`;
        }
      } else {
        // Couldn't extract name, ask more directly
        return "Sorry, I didn't catch that. What's your first name?";
      }
    }
    
    // Phase 9: Scheduling - Get the day
    if (this.discoveryPhase === 'scheduling' && !this.customerInfo.day) {
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'tomorrow'];
      const dayFound = days.find(day => lower.includes(day));
      
      if (dayFound) {
        this.customerInfo.day = dayFound.charAt(0).toUpperCase() + dayFound.slice(1);
        return `${this.customerInfo.day} works great! Do you prefer morning or afternoon?`;
      } else {
        return "What day works best for you this week?";
      }
    }
    
    // Phase 10: Get the time preference
    if (this.customerInfo.day && !this.customerInfo.time) {
      if (lower.includes('morning') || lower.includes('am')) {
        this.customerInfo.time = 'morning';
        this.customerInfo.readyToSchedule = true;
        return await this.confirmAndBook('morning');
      } else if (lower.includes('afternoon') || lower.includes('pm')) {
        this.customerInfo.time = 'afternoon';  
        this.customerInfo.readyToSchedule = true;
        return await this.confirmAndBook('afternoon');
      } else if (lower.includes('any') || lower.includes('either') || lower.includes('whenever')) {
        this.customerInfo.time = 'any time';
        this.customerInfo.readyToSchedule = true;
        return await this.confirmAndBook('any time');
      } else {
        return "Would morning or afternoon work better for you?";
      }
    }
    
    // Final confirmation or address collection
    if (this.customerInfo.readyToSchedule) {
      if (lower.includes('sounds good') || lower.includes('yes') || lower.includes('perfect') || 
          lower.includes('great') || lower.includes('ok')) {
        return "Excellent! You're all set. Our inspector will call you 30 minutes before arrival. Have a great day!";
      } else if (lower.includes('address')) {
        return "Sure! What's the property address?";
      } else if (lower.includes('no') || lower.includes('actually')) {
        return "No problem! What would work better for you?";
      } else {
        // Handle questions about time
        return "The inspector will call 30 minutes before arriving. Is there anything else you need to know?";
      }
    }
    
    // Fallback
    return null;
  }
  
  async confirmAndBook(timePreference) {
    try {
      // Try to book the appointment
      let bookingResult = null;
      
      if (isCalendarInitialized()) {
        console.log('📅 Calendar is ready, attempting to book...');
        
        const bookingDate = this.getNextDate(this.customerInfo.day);
        
        // Set time based on preference
        if (timePreference === 'morning') {
          bookingDate.setHours(9, 0, 0, 0);
        } else if (timePreference === 'afternoon') {
          bookingDate.setHours(14, 0, 0, 0);
        } else {
          bookingDate.setHours(10, 0, 0, 0); // Default to 10 AM
        }
        
        bookingResult = await autoBookAppointment(
          this.customerInfo.name || this.customerInfo.firstName,
          '', // No email captured in voice calls
          this.customerInfo.phone || '',
          bookingDate,
          {
            service: this.customerInfo.issue,
            propertyType: this.customerInfo.propertyType,
            urgency: this.customerInfo.urgency,
            roofAge: this.customerInfo.roofAge,
            insurance: this.customerInfo.insuranceClaim,
            source: 'Phone Call',
            company: this.config.companyName
          }
        );
        
        if (bookingResult.success) {
          console.log('✅ Appointment booked successfully!');
          return `Perfect ${this.customerInfo.firstName}! I've got you scheduled for ${this.customerInfo.day} ${timePreference}. Our inspector will call 30 minutes before arrival. The inspection is completely free with no obligation. Sound good?`;
        }
      }
      
      // Fallback if booking fails
      console.log('📅 Could not auto-book, will handle manually');
      return `Great ${this.customerInfo.firstName}! I'm putting you down for ${this.customerInfo.day} ${timePreference}. Our team will call you shortly to confirm the exact time. They'll also call 30 minutes before arrival. Sound good?`;
      
    } catch (error) {
      console.error('❌ Booking error:', error);
      return `Perfect ${this.customerInfo.firstName}! I've noted ${this.customerInfo.day} ${timePreference} for your appointment. Our team will call to confirm. Sound good?`;
    }
  }
  
  getNextDate(dayName) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = new Date();
    
    if (dayName.toLowerCase() === 'today') {
      return today;
    }
    
    if (dayName.toLowerCase() === 'tomorrow') {
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      return tomorrow;
    }
    
    const todayIndex = today.getDay();
    const targetIndex = days.indexOf(dayName.toLowerCase());
    
    if (targetIndex === -1) return today;
    
    let daysUntil = targetIndex - todayIndex;
    if (daysUntil <= 0) daysUntil += 7;
    
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntil);
    return targetDate;
  }
  
  async handleClose() {
    console.log('🔌 Call ended');
    console.log('📊 Discovery Summary:');
    console.log('  - Name:', this.customerInfo.firstName || 'Not captured');
    console.log('  - Issue:', this.customerInfo.issue || 'Not captured');
    console.log('  - Property:', this.customerInfo.propertyType || 'Not captured');
    console.log('  - Urgency:', this.customerInfo.urgency || 'Not captured');
    console.log('  - Roof Age:', this.customerInfo.roofAge || 'Not captured');
    console.log('  - Insurance:', this.customerInfo.insuranceClaim || 'Not captured');
    console.log('  - Scheduled:', this.customerInfo.day, this.customerInfo.time || 'Not scheduled');
    
    // Send webhook with all discovery data
    if (this.customerInfo.firstName || this.customerInfo.day) {
      await sendSchedulingPreference(
        this.customerInfo.name || this.customerInfo.firstName,
        '', // No email from voice calls
        this.customerInfo.phone || 'Unknown',
        this.customerInfo.day && this.customerInfo.time ? 
          `${this.customerInfo.day} ${this.customerInfo.time}` : 
          'Not scheduled',
        this.callId,
        {
          service: this.customerInfo.issue,
          propertyType: this.customerInfo.propertyType,
          urgency: this.customerInfo.urgency,
          roofAge: this.customerInfo.roofAge,
          insuranceClaim: this.customerInfo.insuranceClaim,
          company: this.config.companyName,
          callDuration: Date.now(),
          questionsCompleted: Object.values(this.questionsAsked).filter(v => v).length
        }
      );
    }
  }
}

module.exports = DynamicWebSocketHandler;
