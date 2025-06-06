// src/services/calendar/CalendarHelpers.js - Calendar Helper Functions
const GoogleCalendarService = require('./GoogleCalendarService');

// Initialize calendar service
let calendarService = null;
let calendarInitialized = false;

async function initializeCalendarService() {
  try {
    calendarService = new GoogleCalendarService();
    calendarInitialized = await calendarService.initialize();
    
    if (calendarInitialized) {
      console.log('✅ Google Calendar service ready');
    } else {
      console.log('⚠️ Google Calendar service disabled - using demo mode');
    }
    
    return calendarInitialized;
  } catch (error) {
    console.log('⚠️ Calendar initialization failed - using demo mode');
    calendarInitialized = false;
    return false;
  }
}

// Safe availability checking with fallback
async function checkAvailability(startTime, endTime) {
  try {
    console.log('🔍 Checking availability...');
    console.log('⏰ Start time:', startTime);
    console.log('⏰ End time:', endTime);
    
    if (!calendarInitialized || !calendarService?.isInitialized()) {
      console.log('⚠️ Calendar not available, using demo logic');
      // Demo logic: block some times for realism
      const hour = new Date(startTime).getHours();
      const isAvailable = ![13, 16].includes(hour); // Block 1 PM and 4 PM
      console.log(`📊 Demo availability: ${isAvailable ? 'Available' : 'Blocked'}`);
      return isAvailable;
    }
    
    const available = await calendarService.isSlotAvailable(startTime, endTime);
    console.log('📊 Calendar result:', available);
    return available;
  } catch (error) {
    console.error('❌ Error checking availability:', error.message);
    // Fallback to demo logic
    const hour = new Date(startTime).getHours();
    return ![13, 16].includes(hour);
  }
}

// Safe slot retrieval with fallback
async function getAvailableTimeSlots(date) {
  try {
    console.log('📅 Getting available slots for:', date);
    
    if (!calendarService) {
      console.error('❌ Calendar service not initialized');
      return [];
    }
    
    const availableSlots = await calendarService.getAvailableSlots(date);
    console.log(`📋 Retrieved ${availableSlots.length} slots`);
    
    if (availableSlots.length > 0) {
      console.log('📋 Available slots:');
      availableSlots.forEach((slot, index) => {
        console.log(`   ${index + 1}. ${slot.displayTime}`);
      });
    }
    
    return availableSlots;
  } catch (error) {
    console.error('❌ Error getting slots:', error.message);
    return [];
  }
}

// Safe formatted slots with no infinite recursion
async function getFormattedAvailableSlots(startDate = null, daysAhead = 7) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const searchStart = startDate ? new Date(startDate) : today;
    
    console.log(`📅 Getting formatted slots starting from: ${searchStart.toDateString()}`);
    
    const allAvailableSlots = [];
    
    for (let i = 0; i < daysAhead; i++) {
      const checkDate = new Date(searchStart);
      checkDate.setDate(searchStart.getDate() + i);
      
      // Skip past dates
      if (checkDate < today) {
        continue;
      }
      
      try {
        console.log(`🔍 Checking date: ${checkDate.toDateString()}`);
        const slots = await getAvailableTimeSlots(checkDate);
        
        if (slots.length > 0) {
          const dayName = checkDate.toLocaleDateString('en-US', { 
            weekday: 'long',
            month: 'long', 
            day: 'numeric'
          });
          
          // Filter business hour slots
          const businessHourSlots = slots.filter(slot => {
            const slotTime = new Date(slot.startTime);
            const hour = slotTime.getHours();
            return hour >= 9 && hour < 17;
          });
          
          if (businessHourSlots.length > 0) {
            allAvailableSlots.push({
              date: checkDate.toDateString(),
              dayName: dayName,
              slots: businessHourSlots.slice(0, 4),
              formattedSlots: businessHourSlots.slice(0, 4).map(slot => {
                const slotTime = new Date(slot.startTime);
                return slotTime.toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                  timeZone: 'America/Phoenix'
                });
              }).join(', ')
            });
            
            console.log(`✅ Added ${businessHourSlots.length} slots for ${dayName}`);
          }
        }
      } catch (dayError) {
        console.error(`❌ Error getting slots for ${checkDate.toDateString()}:`, dayError.message);
        // Continue to next day
      }
    }
    
    console.log(`✅ Found available slots across ${allAvailableSlots.length} days`);
    return allAvailableSlots;
    
  } catch (error) {
    console.error('❌ Error getting formatted slots:', error.message);
    return [];
  }
}

// Safe availability response with no loops
async function generateAvailabilityResponse() {
  try {
    console.log('🤖 Generating availability response...');
    
    const availableSlots = await getFormattedAvailableSlots();
    console.log(`📊 Got ${availableSlots.length} days with availability`);
    
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
    
    console.log(`✅ Generated response: ${response}`);
    return response;
    
  } catch (error) {
    console.error('❌ Error generating availability response:', error.message);
    return "Let me check my calendar and get back to you with some available times.";
  }
}

// Alternative time suggestions with no infinite loops
async function suggestAlternativeTime(preferredDate, userMessage) {
  try {
    console.log('🔍 Suggesting alternative times for:', preferredDate);
    
    const availableSlots = await getAvailableTimeSlots(preferredDate);
    
    if (availableSlots.length === 0) {
      // Try next day only
      const nextDay = new Date(preferredDate);
      nextDay.setDate(nextDay.getDate() + 1);
      
      try {
        const nextDaySlots = await getAvailableTimeSlots(nextDay);
        
        if (nextDaySlots.length > 0) {
          const nextDayName = nextDay.toLocaleDateString('en-US', { weekday: 'long' });
          return `I don't have any availability that day. How about ${nextDayName} at ${nextDaySlots[0].displayTime}?`;
        }
      } catch (nextDayError) {
        console.error('Error checking next day:', nextDayError.message);
      }
      
      return "I don't have availability that day. Let me check other days this week.";
    }
    
    if (availableSlots.length === 1) {
      return `I have ${availableSlots[0].displayTime} available that day. Does that work for you?`;
    } else if (availableSlots.length >= 2) {
      return `I have a few times available that day: ${availableSlots[0].displayTime} or ${availableSlots[1].displayTime}. Which would you prefer?`;
    }
    
    return "Let me check what times I have available.";
  } catch (error) {
    console.error('Error suggesting alternative time:', error.message);
    return "Let me check my calendar for available times.";
  }
}

// Enhanced scheduling preference detection
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
  
  // Monday to Friday (1-5), 9 AM to 5 PM
  return dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 9 && hour < 17;
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
  return calendarService;
}

function isCalendarInitialized() {
  return calendarInitialized;
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