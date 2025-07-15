// src/handlers/DynamicWebSocketHandler.js - ENHANCED WITH COMPLETE DISCOVERY FLOW
const configLoader = require('../services/config/ConfigurationLoader');
const { 
  autoBookAppointment, 
  isCalendarInitialized, 
  initializeCalendarService,
  getAvailableTimeSlots 
} = require('../services/calendar/CalendarHelpers');
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
      firstName: null,
      phone: this.extractPhoneFromHeaders(req),
      email: null,
      // Roofing specific info
      propertyType: null,
      roofAge: null,
      issue: null,
      urgency: null,
      // NEW DISCOVERY FIELDS
      roofType: null,
      ownershipStatus: null,
      insurancePlans: null,
      propertyAddress: null,
      bestPhone: null,
      // Scheduling
      day: null,
      specificTime: null,
      availableSlots: [],
      selectedSlot: null,
      bookingConfirmed: false,
      bookingDate: null
    };
    
    console.log(`📞 Caller phone number: ${this.customerInfo.phone || 'Unknown'}`);
    
    // Conversation state - Enhanced flow
    this.conversationPhase = 'waiting';
    this.hasGreeted = false;
    this.waitingForTimeSelection = false;
    
    // Response delay
    this.responseDelay = 1500;
    this.pendingResponseTimeout = null;
    
    // Initialize
    this.initialize();
  }
  
  extractPhoneFromHeaders(req) {
    // Try multiple sources to get the phone number
    const retellPhone = req.headers['x-retell-phone-number'] || 
                       req.headers['x-retell-caller-number'] ||
                       req.headers['x-retell-from-number'];
    if (retellPhone) {
      console.log('📱 Found phone in Retell headers:', retellPhone);
      return retellPhone;
    }
    
    const genericPhone = req.headers['x-customer-phone'] || 
                        req.headers['x-phone-number'] ||
                        req.headers['x-caller-id'] ||
                        req.headers['x-from-number'] ||
                        req.headers['from'];
    if (genericPhone) {
      console.log('📱 Found phone in generic headers:', genericPhone);
      return genericPhone;
    }
    
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const phoneParam = url.searchParams.get('phone') || 
                        url.searchParams.get('caller') ||
                        url.searchParams.get('from_number') ||
                        url.searchParams.get('customer_phone');
      if (phoneParam) {
        console.log('📱 Found phone in URL params:', phoneParam);
        return decodeURIComponent(phoneParam);
      }
    } catch (error) {
      // URL parsing failed
    }
    
    console.log('📱 No phone number found in headers or URL');
    console.log('Available headers:', Object.keys(req.headers));
    return null;
  }
  
  async initialize() {
    try {
      // Load config and init calendar in parallel
      const [configResult] = await Promise.all([
        configLoader.loadCompanyConfig(this.companyId),
        isCalendarInitialized() ? Promise.resolve() : initializeCalendarService()
      ]);
      
      this.config = configResult;
      console.log(`🏢 ${this.config.companyName} ready`);
      console.log(`📅 Calendar: ${isCalendarInitialized() ? '✅' : '❌'}`);
      
      // Set up message handler
      this.ws.on('message', async (data) => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.interaction_type === 'response_required') {
            const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
            console.log(`🗣️ User: ${userMessage}`);
            
            if (!this.hasGreeted && userMessage.toLowerCase().includes('hello')) {
              // Respond immediately to hello
              this.hasGreeted = true;
              this.conversationPhase = 'greeting';
              await this.sendResponse("Hey there! Mike from Half Price Roof. Thanks for calling - how's your day going?", parsed.response_id);
            } else {
              // Quick delay for other messages
              if (this.pendingResponseTimeout) clearTimeout(this.pendingResponseTimeout);
              this.pendingResponseTimeout = setTimeout(() => this.processMessage(parsed), this.responseDelay);
            }
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
  
  async processMessage(parsed) {
    const userMessage = parsed.transcript[parsed.transcript.length - 1]?.content || "";
    this.messageCount++;
    
    // Get response based on phase
    const response = await this.getResponse(userMessage);
    if (response) {
      await this.sendResponse(response, parsed.response_id);
    }
  }
  
  async sendResponse(content, responseId) {
    console.log(`🤖 Mike: ${content}`);
    
    this.ws.send(JSON.stringify({
      content: content,
      content_complete: true,
      actions: [],
      response_id: responseId
    }));
  }
  
  formatPhoneDisplay(phone) {
    // Format as (XXX) XXX-XXXX
    if (phone.length === 10) {
      return `(${phone.substring(0, 3)}) ${phone.substring(3, 6)}-${phone.substring(6)}`;
    }
    return phone;
  }
  
  async getResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    
    switch (this.conversationPhase) {
      case 'greeting':
        this.conversationPhase = 'need';
        if (lower.includes('good') || lower.includes('great') || lower.includes('fine') || lower.includes('ok')) {
          return "That's great to hear! So what's happening with your roof? Need a repair, replacement, or just want a free inspection?";
        } else if (lower.includes('not') || lower.includes('bad')) {
          return "Sorry to hear that. Well, let me help make your day better - what's going on with your roof?";
        } else {
          return "I'm doing great, thanks for asking! So what can I help you with today - any roofing issues?";
        }
        
      case 'need':
        if (lower.includes('replac')) {
          this.customerInfo.issue = 'replacement';
          this.conversationPhase = 'property';
          return "Full roof replacement - got it. Is this for your home or a commercial property?";
        } else if (lower.includes('leak')) {
          this.customerInfo.issue = 'leak';
          this.conversationPhase = 'property';
          return "Oh no, a leak! We'll get that fixed fast. Is this at your home?";
        } else if (lower.includes('inspect')) {
          this.customerInfo.issue = 'inspection';
          this.conversationPhase = 'property';
          return "Smart to get it checked! Is this for your home or business?";
        } else if (lower.includes('repair')) {
          this.customerInfo.issue = 'repair';
          this.conversationPhase = 'property';
          return "Roof repair - we can definitely help with that. Is this for a residential or commercial property?";
        } else {
          return "I can help with repairs, replacements, or free inspections. Which one do you need?";
        }
        
      case 'property':
        if (lower.includes('home') || lower.includes('house') || lower.includes('yes') || lower.includes('residential')) {
          this.customerInfo.propertyType = 'residential';
          this.conversationPhase = 'ownership_status';
          return "Perfect. Quick question - are you the homeowner, or are you a property manager?";
        } else if (lower.includes('business') || lower.includes('commercial')) {
          this.customerInfo.propertyType = 'commercial';
          this.conversationPhase = 'ownership_status';
          return "We handle lots of commercial properties. Are you the property owner or the property manager?";
        } else {
          return "Just to clarify - is this for a home or business property?";
        }
        
      case 'ownership_status':
        if (lower.includes('owner') || lower.includes('yes') || lower.includes('i am') || lower.includes('i own')) {
          this.customerInfo.ownershipStatus = 'owner';
          this.conversationPhase = 'roof_type';
          return "Great! What type of roof do you currently have - asphalt shingles, metal, tile, or something else?";
        } else if (lower.includes('manager') || lower.includes('property manager') || lower.includes('manage')) {
          this.customerInfo.ownershipStatus = 'property_manager';
          this.conversationPhase = 'roof_type';
          return "Got it, thanks for letting me know. What type of roof is on the property - shingles, metal, tile?";
        } else if (lower.includes('rent') || lower.includes('tenant')) {
          this.customerInfo.ownershipStatus = 'tenant';
          this.conversationPhase = 'roof_type';
          return "I see. Well, we can still take a look. Do you know what type of roof it is - asphalt shingles, metal, or tile?";
        } else {
          return "Are you the property owner, or do you manage the property?";
        }
        
      case 'roof_type':
        // Store whatever they say about roof type
        const roofTypes = {
          'shingle': 'asphalt shingles',
          'asphalt': 'asphalt shingles',
          'metal': 'metal',
          'tile': 'tile',
          'slate': 'slate',
          'flat': 'flat/membrane',
          'rubber': 'rubber/EPDM',
          'wood': 'wood shake'
        };
        
        let foundType = null;
        for (const [key, value] of Object.entries(roofTypes)) {
          if (lower.includes(key)) {
            foundType = value;
            break;
          }
        }
        
        if (foundType) {
          this.customerInfo.roofType = foundType;
        } else if (lower.includes("don't know") || lower.includes("not sure") || lower.includes("no idea")) {
          this.customerInfo.roofType = 'unknown';
        } else {
          this.customerInfo.roofType = userMessage; // Store whatever they said
        }
        
        this.conversationPhase = 'urgency';
        return "Thanks! Now, how urgent is this? Do you need someone out there right away, or are you planning ahead?";
        
      case 'urgency':
        if (lower.includes('urgent') || lower.includes('asap') || lower.includes('soon') || 
            lower.includes('emergency') || lower.includes('right away') || lower.includes('today')) {
          this.customerInfo.urgency = 'urgent';
          this.conversationPhase = 'insurance';
          
          if (this.customerInfo.issue === 'leak') {
            return "We'll definitely prioritize this. Quick question - are you planning to work with your insurance company on this leak repair?";
          } else {
            return "We'll get someone out there quickly. Are you planning to go through insurance for this?";
          }
        } else if (lower.includes('not') || lower.includes('planning') || lower.includes('whenever')) {
          this.customerInfo.urgency = 'planning';
          this.conversationPhase = 'insurance';
          return "Good to plan ahead! Are you thinking about using insurance for this project?";
        } else {
          this.customerInfo.urgency = 'soon';
          this.conversationPhase = 'insurance';
          return "Got it. Will you be working with your insurance company on this?";
        }
        
      case 'insurance':
        if (lower.includes('yes') || lower.includes('yeah') || lower.includes('yep') || lower.includes('insurance')) {
          this.customerInfo.insurancePlans = 'yes';
          this.conversationPhase = 'age';
          return "Perfect - we work with all the major insurance companies and can help with that process. About how old is your roof?";
        } else if (lower.includes('no') || lower.includes('nope') || lower.includes('cash') || lower.includes('out of pocket')) {
          this.customerInfo.insurancePlans = 'no';
          this.conversationPhase = 'age';
          return "No problem at all. About how old is your current roof?";
        } else if (lower.includes('maybe') || lower.includes('not sure') || lower.includes('depends')) {
          this.customerInfo.insurancePlans = 'maybe';
          this.conversationPhase = 'age';
          return "That's fine - we can discuss options when we come out. Do you know roughly how old your roof is?";
        } else {
          return "Will insurance be involved, or will this be out of pocket?";
        }
        
      case 'age':
        // Store whatever they say about age
        this.customerInfo.roofAge = userMessage;
        this.conversationPhase = 'name';
        return "Thanks for that info! Let me get you on the schedule. What's your first name?";
        
      case 'name':
        // Better name extraction
        let extractedName = null;
        
        // Check for "It's [Name]" pattern
        const itsPattern = /it'?s?\s+([A-Z][a-z]+)/i;
        const itsMatch = userMessage.match(itsPattern);
        if (itsMatch) {
          extractedName = itsMatch[1];
        } else {
          // Check other patterns
          const namePatterns = [
            /my name is\s+([A-Z][a-z]+)/i,
            /i'?m\s+([A-Z][a-z]+)/i,
            /this is\s+([A-Z][a-z]+)/i,
            /^([A-Z][a-z]+)$/  // Just the name
          ];
          
          for (const pattern of namePatterns) {
            const match = userMessage.match(pattern);
            if (match) {
              extractedName = match[1];
              break;
            }
          }
        }
        
        if (extractedName) {
          this.customerInfo.firstName = extractedName;
          this.customerInfo.name = extractedName;
          this.conversationPhase = 'phone_number';
          return `Nice to meet you, ${extractedName}! What's the best phone number to reach you at?`;
        } else {
          return "I didn't catch that - could you tell me your first name please?";
        }
        
      case 'phone_number':
        // Extract phone number
        const phonePattern = /[\d\s\-\(\)\.]+/g;
        const matches = userMessage.match(phonePattern);
        let phone = null;
        
        if (matches) {
          const combined = matches.join('');
          const digits = combined.replace(/\D/g, '');
          
          if (digits.length === 10) {
            phone = digits;
          } else if (digits.length === 11 && digits.startsWith('1')) {
            phone = digits.substring(1);
          }
        }
        
        if (phone) {
          this.customerInfo.bestPhone = `+1${phone}`;
          this.conversationPhase = 'address';
          return `Got it - ${this.formatPhoneDisplay(phone)}. And what's the address of the property we'll be looking at?`;
        } else {
          return "I didn't catch that phone number. Could you give me the 10-digit number including area code?";
        }
        
      case 'address':
        // Store the full address as given
        this.customerInfo.propertyAddress = userMessage.trim();
        this.conversationPhase = 'scheduling';
        
        if (this.customerInfo.urgency === 'urgent') {
          return `Perfect, ${this.customerInfo.firstName}! I've got all your information. Since this is urgent, I can get someone out to ${this.customerInfo.propertyAddress} today or tomorrow. Which works better?`;
        } else {
          return `Great, ${this.customerInfo.firstName}! I have all your details. Let me check our schedule for ${this.customerInfo.propertyAddress}. What day works best for you this week?`;
        }
        
      case 'scheduling':
        // Handle questions about time before choosing day
        if (lower.includes('what time') && !this.customerInfo.day) {
          this.customerInfo.day = 'Tomorrow';
          this.conversationPhase = 'time_selection';
          
          // Get available slots for tomorrow
          const targetDate = this.getNextDate('tomorrow');
          const slots = await getAvailableTimeSlots(targetDate);
          
          if (slots.length > 0) {
            this.customerInfo.availableSlots = slots;
            this.customerInfo.bookingDate = targetDate;
            this.waitingForTimeSelection = true;
            
            const morningSlots = slots.filter(s => s.displayTime.includes('AM'));
            const afternoonSlots = slots.filter(s => s.displayTime.includes('PM') && !s.displayTime.startsWith('12'));
            
            if (morningSlots.length && afternoonSlots.length) {
              return `For tomorrow I have ${morningSlots[0].displayTime} in the morning or ${afternoonSlots[0].displayTime} in the afternoon. Which works better for you?`;
            } else {
              const times = slots.slice(0, 3).map(s => s.displayTime).join(', ');
              return `Tomorrow I have these times available: ${times}. Which works best?`;
            }
          }
        }
        
        // Normal day selection
        const days = ['today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
        const dayFound = days.find(day => lower.includes(day));
        
        if (dayFound) {
          this.customerInfo.day = dayFound.charAt(0).toUpperCase() + dayFound.slice(1);
          this.conversationPhase = 'time_selection';
          
          // Get available slots
          const targetDate = this.getNextDate(dayFound);
          this.customerInfo.bookingDate = targetDate;
          
          console.log(`📅 Getting slots for ${dayFound}:`, targetDate.toISOString());
          const slots = await getAvailableTimeSlots(targetDate);
          
          if (slots.length > 0) {
            this.customerInfo.availableSlots = slots;
            this.waitingForTimeSelection = true;
            
            const morningSlots = slots.filter(s => s.displayTime.includes('AM'));
            const afternoonSlots = slots.filter(s => s.displayTime.includes('PM') && !s.displayTime.startsWith('12'));
            
            if (morningSlots.length && afternoonSlots.length) {
              return `Great! For ${this.customerInfo.day} I have ${morningSlots[0].displayTime} in the morning or ${afternoonSlots[0].displayTime} in the afternoon. Which works better for you?`;
            } else {
              const times = slots.slice(0, 3).map(s => s.displayTime).join(', ');
              return `For ${this.customerInfo.day} I have these times available: ${times}. Which time works best?`;
            }
          } else {
            this.customerInfo.day = null;
            this.customerInfo.bookingDate = null;
            return `I don't have any openings ${dayFound}. What about the next day?`;
          }
        } else {
          return "What day works best for you - today, tomorrow, or later this week?";
        }
        
      case 'time_selection':
        if (!this.waitingForTimeSelection || !this.customerInfo.availableSlots.length) return null;
        
        let selectedSlot = null;
        
        // Enhanced time matching
        const timePatterns = [
          { pattern: /\b(8|eight)\s*(am|a\.m\.|o'?clock)?\b/i, hour: 8 },
          { pattern: /\b(9|nine)\s*(am|a\.m\.|o'?clock)?\b/i, hour: 9 },
          { pattern: /\b(10|ten)\s*(am|a\.m\.|o'?clock)?\b/i, hour: 10 },
          { pattern: /\b(11|eleven)\s*(am|a\.m\.|o'?clock)?\b/i, hour: 11 },
          { pattern: /\b(12|twelve)\s*(pm|p\.m\.|noon)?\b/i, hour: 12 },
          { pattern: /\b(1|one)\s*(pm|p\.m\.|o'?clock)?\b/i, hour: 13 },
          { pattern: /\b(2|two)\s*(pm|p\.m\.|o'?clock)?\b/i, hour: 14 },
          { pattern: /\b(3|three)\s*(pm|p\.m\.|o'?clock)?\b/i, hour: 15 }
        ];
        
        // Try exact time matching
        for (const {pattern, hour} of timePatterns) {
          if (pattern.test(lower)) {
            selectedSlot = this.customerInfo.availableSlots.find(slot => {
              const slotHour = parseInt(slot.displayTime.split(':')[0]);
              const slotIsPM = slot.displayTime.includes('PM');
              const slotHour24 = slotIsPM && slotHour !== 12 ? slotHour + 12 : 
                               !slotIsPM && slotHour === 12 ? 0 : slotHour;
              
              return slotHour24 === hour || 
                     (hour >= 13 && slotHour === hour - 12 && slotIsPM);
            });
            
            if (selectedSlot) {
              console.log(`✅ Matched time pattern for hour ${hour}, found slot: ${selectedSlot.displayTime}`);
              break;
            }
          }
        }
        
        // If no exact match, check for morning/afternoon preference
        if (!selectedSlot) {
          if (lower.includes('morning') || lower.includes('first')) {
            selectedSlot = this.customerInfo.availableSlots.find(s => s.displayTime.includes('AM'));
          } else if (lower.includes('afternoon') || lower.includes('second')) {
            selectedSlot = this.customerInfo.availableSlots.find(s => 
              s.displayTime.includes('PM') && !s.displayTime.startsWith('12')
            );
          }
        }
        
        if (selectedSlot) {
          this.customerInfo.selectedSlot = selectedSlot;
          this.customerInfo.specificTime = selectedSlot.displayTime;
          this.waitingForTimeSelection = false;
          this.conversationPhase = 'booking';
          
          // Book the appointment NOW
          console.log(`📅 Booking appointment for ${this.customerInfo.day} at ${this.customerInfo.specificTime}`);
          const booked = await this.bookAppointment();
          
          if (booked) {
            this.customerInfo.bookingConfirmed = true;
            return `Perfect! I've got you all set for ${this.customerInfo.day} at ${this.customerInfo.specificTime} Arizona time. Our tech will come out to ${this.customerInfo.propertyAddress} and we'll call ${this.formatPhoneDisplay(this.customerInfo.bestPhone.substring(2))} about 30 minutes before arrival. Sound good?`;
          } else {
            return `Great! I've got you down for ${this.customerInfo.day} at ${this.customerInfo.specificTime} at ${this.customerInfo.propertyAddress}. Our office will confirm this shortly and we'll call ${this.formatPhoneDisplay(this.customerInfo.bestPhone.substring(2))} before we arrive. Sound good?`;
          }
        } else {
          const times = this.customerInfo.availableSlots.slice(0, 3).map(s => s.displayTime).join(', ');
          return `I have ${times} available. Which specific time works for you?`;
        }
        
      case 'booking':
        if (lower.includes('sounds good') || lower.includes('yes') || lower.includes('yep') || 
            lower.includes('perfect') || lower.includes('great') || lower.includes('ok') || 
            lower.includes('okay') || lower.includes('sure') || lower.includes('thank')) {
          return `Excellent! Just to confirm - we'll inspect your ${this.customerInfo.roofType === 'unknown' ? 'roof' : this.customerInfo.roofType} for ${this.customerInfo.issue === 'leak' ? 'leak repair' : this.customerInfo.issue}. ${this.customerInfo.insurancePlans === 'yes' ? "We'll also help document everything for your insurance claim." : ""} Have a great rest of your day!`;
        } else if (lower.includes('how long')) {
          return "The inspection usually takes about 45 minutes to an hour, depending on the size of your roof. Our tech will go over everything with you when they're done.";
        } else if (lower.includes('cost') || lower.includes('price') || lower.includes('how much')) {
          return "The inspection is completely free! If we find any issues, we'll give you a detailed quote with multiple options. And if you're going through insurance, we'll help with that whole process.";
        } else if (lower.includes('no') || lower.includes('cancel')) {
          this.conversationPhase = 'scheduling';
          this.customerInfo.day = null;
          this.customerInfo.selectedSlot = null;
          this.customerInfo.bookingDate = null;
          return "No problem! What day would work better for you?";
        } else {
          return "Is there anything else you'd like to know about the appointment?";
        }
        
      default:
        return null;
    }
  }
  
  async bookAppointment() {
    try {
      if (!isCalendarInitialized() || !this.customerInfo.selectedSlot) {
        console.log('❌ Cannot book: Calendar not ready or no slot selected');
        return false;
      }
      
      const bookingDate = new Date(this.customerInfo.selectedSlot.startTime);
      
      // Generate a placeholder email
      const placeholderEmail = `${this.customerInfo.firstName.toLowerCase()}.${this.callId}@halfpriceroof.com`;
      
      // Debug logging
      console.log('🔍 BOOKING DEBUG:');
      console.log('  - Selected slot:', this.customerInfo.selectedSlot);
      console.log('  - Display time:', this.customerInfo.selectedSlot.displayTime);
      console.log('  - Start time (ISO):', this.customerInfo.selectedSlot.startTime);
      console.log('  - Booking date:', bookingDate.toString());
      console.log('  - Arizona time:', bookingDate.toLocaleString('en-US', { 
        timeZone: 'America/Phoenix',
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }));
      console.log('  - Customer requested:', `${this.customerInfo.day} at ${this.customerInfo.specificTime}`);
      
      const result = await autoBookAppointment(
        this.customerInfo.name,
        placeholderEmail,
        this.customerInfo.bestPhone || this.customerInfo.phone || 'No phone provided',
        bookingDate,
        {
          // All discovery data
          service: this.customerInfo.issue,
          propertyType: this.customerInfo.propertyType,
          urgency: this.customerInfo.urgency,
          roofAge: this.customerInfo.roofAge,
          roofType: this.customerInfo.roofType,
          ownershipStatus: this.customerInfo.ownershipStatus,
          insurancePlans: this.customerInfo.insurancePlans,
          propertyAddress: this.customerInfo.propertyAddress,
          bestPhone: this.customerInfo.bestPhone,
          // Company and booking info
          company: this.config.companyName,
          bookedTime: this.customerInfo.specificTime,
          bookedDay: this.customerInfo.day,
          callId: this.callId,
          callerPhone: this.customerInfo.phone,
          requestedTimeArizona: this.customerInfo.specificTime,
          slotStartTime: this.customerInfo.selectedSlot.startTime
        }
      );
      
      console.log('📅 Booking result:', result.success ? '✅ SUCCESS' : '❌ FAILED');
      if (!result.success) {
        console.log('📅 Booking error:', result.error);
        console.log('📅 Booking message:', result.message);
      } else {
        console.log('📅 Event created successfully!');
        console.log('📅 Event ID:', result.eventId);
        console.log('📅 Display time:', result.displayTime);
      }
      
      return result.success;
    } catch (error) {
      console.error('❌ Booking exception:', error);
      return false;
    }
  }
  
  getNextDate(dayName) {
    const today = new Date();
    
    if (dayName === 'today') {
      return today;
    }
    
    if (dayName === 'tomorrow') {
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      return tomorrow;
    }
    
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayIndex = today.getDay();
    const targetIndex = days.indexOf(dayName);
    
    if (targetIndex === -1) return today;
    
    let daysUntil = targetIndex - todayIndex;
    if (daysUntil <= 0) daysUntil += 7;
    
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntil);
    return targetDate;
  }
  
  async handleClose() {
    console.log('🔌 Call ended');
    console.log(`📊 Summary:`);
    console.log(`  - Customer: ${this.customerInfo.firstName || 'Unknown'}`);
    console.log(`  - Phone: ${this.customerInfo.bestPhone || this.customerInfo.phone || 'Not captured'}`);
    console.log(`  - Issue: ${this.customerInfo.issue || 'Not specified'}`);
    console.log(`  - Property: ${this.customerInfo.propertyAddress || 'Not captured'}`);
    console.log(`  - Roof Type: ${this.customerInfo.roofType || 'Not specified'}`);
    console.log(`  - Owner Status: ${this.customerInfo.ownershipStatus || 'Not specified'}`);
    console.log(`  - Insurance: ${this.customerInfo.insurancePlans || 'Not specified'}`);
    console.log(`  - Scheduled: ${this.customerInfo.day || 'Not scheduled'} at ${this.customerInfo.specificTime || 'No time'}`);
    console.log(`  - Booked: ${this.customerInfo.bookingConfirmed ? '✅' : '❌'}`);
    
    if (this.customerInfo.firstName && this.customerInfo.issue) {
      // Generate placeholder email for webhook
      const placeholderEmail = this.customerInfo.bookingConfirmed ? 
        `${this.customerInfo.firstName.toLowerCase()}.${this.callId}@halfpriceroof.com` : '';
      
      // Prepare scheduling info
      let schedulingInfo = 'Not scheduled';
      if (this.customerInfo.day && this.customerInfo.specificTime) {
        schedulingInfo = `${this.customerInfo.day} at ${this.customerInfo.specificTime}`;
      }
      
      await sendSchedulingPreference(
        this.customerInfo.name || this.customerInfo.firstName,
        placeholderEmail,
        this.customerInfo.bestPhone || this.customerInfo.phone || 'Unknown',
        schedulingInfo,
        this.callId,
        {
          // All discovery data
          service: this.customerInfo.issue,
          propertyType: this.customerInfo.propertyType,
          urgency: this.customerInfo.urgency,
          roofAge: this.customerInfo.roofAge,
          roofType: this.customerInfo.roofType,
          ownershipStatus: this.customerInfo.ownershipStatus,
          insurancePlans: this.customerInfo.insurancePlans,
          propertyAddress: this.customerInfo.propertyAddress,
          bestPhone: this.customerInfo.bestPhone,
          // Company and booking info
          company: this.config.companyName,
          specificTime: this.customerInfo.specificTime,
          day: this.customerInfo.day,
          calendarBooked: this.customerInfo.bookingConfirmed,
          callerPhone: this.customerInfo.phone,
          bookingDate: this.customerInfo.bookingDate?.toISOString(),
          selectedSlotStartTime: this.customerInfo.selectedSlot?.startTime
        }
      );
      
      console.log('✅ Webhook sent with complete discovery data');
    }
  }
}

module.exports = DynamicWebSocketHandler;
