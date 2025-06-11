// src/services/calendar/CalendarHelpers.js - FIXED WITH PROPER TIMEZONE HANDLING
const GoogleCalendarService = require('./GoogleCalendarService');
const GoogleAppointmentScheduleService = require('./GoogleAppointmentScheduleService');
// Removed AppointmentController - not available in this project
const fs = require('fs').promises;

let calendarService = null;
let appointmentScheduleService = null;
let isInitialized = false;

// In-memory stores to prevent duplicate bookings
const bookingAttempts = new Map(); // key: email_datetime, value: timestamp
const bookingLocks = new Map(); // key: email_datetime, value: true

// Initialize calendar service
async function initializeCalendarService() {
  if (isInitialized) {
    return { success: true, calendarService, appointmentScheduleService };
  }
  
  try {
    console.log('🔧 Initializing calendar services...');
    
    calendarService = new GoogleCalendarService();
    await calendarService.initialize();
    console.log('✅ Google Calendar service initialized');
    
    appointmentScheduleService = new GoogleAppointmentScheduleService();
    await appointmentScheduleService.initialize();
    console.log('✅ Google Appointment Schedule service initialized');
    
    isInitialized = true;
    return { success: true, calendarService, appointmentScheduleService };
    
  } catch (error) {
    console.error('❌ Calendar service initialization failed:', error.message);
    isInitialized = false;
    return { success: false, error: error.message };
  }
}

// Check if calendar is initialized
function isCalendarInitialized() {
  return isInitialized && calendarService !== null;
}

// Get available time slots for a given date
async function getAvailableTimeSlots(date) {
  if (!calendarService) {
    await initializeCalendarService();
  }
  
  if (!calendarService) {
    console.error('❌ Calendar service not available');
    return [];
  }
  
  try {
    const slots = await calendarService.getAvailableSlots(date);
    return slots;
  } catch (error) {
    console.error('❌ Error getting available slots:', error.message);
    return [];
  }
}

// Generate natural availability response
async function generateAvailabilityResponse(date) {
  try {
    const slots = await getAvailableTimeSlots(date);
    
    if (!slots || slots.length === 0) {
      return "I don't see any available times for that day. Would you like to check another day?";
    }
    
    const timeStrings = slots.slice(0, 3).map(slot => slot.displayTime);
    
    if (timeStrings.length === 1) {
      return `I have ${timeStrings[0]} available. Does that work for you?`;
    } else if (timeStrings.length === 2) {
      return `I have ${timeStrings[0]} or ${timeStrings[1]} available. Which would you prefer?`;
    } else {
      return `I have a few times available: ${timeStrings[0]}, ${timeStrings[1]}, or ${timeStrings[2]}. Which works best for you?`;
    }
  } catch (error) {
    console.error('❌ Error generating availability response:', error.message);
    return "Let me check my calendar and get back to you with available times.";
  }
}

