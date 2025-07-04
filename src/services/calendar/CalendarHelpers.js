// src/services/calendar/CalendarHelpers.js - SIMPLIFIED WITHOUT TIMEZONE CONVERSIONS
const GoogleCalendarService = require('./GoogleCalendarService');

// Initialize calendar service
let calendarService = null;
let calendarInitialized = false;

// Track booking attempts to prevent duplicates
const bookingAttempts = new Map();
const bookingLocks = new Set();

async function initializeCalendarService() {
  try {
    console.log('🔧 Initializing Google Calendar service...');
    calendarService = new GoogleCalendarService();
    calendarInitialized = await calendarService.initialize();
    
    if (calendarInitialized) {
      console.log('✅ Google Calendar service ready');
      const calendarInfo = calendarService.getCalendarInfo();
      console.log('📅 Calendar Info:', calendarInfo);
    } else {
      throw new Error('Calendar service failed to initialize');
    }
    
    return calendarInitialized;
  } catch (error) {
    console.error('❌ Calendar initialization failed:', error.message);
    throw error;
  }
}

// Check availability
async function checkAvailability(startTime, endTime) {
  try {
    console.log('🔍 Checking availability...');
    
    if (!calendarInitialized || !calendarService?.isInitialized()) {
      throw new Error('Calendar service not available');
    }
    
    const available = await calendarService.isSlotAvailable(startTime, endTime);
    console.log('📊 Slot available:', available);
    return available;
  } catch (error) {
    console.error('❌ Error checking availability:', error.message);
    throw error;
  }
}

// Get available time slots for a specific date
async function getAvailableTimeSlots(date) {
  try {
    console.log('📅 Getting available slots for:', date);
    
    if (!calendarService || !calendarInitialized) {
      throw new Error('Calendar service not initialized');
    }
    
    const availableSlots = await calendarService.getAvailableSlots(date);
    console.log(`✅ Found ${availableSlots.length} available slots`);
    return availableSlots;
    
  } catch (error) {
    console.error('❌ Error getting calendar slots:', error.message);
    throw error;
  }
}

// SIMPLIFIED: Auto-book appointment without timezone complexity
async function autoBookAppointment(customerName, customerEmail, customerPhone, preferredDateTime, discoveryData = {}) {
  try {
    console.log('📅 Starting appointment booking...');
    console.log('👤 Customer:', customerName, customerEmail);
    console.log('📅 Requested time:', preferredDateTime);
    
    // Validate inputs
    if (!customerEmail || customerEmail === 'prospect@example.com') {
      return {
        success: false,
        error: 'Invalid customer email',
        message: 'Valid email required for booking'
      };
    }

    if (!calendarInitialized || !calendarService?.isInitialized()) {
      return {
        success: false,
        error: 'Calendar service unavailable',
        message: 'Calendar system not initialized'
      };
    }

    // Create unique booking key
    const appointmentKey = `${customerEmail}_${preferredDateTime.toISOString()}`;
    const now = Date.now();
    
    // Check for recent attempts
    const lastAttempt = bookingAttempts.get(appointmentKey);
    if (lastAttempt && (now - lastAttempt) < 30000) {
      console.log('🚫 Duplicate booking blocked');
      return {
        success: false,
        error: 'Duplicate booking attempt',
        message: 'Booking already in progress'
      };
    }
    
    // Check if already being processed
    if (bookingLocks.has(appointmentKey)) {
      console.log('🚫 Booking already being processed');
      return {
        success: false,
        error: 'Booking in progress',
        message: 'This appointment is already being processed'
      };
    }
    
    // Lock this booking
    bookingLocks.add(appointmentKey);
    bookingAttempts.set(appointmentKey, now);
    
    try {
      const startTime = new Date(preferredDateTime);
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour

      // Check availability
      const isAvailable = await checkAvailability(startTime.toISOString(), endTime.toISOString());
      
      if (!isAvailable) {
        return {
          success: false,
          error: 'Slot unavailable',
          message: 'That time slot is no longer available'
        };
      }

      // Create appointment
      const appointmentDetails = {
        summary: 'Nexella AI Consultation Call',
        description: `Discovery call with ${customerName}\n\nCustomer Information:\nEmail: ${customerEmail}\nPhone: ${customerPhone}\n\nDiscovery Notes:\n${Object.entries(discoveryData).map(([key, value]) => `${key}: ${value}`).join('\n')}`,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        attendeeEmail: customerEmail,
        attendeeName: customerName,
        attendeePhone: customerPhone
      };

      console.log('📅 Creating calendar event...');
      
      const bookingResult = await calendarService.createEvent(appointmentDetails);

      if (bookingResult.success) {
        console.log('✅ APPOINTMENT BOOKED SUCCESSFULLY!');
        
        // Format display time
        const displayTime = startTime.toLocaleString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: 'America/Phoenix'
        });
        
        return {
          success: true,
          eventId: bookingResult.eventId,
          meetingLink: bookingResult.meetingLink,
          eventLink: bookingResult.eventLink,
          message: `Appointment booked for ${displayTime}`,
          displayTime: displayTime,
          timezone: 'America/Phoenix',
          customerEmail: customerEmail,
          customerName: customerName,
          startTime: startTime.toISOString()
        };
      } else {
        return {
          success: false,
          error: bookingResult.error || 'Booking failed',
          message: bookingResult.message || 'Failed to create appointment'
        };
      }
      
    } finally {
      // Always unlock
      bookingLocks.delete(appointmentKey);
      console.log('🔓 Booking unlocked');
    }
    
  } catch (error) {
    console.error('❌ Booking error:', error.message);
    return {
      success: false,
      error: error.message,
      message: 'System error during booking'
    };
  }
}

