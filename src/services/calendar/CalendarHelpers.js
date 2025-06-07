// src/services/calendar/CalendarHelpers.js - COMPLETE FIXED VERSION
const GoogleAppointmentScheduleService = require('./GoogleAppointmentScheduleService');

// Initialize appointment schedule service
let appointmentScheduleService = null;
let scheduleInitialized = false;

async function initializeCalendarService() {
  try {
    appointmentScheduleService = new GoogleAppointmentScheduleService();
    scheduleInitialized = await appointmentScheduleService.initialize();
    
    if (scheduleInitialized) {
      console.log('✅ Google Appointment Schedule service ready - REAL schedule mode');
      const scheduleInfo = appointmentScheduleService.getScheduleInfo();
      console.log('📅 Schedule Info:', scheduleInfo);
    } else {
      console.error('❌ Google Appointment Schedule service failed to initialize');
      throw new Error('Appointment schedule initialization failed');
    }
    
    return scheduleInitialized;
  } catch (error) {
    console.error('❌ Appointment schedule initialization failed:', error.message);
    scheduleInitialized = false;
    throw error;
  }
}

// Safe availability checking - REAL APPOINTMENT SCHEDULE ONLY
async function checkAvailability(startTime, endTime) {
  try {
    console.log('🔍 Checking REAL appointment schedule availability...');
    console.log('⏰ Start time:', startTime);
    console.log('⏰ End time:', endTime);
    
    if (!scheduleInitialized || !appointmentScheduleService?.isInitialized()) {
      console.error('❌ Appointment schedule not available for availability check');
      throw new Error('Appointment schedule service not available');
    }
    
    const available = await appointmentScheduleService.isSlotAvailable(startTime, endTime);
    console.log('📊 REAL appointment schedule result:', available);
    return available;
  } catch (error) {
    console.error('❌ Error checking real appointment schedule availability:', error.message);
    throw error;
  }
}

// Safe slot retrieval - REAL APPOINTMENT SCHEDULE ONLY
async function getAvailableTimeSlots(date) {
  try {
    console.log('📅 Getting REAL appointment schedule slots for:', date);
    
    if (!appointmentScheduleService) {
      console.error('❌ No appointment schedule service initialized');
      throw new Error('Appointment schedule service not available');
    }
    
    if (!scheduleInitialized) {
      console.error('❌ Appointment schedule not properly initialized');
      throw new Error('Appointment schedule not initialized');
    }
    
    // Use REAL appointment schedule only
    const availableSlots = await appointmentScheduleService.getAvailableSlots(date);
    console.log(`📋 Retrieved ${availableSlots.length} REAL appointment schedule slots`);
    
    if (availableSlots.length === 0) {
      console.log('📅 No slots available on this date from real appointment schedule');
      return [];
    }
    
    // Log the actual times being returned
    availableSlots.forEach((slot, index) => {
      console.log(`   ${index + 1}. ${slot.displayTime} (${slot.startTime})`);
    });
    
    return availableSlots;
    
  } catch (error) {
    console.error('❌ Error getting real appointment schedule slots:', error.message);
    throw error;
  }
}

// Safe formatted slots - REAL APPOINTMENT SCHEDULE ONLY
async function getFormattedAvailableSlots(startDate = null, daysAhead = 7) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const searchStart = startDate ? new Date(startDate) : today;
    
    console.log(`📅 Getting REAL appointment schedule slots starting from: ${searchStart.toDateString()}`);
    
    if (!scheduleInitialized) {
      throw new Error('Appointment schedule not initialized - cannot get real availability');
    }
    
    const allAvailableSlots = [];
    
    for (let i = 0; i < daysAhead; i++) {
      const checkDate = new Date(searchStart);
      checkDate.setDate(searchStart.getDate() + i);
      
      // Skip past dates
      if (checkDate < today) {
        continue;
      }
      
      // Skip weekends (appointment schedules usually don't have weekend slots)
      const dayOfWeek = checkDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }
      
      try {
        console.log(`🔍 Checking REAL appointment schedule for date: ${checkDate.toDateString()}`);
        const slots = await getAvailableTimeSlots(checkDate);
        
        if (slots.length > 0) {
          const dayName = checkDate.toLocaleDateString('en-US', { 
            weekday: 'long',
            month: 'long', 
            day: 'numeric'
          });
          
          // Take first 4 slots
          const limitedSlots = slots.slice(0, 4);
          
          allAvailableSlots.push({
            date: checkDate.toDateString(),
            dayName: dayName,
            slots: limitedSlots,
            formattedSlots: limitedSlots.map(slot => slot.displayTime).join(', ')
          });
          
          console.log(`✅ Added ${limitedSlots.length} REAL appointment slots for ${dayName}: ${limitedSlots.map(s => s.displayTime).join(', ')}`);
        } else {
          console.log(`📅 No REAL appointment availability found for ${checkDate.toDateString()}`);
        }
      } catch (dayError) {
        console.error(`❌ Error getting REAL appointment slots for ${checkDate.toDateString()}:`, dayError.message);
        // Don't continue - if appointment schedule fails, we want to know
        throw dayError;
      }
    }
    
    console.log(`✅ Found REAL appointment schedule slots across ${allAvailableSlots.length} days`);
    return allAvailableSlots;
    
  } catch (error) {
    console.error('❌ Error getting REAL appointment schedule slots:', error.message);
    throw error;
  }
}