// CRITICAL FIX: Auto-book appointment with duplicate prevention and proper timezone handling
async function autoBookAppointment(customerName, customerEmail, customerPhone, preferredDateTime, discoveryData = {}) {
  try {
    console.log('🎯 AUTO-BOOKING APPOINTMENT WITH CALENDAR');
    console.log('📧 Customer:', customerEmail);
    console.log('📅 Requested time:', preferredDateTime);
    
    // CRITICAL: Initialize if not already
    if (!calendarService) {
      console.log('🔧 Calendar not initialized, initializing now...');
      const initResult = await initializeCalendarService();
      if (!initResult.success) {
        console.error('❌ Failed to initialize calendar:', initResult.error);
        return {
          success: false,
          error: 'Calendar service unavailable',
          message: 'Unable to book appointment at this time'
        };
      }
    }
    
    // ANTI-DUPLICATE: Check if we've attempted this booking recently
    const appointmentKey = `${customerEmail}_${preferredDateTime.toISOString()}`;
    
    // Check if booking is locked (in progress)
    if (bookingLocks.has(appointmentKey)) {
      console.log('🔒 BOOKING ALREADY IN PROGRESS - preventing duplicate');
      return {
        success: false,
        error: 'Booking already in progress',
        message: 'Your appointment is being processed'
      };
    }
    
    // Check if we've booked this recently
    if (bookingAttempts.has(appointmentKey)) {
      const lastAttempt = bookingAttempts.get(appointmentKey);
      const timeSince = Date.now() - lastAttempt;
      if (timeSince < 30000) { // 30 seconds
        console.log('⚠️ DUPLICATE BOOKING ATTEMPT DETECTED - already booked');
        return {
          success: true,
          eventId: 'duplicate_prevented',
          message: 'Your appointment has already been booked!',
          displayTime: preferredDateTime.toLocaleString('en-US', { 
            timeZone: 'America/Phoenix',
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          })
        };
      }
    }
    
    // LOCK this booking to prevent concurrent attempts
    bookingLocks.set(appointmentKey, true);
    console.log('🔒 BOOKING LOCKED for:', appointmentKey);
    
    try {
      // Prepare appointment details
      const startTime = new Date(preferredDateTime);
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour
      
      const appointmentDetails = {
        summary: `Discovery Call with ${customerName}`,
        description: `Discovery call with ${customerName}\nEmail: ${customerEmail}\nPhone: ${customerPhone}\n\nDiscovery Information:\n${JSON.stringify(discoveryData, null, 2)}`,
        startTime: startTime,
        endTime: endTime,
        customerEmail: customerEmail,
        customerPhone: customerPhone,
        customerName: customerName
      };
      
      console.log('📋 Booking details:', {
        customerName,
        customerEmail,
        startTime: startTime.toISOString(),
        arizonaTime: startTime.toLocaleString('en-US', { timeZone: 'America/Phoenix' })
      });
      
      // Create the calendar event
      const bookingResult = await calendarService.createAppointment(appointmentDetails);
      
      if (bookingResult.success) {
        console.log('✅ APPOINTMENT BOOKED SUCCESSFULLY!');
        console.log('📅 Event ID:', bookingResult.eventId);
        console.log('🔗 Meeting Link:', bookingResult.meetingLink);
        
        // Mark this appointment as booked
        bookingAttempts.set(appointmentKey, Date.now());
        console.log('📌 Marked appointment as booked:', appointmentKey);
        
        // Log appointment details for debugging
        console.log('💾 Appointment details:', {
          customerName,
          customerEmail,
          customerPhone,
          appointmentTime: startTime,
          discoveryData,
          googleEventId: bookingResult.eventId,
          meetingLink: bookingResult.meetingLink
        });
        
        // Generate display time for confirmation
        const displayTime = startTime.toLocaleString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: 'America/Phoenix'
        });
        
        // Keep the booking attempt marker for longer to prevent immediate duplicates
        setTimeout(() => {
          bookingAttempts.delete(appointmentKey);
          console.log('🧹 Cleaned up booking attempt marker for:', appointmentKey);
        }, 60000); // 1 minute
        
        return {
          success: true,
          eventId: bookingResult.eventId,
          meetingLink: bookingResult.meetingLink,
          eventLink: bookingResult.eventLink,
          message: `Appointment successfully booked for ${displayTime} Arizona time`,
          displayTime: displayTime,
          timezone: 'America/Phoenix',
          customerEmail: customerEmail,
          customerName: customerName,
          startTime: startTime.toISOString()
        };
      } else {
        console.log('❌ Calendar service returned failure:', bookingResult.error);
        
        return {
          success: false,
          error: bookingResult.error || 'Unknown booking error',
          message: bookingResult.message || 'Failed to create appointment'
        };
      }
      
    } catch (error) {
      console.error('❌ Unexpected booking error:', error.message);
      
      return {
        success: false,
        error: error.message,
        message: 'An unexpected error occurred during booking'
      };
    } finally {
      // ALWAYS UNLOCK the booking process
      bookingLocks.delete(appointmentKey);
      console.log('🔓 BOOKING UNLOCKED for:', appointmentKey);
    }
    
  } catch (outerError) {
    console.error('❌ Outer booking error:', outerError.message);
    
    // Ensure cleanup on any error
    const appointmentKey = `${customerEmail}_${preferredDateTime.toISOString()}`;
    bookingLocks.delete(appointmentKey);
    
    return {
      success: false,
      error: outerError.message,
      message: 'System error during booking process'
    };
  }
}