// Parse user's scheduling preference
function handleSchedulingPreference(userMessage) {
  console.log('🔍 Analyzing scheduling preference:', userMessage);
  
  const dayMatch = userMessage.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow|today)\b/i);
  const timeMatch = userMessage.match(/\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b/i) || 
                   userMessage.match(/\b(morning|afternoon|evening|noon)\b/i);
  
  if (dayMatch) {
    const preferredDay = dayMatch[0].toLowerCase();
    let targetDate = new Date();
    
    if (preferredDay === 'tomorrow') {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (preferredDay === 'today') {
      // Keep today
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
      }
    }
    
    return {
      dayName: preferredDay,
      date: targetDate,
      isSpecific: true,
      timePreference: timeMatch ? timeMatch[0] : 'morning',
      fullPreference: userMessage,
      timezone: 'America/Phoenix'
    };
  }
  
  return null;
}

// Calculate target date helper
function calculateTargetDate(day, hour, minutes) {
  const now = new Date();
  let targetDate = new Date(now);
  
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
  
  // Set the time
  targetDate.setHours(hour, minutes, 0, 0);
  
  console.log('📅 Target date:', targetDate.toString());
  
  return targetDate;
}

// Format date range
function formatDateRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (start.toDateString() === end.toDateString()) {
    return `${start.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric'
    })} from ${start.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true
    })} to ${end.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true
    })}`;
  } else {
    return `${start.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric'
    })} at ${start.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true
    })}`;
  }
}

// Check if business hours
function isBusinessHours(dateTime) {
  const date = new Date(dateTime);
  const dayOfWeek = date.getDay();
  const hour = date.getHours();
  
  // Monday to Friday, 8 AM to 4 PM
  return dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 8 && hour < 16;
}

// Get next business day
function getNextBusinessDay(fromDate = new Date()) {
  const date = new Date(fromDate);
  date.setDate(date.getDate() + 1);
  
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }
  
  return date;
}

// Getters
function getCalendarService() {
  return calendarService;
}

function isCalendarInitialized() {
  return calendarInitialized;
}

// Clean up old booking attempts periodically
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [key, timestamp] of bookingAttempts.entries()) {
    if (now - timestamp > 300000) { // 5 minutes
      bookingAttempts.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} old booking attempts`);
  }
}, 60000);

module.exports = {
  initializeCalendarService,
  checkAvailability,
  getAvailableTimeSlots,
  autoBookAppointment,
  handleSchedulingPreference,
  calculateTargetDate,
  formatDateRange,
  isBusinessHours,
  getNextBusinessDay,
  getCalendarService,
  isCalendarInitialized
};
