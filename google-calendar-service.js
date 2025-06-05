// google-calendar-service.js - Enhanced with better debugging and error handling
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');

class GoogleCalendarService {
  constructor() {
    this.calendar = null;
    this.auth = null;
    this.initialized = false;
    this.init();
  }

  async init() {
    try {
      console.log('🔧 Initializing Google Calendar service...');
      
      // Check if we have the required environment variables
      const requiredVars = [
        'GOOGLE_PROJECT_ID',
        'GOOGLE_PRIVATE_KEY',
        'GOOGLE_CLIENT_EMAIL',
        'GOOGLE_CALENDAR_ID'
      ];
      
      const missingVars = requiredVars.filter(varName => !process.env[varName]);
      if (missingVars.length > 0) {
        console.error('❌ Missing required environment variables:', missingVars);
        console.warn('⚠️ Google Calendar features will be disabled');
        return;
      }

      // Create JWT auth with better error handling
      this.auth = new google.auth.GoogleAuth({
        credentials: {
          type: 'service_account',
          project_id: process.env.GOOGLE_PROJECT_ID,
          private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
          private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          client_id: process.env.GOOGLE_CLIENT_ID,
          auth_uri: 'https://accounts.google.com/o/oauth2/auth',
          token_uri: 'https://oauth2.googleapis.com/token',
          auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs'
        },
        scopes: ['https://www.googleapis.com/auth/calendar']
      });

      this.calendar = google.calendar({ version: 'v3', auth: this.auth });
      
      // Test the connection
      await this.testConnection();
      
      this.initialized = true;
      console.log('✅ Google Calendar service initialized successfully');
    } catch (error) {
      console.error('❌ Error initializing Google Calendar service:', error.message);
      console.error('Full error:', error);
      this.initialized = false;
    }
  }

  async testConnection() {
    try {
      console.log('🧪 Testing Google Calendar connection...');
      const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
      
      // Try to get calendar info
      const calendarInfo = await this.calendar.calendars.get({
        calendarId: calendarId
      });
      
      console.log('✅ Calendar connection test successful');
      console.log('📅 Calendar name:', calendarInfo.data.summary);
      console.log('📧 Calendar ID:', calendarId);
      
      return true;
    } catch (error) {
      console.error('❌ Calendar connection test failed:', error.message);
      if (error.code === 403) {
        console.error('🔒 Access denied. Make sure:');
        console.error('   1. The service account has access to the calendar');
        console.error('   2. The calendar is shared with the service account email');
        console.error('   3. The service account has "Make changes to events" permission');
      }
      throw error;
    }
  }

  // FIXED: Enhanced availability checking with detailed logging
  async isSlotAvailable(startTime, endTime) {
    if (!this.initialized) {
      console.warn('⚠️ Google Calendar service not initialized - returning false');
      return false;
    }

    try {
      console.log(`🔍 Checking availability for slot: ${startTime} to ${endTime}`);
      const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
      
      // Convert to Date objects for easier comparison
      const requestStart = new Date(startTime);
      const requestEnd = new Date(endTime);
      
      console.log('📅 Converted times:', {
        requestStart: requestStart.toISOString(),
        requestEnd: requestEnd.toISOString(),
        requestStartLocal: requestStart.toLocaleString(),
        requestEndLocal: requestEnd.toLocaleString()
      });
      
      // Use both freebusy and events list for double-checking
      const [freebusyResponse, eventsResponse] = await Promise.all([
        this.calendar.freebusy.query({
          resource: {
            timeMin: startTime,
            timeMax: endTime,
            timeZone: 'America/Los_Angeles',
            items: [{ id: calendarId }]
          }
        }),
        this.calendar.events.list({
          calendarId: calendarId,
          timeMin: startTime,
          timeMax: endTime,
          singleEvents: true,
          orderBy: 'startTime'
        })
      ]);

      console.log('📊 Freebusy response:', JSON.stringify(freebusyResponse.data, null, 2));
      console.log('📊 Events response:', JSON.stringify(eventsResponse.data.items, null, 2));

      const busyTimes = freebusyResponse.data.calendars[calendarId]?.busy || [];
      const existingEvents = eventsResponse.data.items || [];
      
      // Check freebusy conflicts
      const freebusyConflict = busyTimes.length > 0;
      console.log(`⏰ Freebusy conflicts: ${freebusyConflict}`, busyTimes);
      
      // Check events conflicts with detailed logging
      let eventsConflict = false;
      existingEvents.forEach(event => {
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const eventEnd = new Date(event.end.dateTime || event.end.date);
        
        console.log(`📅 Checking event: "${event.summary}"`, {
          eventStart: eventStart.toISOString(),
          eventEnd: eventEnd.toISOString(),
          eventStartLocal: eventStart.toLocaleString(),
          eventEndLocal: eventEnd.toLocaleString()
        });
        
        // Check for time overlap: events overlap if start < otherEnd && end > otherStart
        const hasOverlap = requestStart < eventEnd && requestEnd > eventStart;
        
        if (hasOverlap) {
          console.log(`❌ CONFLICT DETECTED with event: "${event.summary}"`);
          console.log(`   Requested: ${requestStart.toLocaleString()} - ${requestEnd.toLocaleString()}`);
          console.log(`   Existing:  ${eventStart.toLocaleString()} - ${eventEnd.toLocaleString()}`);
          eventsConflict = true;
        } else {
          console.log(`✅ No conflict with event: "${event.summary}"`);
        }
      });
      
      const isAvailable = !freebusyConflict && !eventsConflict;
      
      console.log(`📅 AVAILABILITY RESULT for ${requestStart.toLocaleString()}-${requestEnd.toLocaleString()}:`);
      console.log(`   Freebusy conflict: ${freebusyConflict}`);
      console.log(`   Events conflict: ${eventsConflict}`);
      console.log(`   FINAL RESULT: ${isAvailable ? 'AVAILABLE' : 'NOT AVAILABLE'}`);
      
      return isAvailable;
    } catch (error) {
      console.error('❌ Error checking slot availability:', error.message);
      console.error('Full error:', error);
      return false;
    }
  }