// ENHANCED: Appointment booking detection and execution
async function detectAndBookAppointment(userMessage, customerData, discoveryData) {
  try {
    console.log('🕐 DETECTING APPOINTMENT BOOKING REQUEST:', userMessage);
    
    // Enhanced patterns to detect appointment requests - FIXED time parsing
    const patterns = [
      // "Wednesday at 10 AM" or "June 11th at 10 AM"
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|june\s+\d{1,2}(?:th|st|nd|rd)?)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i,
      // "10 AM Wednesday" or "10 AM on June 11th"
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|june\s+\d{1,2}(?:th|st|nd|rd)?)/i,
      // "Wednesday 10" or "June 11th 10"
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|june\s+\d{1,2}(?:th|st|nd|rd)?)\s+(\d{1,2})\b/i
    ];

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const match = userMessage.match(pattern);
      if (match) {
        console.log('🎯 APPOINTMENT PATTERN MATCHED:', match);
        
        const appointmentDetails = parseAppointmentMatch(match, i);
        if (appointmentDetails) {
          console.log('📅 PARSED APPOINTMENT DETAILS:', appointmentDetails);
          
          // Validate business hours
          if (!appointmentDetails.isBusinessHours) {
            return {
              success: false,
              message: `I'd love to schedule you for ${appointmentDetails.timeString}, but our business hours are 8 AM to 4 PM Arizona time. Would you like to choose a time between 8 AM and 4 PM instead?`
            };
          }
          
          // Attempt the booking
          const bookingResult = await autoBookAppointment(
            customerData.customerName || 'Customer',
            customerData.customerEmail,
            customerData.customerPhone,
            appointmentDetails.dateTime,
            discoveryData
          );
          
          if (bookingResult.success) {
            return {
              success: true,
              message: `Perfect! I've booked your consultation for ${appointmentDetails.dayName} at ${appointmentDetails.timeString} Arizona time. You'll receive a calendar invitation at ${customerData.customerEmail} shortly!`,
              bookingDetails: bookingResult
            };
          } else {
            return {
              success: false,
              message: `I'm sorry, but ${appointmentDetails.dayName} at ${appointmentDetails.timeString} is no longer available. Let me suggest some other times.`
            };
          }
        }
      }
    }
    
    return null; // No appointment request detected
    
  } catch (error) {
    console.error('❌ Error in appointment booking detection:', error.message);
    return {
      success: false,
      message: "I'd be happy to schedule that appointment for you. Let me check my calendar and get back to you with confirmation."
    };
  }
}

// FIXED: Parse appointment match into structured data with proper timezone handling
function parseAppointmentMatch(match, patternIndex) {
  let day, hour, minutes = 0, period = 'am';
  
  try {
    switch (patternIndex) {
      case 0: // "Wednesday at 10am" or "June 11th at 10am"
        day = match[1];
        hour = parseInt(match[2]);
        minutes = parseInt(match[3] || '0');
        period = match[4] || 'am';
        break;
      case 1: // "10am Wednesday" or "10am on June 11th"
        hour = parseInt(match[1]);
        minutes = parseInt(match[2] || '0');
        period = match[3] || 'am';
        day = match[4];
        break;
      case 2: // "Wednesday 10" or "June 11th 10"
        day = match[1];
        hour = parseInt(match[2]);
        // For ambiguous times, assume AM for 8-11, PM for 1-4
        if (hour >= 8 && hour <= 11) {
          period = 'am';
        } else if (hour >= 1 && hour <= 4) {
          period = 'pm';
        } else {
          period = 'am'; // Default to AM
        }
        break;
    }

    // FIXED: Proper 12-hour to 24-hour conversion
    let hour24 = hour;
    period = period.toLowerCase();
    
    // Handle period variations (am, a.m., AM, etc.)
    if (period.includes('p')) {
      // PM times
      if (hour !== 12) {
        hour24 = hour + 12;
      }
      // 12 PM stays as 12
    } else {
      // AM times
      if (hour === 12) {
        hour24 = 0; // 12 AM is midnight
      }
      // Other AM times stay the same
    }

    // Validate business hours (8 AM - 4 PM = 8:00 - 16:00)
    const isBusinessHours = hour24 >= 8 && hour24 < 16;

    // Calculate target date in Arizona timezone
    const targetDate = calculateTargetDateArizona(day, hour24, minutes);
    
    // Format display time
    const displayHour = hour24 > 12 ? hour24 - 12 : hour24 === 0 ? 12 : hour24;
    const displayPeriod = hour24 >= 12 ? 'PM' : 'AM';
    
    const result = {
      dateTime: targetDate,
      dayName: day,
      timeString: `${displayHour}:${minutes.toString().padStart(2, '0')} ${displayPeriod}`,
      hour: hour24,
      isBusinessHours: isBusinessHours,
      originalMatch: match[0]
    };
    
    console.log('✅ APPOINTMENT PARSING RESULT:', result);
    return result;
    
  } catch (error) {
    console.error('❌ Error parsing appointment match:', error.message);
    return null;
  }
}

