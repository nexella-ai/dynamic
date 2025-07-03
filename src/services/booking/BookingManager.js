// src/services/booking/BookingManager.js
const { 
  getAvailableTimeSlots, 
  autoBookAppointment 
} = require('../calendar/CalendarHelpers');
const TimezoneHandler = require('../timezone/TimezoneHandler');

class BookingManager {
  constructor(connectionData) {
    this.connectionData = connectionData;
    this.timezoneHandler = new TimezoneHandler();
    
    // Booking state
    this.bookingState = {
      userTimezone: null,
      timezoneConfirmed: false,
      selectedDay: null,
      selectedTime: null,
      offeredSlots: [],
      awaitingDaySelection: false,
      awaitingTimeSelection: false,
      awaitingTimezoneConfirmation: false,
      bookingInProgress: false,
      bookingCompleted: false
    };
    
    // Anti-duplicate booking
    this.lastBookingAttempt = 0;
    this.bookingCooldown = 5000; // 5 seconds
    
    // Initialize timezone from phone immediately
    this.initializeTimezoneFromPhone();
  }

  /**
   * Initialize timezone from phone number on construction
   */
  initializeTimezoneFromPhone() {
    if (this.connectionData.customerPhone && !this.bookingState.userTimezone) {
      const detectedTimezone = this.timezoneHandler.detectTimezoneFromPhone(
        this.connectionData.customerPhone
      );
      
      if (detectedTimezone) {
        this.bookingState.userTimezone = detectedTimezone;
        const timezoneName = this.timezoneHandler.getTimezoneName(detectedTimezone);
        console.log(`🌍 Auto-detected timezone: ${timezoneName} from phone ${this.connectionData.customerPhone}`);
      }
    }
  }

  /**
   * Process booking request
   */
  async processBookingRequest(userMessage) {
    // Prevent duplicate bookings
    const now = Date.now();
    if (now - this.lastBookingAttempt < this.bookingCooldown) {
      console.log('🚫 Booking cooldown active');
      return null;
    }
    
    // If awaiting timezone confirmation
    if (this.bookingState.awaitingTimezoneConfirmation) {
      return await this.handleTimezoneConfirmation(userMessage);
    }
    
    // Parse appointment from message (day + time)
    const appointmentMatch = this.parseAppointmentFromMessage(userMessage);
    if (appointmentMatch) {
      // Direct booking with timezone check
      return await this.handleDirectBooking(appointmentMatch);
    }
    
    // Parse day selection
    const dayMatch = this.parseDayFromMessage(userMessage);
    if (dayMatch && !this.bookingState.selectedDay) {
      return await this.handleDaySelection(dayMatch);
    }
    
    // Parse time selection
    if (this.bookingState.awaitingTimeSelection) {
      const timeMatch = this.parseTimeFromMessage(userMessage);
      if (timeMatch) {
        return await this.handleTimeSelection(timeMatch);
      }
    }
    
    // If no specific pattern matched but we're in booking phase
    if (!this.bookingState.selectedDay) {
      return "What day works best for you this week?";
    } else if (this.bookingState.awaitingTimeSelection) {
      return "What time works best for you?";
    }
    
    return null;
  }