// Generate availability response - REAL APPOINTMENT SCHEDULE ONLY
async function generateAvailabilityResponse() {
  try {
    console.log('🤖 Generating availability response from REAL appointment schedule...');
    
    if (!scheduleInitialized) {
      throw new Error('Appointment schedule not initialized - cannot provide real availability');
    }
    
    const availableSlots = await getFormattedAvailableSlots();
    console.log(`📊 Got ${availableSlots.length} days with REAL appointment availability`);
    
    if (availableSlots.length === 0) {
      return "I don't have any availability in the next week. Let me check for times the following week.";
    }
    
    if (availableSlots.length === 1) {
      const day = availableSlots[0];
      return `I have availability on ${day.dayName} at ${day.formattedSlots}. Which time works best for you?`;
    }
    
    if (availableSlots.length === 2) {
      const day1 = availableSlots[0];
      const day2 = availableSlots[1];
      return `I have a few options available. On ${day1.dayName}, I have ${day1.formattedSlots}. Or on ${day2.dayName}, I have ${day2.formattedSlots}. What works better for you?`;
    }
    
    // 3 or more days available
    let response = "I have several times available this week. ";
    const daysToShow = availableSlots.slice(0, 3);
    
    daysToShow.forEach((day, index) => {
      if (index === 0) {
        response += `${day.dayName} at ${day.formattedSlots}`;
      } else if (index === daysToShow.length - 1) {
        response += `, or ${day.dayName} at ${day.formattedSlots}`;
      } else {
        response += `, ${day.dayName} at ${day.formattedSlots}`;
      }
    });
    response += ". Which day and time would work best for you?";
    
    console.log(`✅ Generated REAL appointment schedule availability response: ${response}`);
    return response;
    
  } catch (error) {
    console.error('❌ Error generating real appointment schedule availability response:', error.message);
    throw error;
  }
}

// Rest of the functions updated for appointment schedule
async function suggestAlternativeTime(preferredDate, userMessage) {
  try {
    console.log('🔍 Suggesting alternative times from appointment schedule for:', preferredDate);
    
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
    console.error('Error suggesting alternative time from appointment schedule:', error.message);
    return "Let me check my calendar for available times.";
  }
}

function handleSchedulingPreference(userMessage) {
  console.log('🔍 Analyzing user message for scheduling:', userMessage);
  
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
      fullPreference: userMessage
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
        fullPreference: userMessage
      };
    } else if (preferredDay === 'today') {
      return {
        dayName: 'today',
        date: targetDate,
        isSpecific: true,
        timePreference: timeMatch ? timeMatch[0] : 'afternoon',
        fullPreference: userMessage
      };
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
        
        return {
          dayName: preferredDay,
          date: targetDate,
          isSpecific: true,
          timePreference: timeMatch ? timeMatch[0] : 'morning',
          fullPreference: userMessage
        };
      }
    }
  }
  
  return null;
}

// Utility functions
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

function isBusinessHours(dateTime) {
  const date = new Date(dateTime);
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = date.getHours();
  
  // Monday to Friday (1-5), 8 AM to 5 PM
  return dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 8 && hour < 17;
}

function getNextBusinessDay(fromDate = new Date()) {
  const date = new Date(fromDate);
  date.setDate(date.getDate() + 1);
  
  while (date.getDay() === 0 || date.getDay() === 6) { // Skip weekends
    date.setDate(date.getDate() + 1);
  }
  
  return date;
}

// Getters
function getCalendarService() {
  return appointmentScheduleService;
}

function isCalendarInitialized() {
  return scheduleInitialized;
}

module.exports = {
  initializeCalendarService,
  checkAvailability,
  getAvailableTimeSlots,
  getFormattedAvailableSlots,
  generateAvailabilityResponse,
  suggestAlternativeTime,
  handleSchedulingPreference,
  formatDateRange,
  isBusinessHours,
  getNextBusinessDay,
  getCalendarService,
  isCalendarInitialized
};