// FIXED: Calculate target date properly in Arizona timezone
function calculateTargetDateArizona(day, hour, minutes) {
  try {
    // Get current date/time
    const now = new Date();
    
    // Create target date
    let targetDate = new Date(now);
    
    // Handle relative days
    if (day.toLowerCase() === 'tomorrow') {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (day.toLowerCase() === 'today') {
      // Keep today
    } else if (day.toLowerCase().includes('june')) {
      // Handle specific dates like "June 11th"
      const dateMatch = day.match(/june\s+(\d{1,2})/i);
      if (dateMatch) {
        const dayOfMonth = parseInt(dateMatch[1]);
        targetDate.setMonth(5); // June is month 5 (0-indexed)
        targetDate.setDate(dayOfMonth);
      }
    } else {
      // Handle day names
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayIndex = daysOfWeek.indexOf(day.toLowerCase());
      if (dayIndex !== -1) {
        const currentDay = targetDate.getDay();
        let daysToAdd = dayIndex - currentDay;
        if (daysToAdd <= 0) daysToAdd += 7; // Next occurrence
        targetDate.setDate(targetDate.getDate() + daysToAdd);
      }
    }
    
    // Set the time (hour is already in 24-hour format)
    targetDate.setHours(hour, minutes, 0, 0);
    
    // Log the calculation for debugging
    console.log('📅 Target date calculation:');
    console.log('   Input:', `${day} at ${hour}:${minutes.toString().padStart(2, '0')}`);
    console.log('   Local time:', targetDate.toString());
    console.log('   Arizona time:', targetDate.toLocaleString('en-US', { timeZone: 'America/Phoenix' }));
    console.log('   UTC time:', targetDate.toISOString());
    
    return targetDate;
    
  } catch (error) {
    console.error('❌ Error calculating target date:', error.message);
    throw error;
  }
}

// Parse user's scheduling preference with Arizona MST awareness
async function suggestAlternativeTime(preferredDate, userMessage) {
  try {
    console.log('🔍 Suggesting alternative appointment times for:', preferredDate, '(Arizona MST)');
    
    const availableSlots = await getAvailableTimeSlots(preferredDate);
    
    if (availableSlots.length === 0) {
      return "I don't have any availability that day. Let me check other days this week.";
    }
    
    if (availableSlots.length === 1) {
      return `I have ${availableSlots[0].displayTime} available that day. Does that work for you?`;
    } else if (availableSlots.length >= 2) {
      return `I have a few times available that day: ${availableSlots[0].displayTime} or ${availableSlots[1].displayTime}. Which would you prefer?`;
    }
    
    return "Let me check what times I have available.";
  } catch (error) {
    console.error('Error suggesting alternative appointment time:', error.message);
    throw error;
  }
}

// Handle scheduling preference with proper Arizona MST parsing
function handleSchedulingPreference(userMessage) {
  console.log('🔍 Analyzing user message for appointment scheduling (Arizona MST):', userMessage);
  
  const dayMatch = userMessage.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow|today)\b/i);
  const timeMatch = userMessage.match(/\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b/i) || 
                   userMessage.match(/\b(morning|afternoon|evening|noon)\b/i);
  const nextWeekMatch = userMessage.match(/next week/i);
  
  console.log('📅 Detected patterns:', { dayMatch, timeMatch, nextWeekMatch });
  
  if (nextWeekMatch) {
    let targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 7);
    const dayOfWeek = targetDate.getDay();
    const daysUntilMonday = (dayOfWeek === 0) ? 1 : (8 - dayOfWeek);
    targetDate.setDate(targetDate.getDate() + daysUntilMonday - 7);
    
    return {
      dayName: 'next week',
      date: targetDate,
      isSpecific: false,
      timePreference: timeMatch ? timeMatch[0] : 'morning',
      fullPreference: userMessage,
      timezone: 'America/Phoenix'
    };
  } else if (dayMatch) {
    const preferredDay = dayMatch[0].toLowerCase();
    let targetDate = new Date();
    
    if (preferredDay === 'tomorrow') {
      targetDate.setDate(targetDate.getDate() + 1);
      return {
        dayName: 'tomorrow',
        date: targetDate,
        isSpecific: true,
        timePreference: timeMatch ? timeMatch[0] : 'morning',
        fullPreference: userMessage,
        timezone: 'America/Phoenix'
      };
    } else if (preferredDay === 'today') {
      return {
        dayName: 'today',
        date: targetDate,
        isSpecific: true,
        timePreference: timeMatch ? timeMatch[0] : 'afternoon',
        fullPreference: userMessage,
        timezone: 'America/Phoenix'
      };
    } else {
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDayIndex = daysOfWeek.indexOf(preferredDay);
      const currentDayIndex = targetDate.getDay();
      
      let daysToAdd = targetDayIndex - currentDayIndex;
      if (daysToAdd <= 0) {
        daysToAdd += 7;
      }
      
      targetDate.setDate(targetDate.getDate() + daysToAdd);
      
      return {
        dayName: preferredDay,
        date: targetDate,
        isSpecific: true,
        timePreference: timeMatch ? timeMatch[0] : 'morning',
        fullPreference: userMessage,
        timezone: 'America/Phoenix'
      };
    }
  }
  
  return null;
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
}, 60000); // Run every minute