  /**
   * Handle timezone confirmation
   */
  async handleTimezoneConfirmation(userMessage) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('yes') || lower.includes('correct') || lower.includes('right') || 
        lower.includes('yeah') || lower.includes('yep') || lower.includes('sounds good')) {
      this.bookingState.timezoneConfirmed = true;
      this.bookingState.awaitingTimezoneConfirmation = false;
      
      // Continue with the booking that was interrupted
      if (this.bookingState.pendingBooking) {
        return await this.completePendingBooking();
      }
      
      return "Great! What day works best for you this week?";
    } else if (lower.includes('no') || lower.includes('wrong') || lower.includes('different')) {
      this.bookingState.awaitingTimezoneConfirmation = false;
      return "What timezone are you in? I can adjust the times for you.";
    }
    
    // Check if they specified a different timezone
    const specifiedTimezone = this.timezoneHandler.parseTimezoneFromInput(userMessage);
    if (specifiedTimezone) {
      this.bookingState.userTimezone = specifiedTimezone;
      this.bookingState.timezoneConfirmed = true;
      this.bookingState.awaitingTimezoneConfirmation = false;
      const timezoneName = this.timezoneHandler.getTimezoneName(specifiedTimezone);
      
      // Continue with pending booking
      if (this.bookingState.pendingBooking) {
        return await this.completePendingBooking();
      }
      
      return `Got it! I'll show times in ${timezoneName}. What day works best?`;
    }
    
    // They didn't clearly confirm or deny
    return "Just to confirm - are you in " + this.timezoneHandler.getTimezoneName(this.bookingState.userTimezone) + "? (yes/no)";
  }

  /**
   * Parse day from user message
   */
  parseDayFromMessage(message) {
    const dayPattern = /\b(monday|tuesday|wednesday|thursday|friday|tomorrow|today)\b/i;
    const match = message.match(dayPattern);
    return match ? match[0].toLowerCase() : null;
  }

  /**
   * Parse time from user message
   */
  parseTimeFromMessage(message) {
    const patterns = [
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i,
      /\b(morning|afternoon)\b/i,
      /\b(\d{1,2})\s*o'?clock\b/i,
      /\b(ten|eleven|twelve|one|two|three|four|five|six|seven|eight|nine)\s*(am|pm)?\b/i
    ];
    
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        return this.normalizeTimeMatch(match);
      }
    }
    
    return null;
  }

  /**
   * Parse full appointment from message
   */
  parseAppointmentFromMessage(message) {
    const patterns = [
      /\b(monday|tuesday|wednesday|thursday|friday|tomorrow|today)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i,
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|tomorrow|today)\b/i,
      /\b(ten|eleven|twelve|one|two|three|four|five|six|seven|eight|nine)\s*(am|pm)?\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|tomorrow|today)\b/i
    ];
    
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        return this.parseFullAppointmentMatch(match);
      }
    }
    
    return null;
  }

  /**
   * Parse full appointment match
   */
  parseFullAppointmentMatch(match) {
    let day, hour, minutes = 0, period = null;
    
    const wordToNum = {
      'ten': 10, 'eleven': 11, 'twelve': 12,
      'one': 1, 'two': 2, 'three': 3, 'four': 4,
      'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9
    };
    
    // Determine format based on match
    if (match[0].match(/^\d/)) {
      // Starts with number
      hour = parseInt(match[1]);
      minutes = parseInt(match[2] || '0');
      period = match[3];
      day = match[4] || match[1];
    } else if (wordToNum[match[1]?.toLowerCase()]) {
      // Word number
      hour = wordToNum[match[1].toLowerCase()];
      period = match[2];
      day = match[3];
    } else {
      // Day first
      day = match[1];
      hour = wordToNum[match[2]?.toLowerCase()] || parseInt(match[2]);
      minutes = parseInt(match[3] || '0');
      period = match[4] || match[2];
    }
    
    // Normalize period
    if (period) {
      period = period.toLowerCase().replace(/[.\s]/g, '');
    }
    
    // Default AM/PM logic for business hours
    if (!period && hour >= 8 && hour <= 11) {
      period = 'am';
    } else if (!period && hour >= 1 && hour <= 5) {
      period = 'pm';
    }
    
    return {
      day: day?.toLowerCase(),
      hour: hour,
      minutes: minutes,
      period: period
    };
  }

  /**
   * Handle day selection
   */
  async handleDaySelection(day) {
    this.bookingState.selectedDay = day;
    this.bookingState.awaitingDaySelection = false;
    this.bookingState.awaitingTimeSelection = true;
    
    // Calculate target date
    const targetDate = this.calculateTargetDate(day);
    
    try {
      // Get available slots (these are in Arizona time from the calendar)
      const slotsInArizona = await getAvailableTimeSlots(targetDate);
      
      if (slotsInArizona.length === 0) {
        this.bookingState.selectedDay = null;
        return `I don't have any openings on ${day}. How about ${this.getNextAvailableDay()}?`;
      }
      
      // Store original Arizona slots
      this.bookingState.offeredSlots = slotsInArizona.slice(0, 3);
      
      // Convert slots to user's timezone if needed
      let displaySlots;
      if (this.bookingState.userTimezone && this.bookingState.userTimezone !== 'America/Phoenix') {
        displaySlots = this.convertSlotsToUserTimezone(this.bookingState.offeredSlots);
        const timezoneName = this.timezoneHandler.getTimezoneName(this.bookingState.userTimezone);
        
        // Format response with timezone info
        if (displaySlots.length === 1) {
          return `I have ${displaySlots[0].displayTime} ${timezoneName} available on ${day}. Does that work?`;
        } else if (displaySlots.length === 2) {
          return `On ${day}, I have ${displaySlots[0].displayTime} or ${displaySlots[1].displayTime} ${timezoneName}. Which works better?`;
        } else {
          return `I have ${displaySlots[0].displayTime}, ${displaySlots[1].displayTime}, or ${displaySlots[2].displayTime} ${timezoneName} on ${day}. What's best for you?`;
        }
      } else {
        // No timezone detected or same as Arizona
        displaySlots = this.bookingState.offeredSlots;
        
        if (displaySlots.length === 1) {
          return `I have ${displaySlots[0].displayTime} available on ${day}. Does that work?`;
        } else if (displaySlots.length === 2) {
          return `On ${day}, I have ${displaySlots[0].displayTime} or ${displaySlots[1].displayTime}. Which works better?`;
        } else {
          return `I have ${displaySlots[0].displayTime}, ${displaySlots[1].displayTime}, or ${displaySlots[2].displayTime} on ${day}. What's best for you?`;
        }
      }
      
    } catch (error) {
      console.error('Error getting slots:', error);
      return "Let me check my calendar... What time of day works best - morning or afternoon?";
    }
  }

  /**
   * Handle time selection
   */
  async handleTimeSelection(timeInfo) {
    if (!this.bookingState.selectedDay || this.bookingState.offeredSlots.length === 0) {
      return "What day did you want to meet?";
    }
    
    // Find matching slot
    const matchedSlot = this.findMatchingSlot(timeInfo);
    
    if (!matchedSlot) {
      return "I don't have that time available. Would any of the times I mentioned work?";
    }
    
    // Create appointment object
    const appointment = {
      dateTime: new Date(matchedSlot.startTime),
      dayName: this.bookingState.selectedDay,
      hour: new Date(matchedSlot.startTime).getHours(),
      slotInfo: matchedSlot
    };
    
    // Book the appointment
    return await this.bookAppointment(appointment);
  }

  /**
   * Handle direct booking (day + time)
   */
  async handleDirectBooking(appointmentInfo) {
    // Check if we have timezone, if not, need to confirm first
    if (!this.bookingState.userTimezone) {
      // Try to detect from phone
      this.initializeTimezoneFromPhone();
      
      if (!this.bookingState.userTimezone) {
        // Can't detect, need to ask
        this.bookingState.pendingBooking = appointmentInfo;
        return "What timezone are you in? I want to make sure I book the right time for you.";
      }
    }
    
    // If timezone not confirmed, confirm it first
    if (!this.bookingState.timezoneConfirmed && this.bookingState.userTimezone) {
      this.bookingState.pendingBooking = appointmentInfo;
      this.bookingState.awaitingTimezoneConfirmation = true;
      const timezoneName = this.timezoneHandler.getTimezoneName(this.bookingState.userTimezone);
      return `I see you're calling from ${timezoneName}. I'll book ${appointmentInfo.day} at ${appointmentInfo.hour}:${appointmentInfo.minutes.toString().padStart(2, '0')} ${appointmentInfo.period || ''} in your timezone. Is that correct?`;
    }
    
    // Process the booking
    return await this.processDirectBooking(appointmentInfo);
  }

  /**
   * Process direct booking with timezone conversion
   */
  async processDirectBooking(appointmentInfo) {
    // Calculate the date in user's timezone
    const targetDate = this.calculateTargetDate(appointmentInfo.day);
    
    // Convert hour to 24-hour format
    let hour24 = appointmentInfo.hour;
    if (appointmentInfo.period?.includes('p') && hour24 !== 12) {
      hour24 += 12;
    } else if (appointmentInfo.period?.includes('a') && hour24 === 12) {
      hour24 = 0;
    }
    
    // Set the time in the target date
    targetDate.setHours(hour24, appointmentInfo.minutes, 0, 0);
    
    // If user has different timezone, we need to convert to Arizona time
    let bookingDateInArizona = targetDate;
    if (this.bookingState.userTimezone && this.bookingState.userTimezone !== 'America/Phoenix') {
      // This is the user's local time, convert to Arizona time for booking
      bookingDateInArizona = this.timezoneHandler.convertToArizonaTime(
        targetDate, 
        this.bookingState.userTimezone
      );
      
      console.log(`🕐 User requested: ${targetDate.toLocaleString()} in ${this.bookingState.userTimezone}`);
      console.log(`🕐 Booking in Arizona: ${bookingDateInArizona.toLocaleString()} MST`);
    }
    
    // Check if it's within business hours (in Arizona time)
    const arizonaHour = bookingDateInArizona.getHours();
    if (arizonaHour < 8 || arizonaHour >= 16) {
      const userTimezoneName = this.timezoneHandler.getTimezoneName(this.bookingState.userTimezone);
      return `That time would be outside our business hours (8 AM - 4 PM Mountain Time). What other time works for you?`;
    }
    
    // Create appointment object with Arizona time for booking
    const appointment = {
      dateTime: bookingDateInArizona,
      dayName: appointmentInfo.day,
      hour: arizonaHour,
      userRequestedTime: targetDate,
      userTimezone: this.bookingState.userTimezone
    };
    
    return await this.bookAppointment(appointment);
  }

  /**
   * Complete pending booking after timezone confirmation
   */
  async completePendingBooking() {
    if (!this.bookingState.pendingBooking) {
      return "Great! What day and time work best for you?";
    }
    
    const pending = this.bookingState.pendingBooking;
    this.bookingState.pendingBooking = null;
    
    return await this.processDirectBooking(pending);
  }

  /**
   * Book the appointment with timezone confirmation
   */
  async bookAppointment(appointment) {
    // Prevent duplicate bookings
    if (this.bookingState.bookingInProgress || this.bookingState.bookingCompleted) {
      return "I'm already working on your booking!";
    }
    
    this.bookingState.bookingInProgress = true;
    this.lastBookingAttempt = Date.now();
    
    try {
      // Format confirmation message based on timezone
      let confirmMessage = "";
      
      if (this.bookingState.userTimezone && this.bookingState.userTimezone !== 'America/Phoenix') {
        // User has different timezone - show both times
        const userTimezoneName = this.timezoneHandler.getTimezoneName(this.bookingState.userTimezone);
        const userDateTime = appointment.userRequestedTime || 
          this.timezoneHandler.convertFromArizonaTime(appointment.dateTime, this.bookingState.userTimezone);
        
        const userTimeString = userDateTime.toLocaleString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: this.bookingState.userTimezone
        });
        
        const arizonaTimeString = appointment.dateTime.toLocaleString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: 'America/Phoenix'
        });
        
        confirmMessage = `Perfect! I'm booking your appointment for ${userTimeString} ${userTimezoneName} (that's ${arizonaTimeString} Mountain Time). You'll get a calendar invite at ${this.connectionData.customerEmail}!`;
      } else {
        // Same timezone or no timezone detected
        const displayTime = appointment.dateTime.toLocaleString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        confirmMessage = `Perfect! I'm booking your appointment for ${displayTime}. You'll get a calendar invite at ${this.connectionData.customerEmail}!`;
      }
      
      // Book in calendar (using Arizona time)
      const bookingResult = await autoBookAppointment(
        this.connectionData.customerName || `${this.connectionData.firstName} ${this.connectionData.lastName}`,
        this.connectionData.customerEmail,
        this.connectionData.customerPhone,
        appointment.dateTime, // This is already in Arizona time
        {
          timezone: this.bookingState.userTimezone || 'America/Phoenix',
          timezoneConfirmed: this.bookingState.timezoneConfirmed,
          company: this.connectionData.companyName,
          painPoint: this.connectionData.painPoint,
          userLocalTime: appointment.userRequestedTime?.toISOString()
        }
      );
      
      if (bookingResult.success) {
        this.bookingState.bookingCompleted = true;
        this.bookingState.bookingInProgress = false;
        
        // Add timezone confirmation to the message if different from Mountain Time
        if (this.bookingState.userTimezone && this.bookingState.userTimezone !== 'America/Phoenix') {
          const timezoneName = this.timezoneHandler.getTimezoneName(this.bookingState.userTimezone);
          return confirmMessage + ` Just to confirm - that's in your ${timezoneName} timezone.`;
        }
        
        return confirmMessage;
      } else {
        this.bookingState.bookingInProgress = false;
        return "That time just became unavailable. Let me show you other options.";
      }
      
    } catch (error) {
      console.error('Booking error:', error);
      this.bookingState.bookingInProgress = false;
      return "I had trouble booking that. Let me try another time - what else works?";
    }
  }

  /**
   * Convert slots to user's timezone
   */
  convertSlotsToUserTimezone(slots) {
    if (!this.bookingState.userTimezone || this.bookingState.userTimezone === 'America/Phoenix') {
      return slots;
    }
    
    return slots.map(slot => {
      // slot.startTime is in UTC format from the calendar
      const slotDateUTC = new Date(slot.startTime);
      
      // Convert to user's timezone for display
      const userTimeString = slotDateUTC.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: this.bookingState.userTimezone
      });
      
      return {
        ...slot,
        displayTime: userTimeString,
        originalDisplayTime: slot.displayTime, // Keep Arizona time for reference
        userTimezoneStart: slotDateUTC.toISOString()
      };
    });
  }

  /**
   * Find matching slot from offered times
   */
  findMatchingSlot(timeInfo) {
    if (!this.bookingState.offeredSlots || this.bookingState.offeredSlots.length === 0) {
      return null;
    }
    
    // Normalize the requested time
    let requestedHour = timeInfo.hour;
    if (timeInfo.period?.includes('p') && requestedHour !== 12) {
      requestedHour += 12;
    } else if (timeInfo.period?.includes('a') && requestedHour === 12) {
      requestedHour = 0;
    }
    
    // Check each offered slot
    for (const slot of this.bookingState.offeredSlots) {
      const slotDate = new Date(slot.startTime);
      
      // If user has different timezone, we need to check in their timezone
      if (this.bookingState.userTimezone && this.bookingState.userTimezone !== 'America/Phoenix') {
        const slotHourInUserTZ = parseInt(slotDate.toLocaleTimeString('en-US', {
          hour: 'numeric',
          hour12: false,
          timeZone: this.bookingState.userTimezone
        }));
        
        if (slotHourInUserTZ === requestedHour) {
          return slot;
        }
      } else {
        // Check in Arizona time
        const slotHour = slotDate.getHours();
        if (slotHour === requestedHour) {
          return slot;
        }
      }
    }
    
    return null;
  }

  /**
   * Calculate target date from day name
   */
  calculateTargetDate(day) {
    const today = new Date();
    let targetDate = new Date();
    
    if (day === 'today') {
      return targetDate;
    } else if (day === 'tomorrow') {
      targetDate.setDate(today.getDate() + 1);
      return targetDate;
    } else {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = days.indexOf(day);
      const currentDay = today.getDay();
      
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7;
      
      targetDate.setDate(today.getDate() + daysToAdd);
      return targetDate;
    }
  }

  /**
   * Get next available day
   */
  getNextAvailableDay() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6) {
      tomorrow.setDate(tomorrow.getDate() + 1);
    }
    
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[tomorrow.getDay()];
  }

  /**
   * Normalize time match
   */
  normalizeTimeMatch(match) {
    const fullMatch = match[0].toLowerCase();
    
    if (fullMatch.includes('morning')) {
      return { hour: 9, minutes: 0, period: 'am' };
    } else if (fullMatch.includes('afternoon')) {
      return { hour: 2, minutes: 0, period: 'pm' };
    }
    
    // Word to number conversion
    const wordToNum = {
      'ten': 10, 'eleven': 11, 'twelve': 12,
      'one': 1, 'two': 2, 'three': 3, 'four': 4,
      'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9
    };
    
    // Check if it's a word number
    for (const [word, num] of Object.entries(wordToNum)) {
      if (fullMatch.includes(word)) {
        return {
          hour: num,
          minutes: 0,
          period: match[2] || (num >= 8 && num <= 11 ? 'am' : 'pm')
        };
      }
    }
    
    return {
      hour: parseInt(match[1]),
      minutes: parseInt(match[2] || '0'),
      period: match[3] || null
    };
  }

  /**
   * Get booking state
   */
  getState() {
    return {
      hasTimezone: !!this.bookingState.userTimezone,
      timezoneConfirmed: this.bookingState.timezoneConfirmed,
      userTimezone: this.bookingState.userTimezone,
      userTimezoneName: this.bookingState.userTimezone ? 
        this.timezoneHandler.getTimezoneName(this.bookingState.userTimezone) : null,
      selectedDay: this.bookingState.selectedDay,
      awaitingTimeSelection: this.bookingState.awaitingTimeSelection,
      awaitingTimezoneConfirmation: this.bookingState.awaitingTimezoneConfirmation,
      bookingCompleted: this.bookingState.bookingCompleted
    };
  }
}

module.exports = BookingManager;