  // FIXED: Enhanced method to get available slots with better conflict detection
  async getAvailableSlots(date, duration = 60) {
    if (!this.initialized) {
      console.warn('⚠️ Google Calendar service not initialized - returning empty array');
      return [];
    }

    try {
      console.log(`🔍 Getting available slots for ${date} (${duration} min duration)`);
      
      const targetDate = new Date(date);
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(9, 0, 0, 0); // 9 AM start
      
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(17, 0, 0, 0); // 5 PM end

      console.log(`📅 Checking availability from ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);

      const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

      // Get existing events for the day using both methods for accuracy
      const [eventsResponse, freebusyResponse] = await Promise.all([
        this.calendar.events.list({
          calendarId: calendarId,
          timeMin: startOfDay.toISOString(),
          timeMax: endOfDay.toISOString(),
          singleEvents: true,
          orderBy: 'startTime'
        }),
        this.calendar.freebusy.query({
          resource: {
            timeMin: startOfDay.toISOString(),
            timeMax: endOfDay.toISOString(),
            timeZone: 'America/Los_Angeles',
            items: [{ id: calendarId }]
          }
        })
      ]);

      const existingEvents = eventsResponse.data.items || [];
      const busyTimes = freebusyResponse.data.calendars[calendarId]?.busy || [];
      
      console.log(`📋 Found ${existingEvents.length} existing events`);
      console.log(`⏰ Found ${busyTimes.length} busy time blocks`);
      
      if (existingEvents.length > 0) {
        console.log('📅 Existing events:');
        existingEvents.forEach(event => {
          const start = new Date(event.start.dateTime || event.start.date);
          const end = new Date(event.end.dateTime || event.end.date);
          console.log(`   - "${event.summary}": ${start.toLocaleString()} to ${end.toLocaleString()}`);
        });
      }

      if (busyTimes.length > 0) {
        console.log('⏰ Busy times:');
        busyTimes.forEach(busy => {
          const start = new Date(busy.start);
          const end = new Date(busy.end);
          console.log(`   - ${start.toLocaleString()} to ${end.toLocaleString()}`);
        });
      }

      // Generate potential time slots (every 30 minutes from 9 AM to 5 PM)
      const availableSlots = [];
      const slotDuration = duration * 60 * 1000; // Convert minutes to milliseconds
      const current = new Date(startOfDay);

      while (current < endOfDay) {
        const slotEnd = new Date(current.getTime() + slotDuration);
        
        // Don't go past business hours
        if (slotEnd > endOfDay) {
          break;
        }
        
        console.log(`🕐 Testing slot: ${current.toLocaleString()} - ${slotEnd.toLocaleString()}`);
        
        // Check conflicts with both events and busy times
        const hasEventConflict = existingEvents.some(event => {
          const eventStart = new Date(event.start.dateTime || event.start.date);
          const eventEnd = new Date(event.end.dateTime || event.end.date);
          const overlap = current < eventEnd && slotEnd > eventStart;
          
          if (overlap) {
            console.log(`   ❌ Conflicts with event: "${event.summary}" (${eventStart.toLocaleString()} - ${eventEnd.toLocaleString()})`);
          }
          return overlap;
        });

        const hasBusyConflict = busyTimes.some(busy => {
          const busyStart = new Date(busy.start);
          const busyEnd = new Date(busy.end);
          const overlap = current < busyEnd && slotEnd > busyStart;
          
          if (overlap) {
            console.log(`   ❌ Conflicts with busy time: ${busyStart.toLocaleString()} - ${busyEnd.toLocaleString()}`);
          }
          return overlap;
        });

        const hasConflict = hasEventConflict || hasBusyConflict;

        if (!hasConflict) {
          console.log(`   ✅ Slot is available`);
          availableSlots.push({
            startTime: current.toISOString(),
            endTime: slotEnd.toISOString(),
            displayTime: current.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            }),
            date: current.toLocaleDateString(),
            dateTime: current.toLocaleString()
          });
        }

        current.setMinutes(current.getMinutes() + 30); // 30-minute intervals
      }

      console.log(`✅ Found ${availableSlots.length} available slots for ${targetDate.toDateString()}`);
      
      if (availableSlots.length > 0) {
        console.log('Available slots:');
        availableSlots.slice(0, 5).forEach((slot, index) => {
          console.log(`   ${index + 1}. ${slot.displayTime} (${slot.dateTime})`);
        });
      }

      return availableSlots;
    } catch (error) {
      console.error('❌ Error getting available slots:', error.message);
      console.error('Full error:', error);
      return [];
    }
  }

  // Enhanced event creation with better error handling
  async createEvent(eventDetails) {
    if (!this.initialized) {
      console.error('❌ Google Calendar service not initialized');
      return {
        success: false,
        error: 'Google Calendar service not initialized'
      };
    }

    try {
      const { 
        summary = 'Nexella AI Consultation',
        description = '',
        startTime,
        endTime,
        attendeeEmail,
        attendeeName = 'Guest'
      } = eventDetails;

      console.log('📅 Creating calendar event:', {
        summary,
        startTime,
        endTime,
        attendeeEmail,
        attendeeName
      });

      // Double-check availability before creating
      const isAvailable = await this.isSlotAvailable(startTime, endTime);
      if (!isAvailable) {
        console.error('❌ Time slot is not available for booking');
        return {
          success: false,
          error: 'Time slot is not available'
        };
      }

      const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

      const event = {
        summary,
        description: `Meeting with ${attendeeName}\n\n${description}`,
        start: {
          dateTime: startTime,
          timeZone: 'America/Los_Angeles'
        },
        end: {
          dateTime: endTime,
          timeZone: 'America/Los_Angeles'
        },
        attendees: [
          { email: attendeeEmail, displayName: attendeeName }
        ],
        conferenceData: {
          createRequest: {
            requestId: uuidv4(),
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 }, // 24 hours
            { method: 'email', minutes: 60 },      // 1 hour
            { method: 'popup', minutes: 10 }       // 10 minutes
          ]
        }
      };

      console.log('📋 Event payload:', JSON.stringify(event, null, 2));

      const response = await this.calendar.events.insert({
        calendarId: calendarId,
        resource: event,
        conferenceDataVersion: 1,
        sendNotifications: true
      });

      console.log('✅ Calendar event created successfully!');
      console.log('📅 Event ID:', response.data.id);
      console.log('🔗 Event link:', response.data.htmlLink);
      console.log('🎥 Meeting link:', response.data.conferenceData?.entryPoints?.[0]?.uri);
      
      return {
        success: true,
        eventId: response.data.id,
        meetingLink: response.data.conferenceData?.entryPoints?.[0]?.uri || '',
        eventLink: response.data.htmlLink,
        startTime: response.data.start.dateTime,
        endTime: response.data.end.dateTime,
        summary: response.data.summary
      };
    } catch (error) {
      console.error('❌ Error creating calendar event:', error.message);
      console.error('Full error:', error);
      
      if (error.code === 403) {
        console.error('🔒 Permission denied. Check if the service account can create events on this calendar');
      } else if (error.code === 409) {
        console.error('⏰ Scheduling conflict - time slot may already be booked');
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ENHANCED: Parse user input for preferred times with better time extraction
  parseTimePreference(userInput, preferredDay) {
    console.log(`🔤 Parsing time preference: "${userInput}" for day: "${preferredDay}"`);
    
    // Combine both inputs for parsing
    const fullInput = `${userInput} ${preferredDay}`.toLowerCase();
    const today = new Date();
    let targetDate = new Date();

    // Handle day preferences with better parsing
    const dayMatch = fullInput.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/i);
    const timeMatch = fullInput.match(/\b(\d{1,2})\s*(am|pm|a\.?m\.?|p\.?m\.?)\b/i);
    const hourMatch = fullInput.match(/\b(\d{1,2})\b/);
    
    console.log('🔍 Parsing matches:', {
      dayMatch: dayMatch?.[0],
      timeMatch: timeMatch?.[0], 
      hourMatch: hourMatch?.[0],
      fullInput
    });

    if (dayMatch) {
      const preferredDayName = dayMatch[0].toLowerCase();
      console.log('📅 Found day:', preferredDayName);
      
      if (preferredDayName === 'tomorrow') {
        targetDate.setDate(targetDate.getDate() + 1);
      } else if (preferredDayName === 'today') {
        // Keep today's date
      } else {
        // Handle specific day of week
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayIndex = days.indexOf(preferredDayName);
        
        if (dayIndex !== -1) {
          const currentDay = today.getDay();
          let daysToAdd = dayIndex - currentDay;
          if (daysToAdd <= 0) daysToAdd += 7; // Next week if day has passed
          
          targetDate.setDate(today.getDate() + daysToAdd);
          console.log('📅 Calculated target date:', targetDate.toDateString());
        }
      }
    }

    // Handle time preferences with better parsing
    let preferredHour = 10; // Default 10 AM
    
    if (timeMatch) {
      // Parse specific time like "10am" or "2pm"
      const hour = parseInt(timeMatch[1]);
      const ampm = timeMatch[2].toLowerCase();
      
      if (ampm.includes('p') && hour !== 12) {
        preferredHour = hour + 12; // Convert PM to 24-hour
      } else if (ampm.includes('a') && hour === 12) {
        preferredHour = 0; // 12 AM = 0 hours
      } else {
        preferredHour = hour;
      }
      
      console.log(`⏰ Parsed specific time: ${hour}${ampm} -> ${preferredHour}:00`);
    } else if (hourMatch && !timeMatch) {
      // Just a number like "10" - assume AM for business hours
      const hour = parseInt(hourMatch[1]);
      if (hour >= 8 && hour <= 12) {
        preferredHour = hour; // Morning hours
      } else if (hour >= 1 && hour <= 5) {
        preferredHour = hour + 12; // Afternoon hours
      }
      console.log(`⏰ Parsed hour only: ${hour} -> ${preferredHour}:00`);
    } else if (fullInput.includes('morning')) {
      preferredHour = 10;
      console.log('⏰ Defaulted to morning: 10:00');
    } else if (fullInput.includes('afternoon')) {
      preferredHour = 14; // 2 PM
      console.log('⏰ Defaulted to afternoon: 14:00');
    } else if (fullInput.includes('evening')) {
      preferredHour = 16; // 4 PM
      console.log('⏰ Defaulted to evening: 16:00');
    }

    // Ensure hour is within business hours (9 AM - 5 PM)
    if (preferredHour < 9) preferredHour = 9;
    if (preferredHour > 17) preferredHour = 17;

    targetDate.setHours(preferredHour, 0, 0, 0);
    
    const result = {
      preferredDateTime: targetDate,
      preferredHour,
      dayName: targetDate.toLocaleDateString('en-US', { weekday: 'long' }),
      timeString: targetDate.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      })
    };
    
    console.log('📅 Final parsed time preference:', result);
    return result;
  }

  // Generate booking confirmation message
  generateBookingMessage(eventDetails, isBooked = false) {
    const { startTime, meetingLink, eventLink } = eventDetails;
    const date = new Date(startTime);
    const formattedDate = date.toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });

    if (isBooked) {
      return `Perfect! I've scheduled your appointment for ${formattedDate}. You'll receive a calendar invitation with the meeting details. ${meetingLink ? `Here's your meeting link: ${meetingLink}` : ''}`;
    } else {
      return `Great! Your appointment is confirmed for ${formattedDate}. You should receive a calendar invitation shortly with all the details.`;
    }
  }
}

module.exports = GoogleCalendarService;