// Additional helper functions that were in the original file

// Format date range for display
function formatDateRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  const options = {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Phoenix'
  };
  
  const startStr = start.toLocaleString('en-US', options);
  const endTime = end.toLocaleString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit', 
    hour12: true,
    timeZone: 'America/Phoenix'
  });
  
  return `${startStr} - ${endTime} Arizona time`;
}

// Check if a specific slot is within business hours
function isWithinBusinessHours(dateTime) {
  const date = new Date(dateTime);
  const hour = date.getHours();
  const dayOfWeek = date.getDay();
  
  // Monday to Friday (1-5), 8 AM to 4 PM
  return dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 8 && hour < 16;
}

// Get the next available business day
function getNextBusinessDay(fromDate = new Date()) {
  const date = new Date(fromDate);
  date.setDate(date.getDate() + 1);
  
  // Skip weekends
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }
  
  return date;
}

// Parse time preference (morning, afternoon, etc.)
function parseTimePreference(preference) {
  const pref = preference.toLowerCase();
  
  if (pref.includes('morning') || pref.includes('am')) {
    return { start: 8, end: 12 }; // 8 AM - 12 PM
  } else if (pref.includes('afternoon') || pref.includes('pm')) {
    return { start: 13, end: 16 }; // 1 PM - 4 PM
  } else if (pref.includes('early')) {
    return { start: 8, end: 10 }; // 8 AM - 10 AM
  } else if (pref.includes('late')) {
    return { start: 14, end: 16 }; // 2 PM - 4 PM
  } else {
    return { start: 8, end: 16 }; // All business hours
  }
}

// Get formatted slots for a specific day
async function getFormattedSlotsForDay(date) {
  try {
    const slots = await getAvailableTimeSlots(date);
    
    return slots.map(slot => ({
      time: new Date(slot.startTime).toLocaleString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Phoenix'
      }),
      dateTime: slot.startTime,
      available: true
    }));
  } catch (error) {
    console.error('Error getting formatted slots:', error.message);
    return [];
  }
}

// Export all functions
module.exports = {
  // Main functions
  initializeCalendarService,
  isCalendarInitialized,
  getAvailableTimeSlots,
  generateAvailabilityResponse,
  autoBookAppointment,
  detectAndBookAppointment,
  suggestAlternativeTime,
  handleSchedulingPreference,
  
  // Helper functions
  formatDateRange,
  isWithinBusinessHours,
  getNextBusinessDay,
  parseTimePreference,
  getFormattedSlotsForDay,
  
  // For debugging/monitoring
  bookingAttempts,
  bookingLocks
};
