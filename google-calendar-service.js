// FIXED: google-calendar-service.js with enhanced debugging and proper conflict detection

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
      
      await this.testConnection();
      
      this.initialized = true;
      console.log('✅ Google Calendar service initialized successfully');
    } catch (error) {
      console.error('❌ Error initializing Google Calendar service:', error.message);
      this.initialized = false;
    }
  }

  async testConnection() {
    try {
      console.log('🧪 Testing Google Calendar connection...');
      const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
      
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

  // FIXED: Enhanced availability checking with proper timezone handling
  async isSlotAvailable(startTime, endTime) {
    if (!this.initialized) {
      console.warn('⚠️ Google Calendar service not initialized - returning false');
      return false;
    }

    try {
      console.log(`🔍 Checking availability for slot: ${startTime} to ${endTime}`);
      const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
      
      const requestStart = new Date(startTime);
      const requestEnd = new Date(endTime);
      
      console.log('📅 Checking availability:', {
        requestStart: requestStart.toISOString(),
        requestEnd: requestEnd.toISOString(),
        requestStartLocal: requestStart.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
        requestEndLocal: requestEnd.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
      });

      // Get events for the time period with broader window to catch edge cases
      const searchStart = new Date(requestStart);
      searchStart.setHours(searchStart.getHours() - 1); // Look 1 hour before
      
      const searchEnd = new Date(requestEnd);
      searchEnd.setHours(searchEnd.getHours() + 1); // Look 1 hour after

      const eventsResponse = await this.calendar.events.list({
        calendarId: calendarId,
        timeMin: searchStart.toISOString(),
        timeMax: searchEnd.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const existingEvents = eventsResponse.data.items || [];
      console.log(`📋 Found ${existingEvents.length} existing events in time window`);
      
      // Check each event for conflicts with detailed logging
      let hasConflict = false;
      existingEvents.forEach(event => {
        // Skip declined events
        if (event.status === 'cancelled') {
          console.log(`⏭️ Skipping cancelled event: "${event.summary}"`);
          return;
        }

        const eventStart = new Date(event.start.dateTime || event.start.date);
        const eventEnd = new Date(event.end.dateTime || event.end.date);
        
        console.log(`🔍 Checking event: "${event.summary}"`);
        console.log(`   Event time: ${eventStart.toLocaleString()} - ${eventEnd.toLocaleString()}`);
        console.log(`   Requested: ${requestStart.toLocaleString()} - ${requestEnd.toLocaleString()}`);
        
        // Check for overlap: events overlap if start < otherEnd && end > otherStart
        const overlap = requestStart < eventEnd && requestEnd > eventStart;
        
        if (overlap) {
          console.log(`❌ CONFLICT DETECTED with event: "${event.summary}"`);
          console.log(`   Overlap details:`);
          console.log(`     Requested starts: ${requestStart.toISOString()}`);
          console.log(`     Event ends: ${eventEnd.toISOString()}`);
          console.log(`     Requested ends: ${requestEnd.toISOString()}`);
          console.log(`     Event starts: ${eventStart.toISOString()}`);
          hasConflict = true;
        } else {
          console.log(`✅ No conflict with event: "${event.summary}"`);
        }
      });
      
      console.log(`📅 AVAILABILITY RESULT: ${hasConflict ? 'NOT AVAILABLE' : 'AVAILABLE'}`);
      return !hasConflict;
      
    } catch (error) {
      console.error('❌ Error checking slot availability:', error.message);
      return false;
    }
  }

  // FIXED: Enhanced available slots with better business hours handling
  async getAvailableSlots(date, duration = 60) {
    if (!this.initialized) {
      console.warn('⚠️ Google Calendar service not initialized - returning empty array');
      return [];
    }

    try {
      console.log(`🔍 Getting available slots for ${date} (${duration} min duration)`);
      
      const targetDate = new Date(date);
      
      // FIXED: Proper business hours in Pacific Time
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(9, 0, 0, 0); // 9 AM
      
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(17, 0, 0, 0); // 5 PM

      console.log(`📅 Business hours: ${startOfDay.toLocaleString()} to ${endOfDay.toLocaleString()}`);

      const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

      // Get existing events for the entire day
      const eventsResponse = await this.calendar.events.list({
        calendarId: calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const existingEvents = eventsResponse.data.items?.filter(event => 
        event.status !== 'cancelled'
      ) || [];
      
      console.log(`📋 Found ${existingEvents.length} active events for the day`);
      
      if (existingEvents.length > 0) {
        console.log('📅 Existing events:');
        existingEvents.forEach(event => {
          const start = new Date(event.start.dateTime || event.start.date);
          const end = new Date(event.end.dateTime || event.end.date);
          console.log(`   - "${event.summary}": ${start.toLocaleString()} to ${end.toLocaleString()}`);
        });
      }

      // Generate time slots every 30 minutes
      const availableSlots = [];
      const slotDuration = duration * 60 * 1000; // Convert to milliseconds
      const current = new Date(startOfDay);

      while (current < endOfDay) {
        const slotEnd = new Date(current.getTime() + slotDuration);
        
        // Don't go past business hours
        if (slotEnd > endOfDay) {
          break;
        }
        
        console.log(`🕐 Testing slot: ${current.toLocaleString()} - ${slotEnd.toLocaleString()}`);
        
        // Check for conflicts with existing events
        const hasConflict = existingEvents.some(event => {
          const eventStart = new Date(event.start.dateTime || event.start.date);
          const eventEnd = new Date(event.end.dateTime || event.end.date);
          
          // Check for overlap
          const overlap = current < eventEnd && slotEnd > eventStart;
          
          if (overlap) {
            console.log(`   ❌ Conflicts with: "${event.summary}"`);
          }
          return overlap;
        });

        if (!hasConflict) {
          console.log(`   ✅ Slot is available`);
          availableSlots.push({
            startTime: current.toISOString(),
            endTime: slotEnd.toISOString(),
            displayTime: current.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: 'America/Los_Angeles'
            }),
            date: current.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }),
            dateTime: current.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
          });
        }

        // Move to next 30-minute slot
        current.setMinutes(current.getMinutes() + 30);
      }

      console.log(`✅ Found ${availableSlots.length} available slots for ${targetDate.toDateString()}`);
      
      if (availableSlots.length > 0) {
        console.log('📋 Available slots:');
        availableSlots.slice(0, 5).forEach((slot, index) => {
          console.log(`   ${index + 1}. ${slot.displayTime}`);
        });
      }

      return availableSlots;
    } catch (error) {
      console.error('❌ Error getting available slots:', error.message);
      return [];
    }
  }

  // FIXED: Enhanced event creation with conflict prevention
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

      // CRITICAL: Double-check availability before creating
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
            { method: 'email', minutes: 24 * 60 },
            { method: 'email', minutes: 60 },
            { method: 'popup', minutes: 10 }
          ]
        }
      };

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
      
      if (error.code === 403) {
        console.error('🔒 Permission denied. Check service account permissions');
      } else if (error.code === 409) {
        console.error('⏰ Scheduling conflict detected');
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  // FIXED: Better time parsing with enhanced logic
  parseTimePreference(userInput, preferredDay) {
    console.log(`🔤 Parsing time preference: "${userInput}" for day: "${preferredDay}"`);
    
    const fullInput = `${userInput} ${preferredDay}`.toLowerCase();
    const today = new Date();
    let targetDate = new Date();

    // Handle day preferences
    const dayMatch = fullInput.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/i);
    if (dayMatch) {
      const preferredDayName = dayMatch[0].toLowerCase();
      
      if (preferredDayName === 'tomorrow') {
        targetDate.setDate(targetDate.getDate() + 1);
      } else if (preferredDayName === 'today') {
        // Keep today's date
      } else {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayIndex = days.indexOf(preferredDayName);
        
        if (dayIndex !== -1) {
          const currentDay = today.getDay();
          let daysToAdd = dayIndex - currentDay;
          if (daysToAdd <= 0) daysToAdd += 7;
          
          targetDate.setDate(today.getDate() + daysToAdd);
        }
      }
    }

    // Enhanced time parsing
    let preferredHour = 10; // Default 10 AM
    
    const timeMatch = fullInput.match(/\b(\d{1,2})\s*(am|pm|a\.?m\.?|p\.?m\.?)\b/i);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1]);
      const ampm = timeMatch[2].toLowerCase();
      
      if (ampm.includes('p') && hour !== 12) {
        preferredHour = hour + 12;
      } else if (ampm.includes('a') && hour === 12) {
        preferredHour = 0;
      } else {
        preferredHour = hour;
      }
    } else if (fullInput.includes('morning')) {
      preferredHour = 10;
    } else if (fullInput.includes('afternoon')) {
      preferredHour = 14;
    } else if (fullInput.includes('evening')) {
      preferredHour = 16;
    }

    // Ensure business hours
    if (preferredHour < 9) preferredHour = 9;
    if (preferredHour > 16) preferredHour = 16; // Last slot starts at 4 PM

    targetDate.setHours(preferredHour, 0, 0, 0);
    
    return {
      preferredDateTime: targetDate,
      preferredHour,
      dayName: targetDate.toLocaleDateString('en-US', { weekday: 'long' }),
      timeString: targetDate.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      })
    };
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

module.exports = GoogleCalendarService;// FIXED: google-calendar-service.js with enhanced debugging and proper conflict detection

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
      
      await this.testConnection();
      
      this.initialized = true;
      console.log('✅ Google Calendar service initialized successfully');
    } catch (error) {
      console.error('❌ Error initializing Google Calendar service:', error.message);
      this.initialized = false;
    }
  }

  async testConnection() {
    try {
      console.log('🧪 Testing Google Calendar connection...');
      const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
      
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
        console.error('🔒 Access denied. Check service account permissions.');
      }
      throw error;
    }
  }

  // FIXED: Enhanced availability checking with proper timezone handling
  async isSlotAvailable(startTime, endTime) {
    if (!this.initialized) {
      console.warn('⚠️ Google Calendar service not initialized - returning false');
      return false;
    }

    try {
      console.log(`🔍 Checking availability for slot: ${startTime} to ${endTime}`);
      const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
      
      const requestStart = new Date(startTime);
      const requestEnd = new Date(endTime);
      
      console.log('📅 Checking availability:', {
        requestStart: requestStart.toISOString(),
        requestEnd: requestEnd.toISOString(),
        requestStartLocal: requestStart.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
        requestEndLocal: requestEnd.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
      });

      // Get events for the time period with broader window to catch edge cases
      const searchStart = new Date(requestStart);
      searchStart.setHours(searchStart.getHours() - 1); // Look 1 hour before
      
      const searchEnd = new Date(requestEnd);
      searchEnd.setHours(searchEnd.getHours() + 1); // Look 1 hour after

      const eventsResponse = await this.calendar.events.list({
        calendarId: calendarId,
        timeMin: searchStart.toISOString(),
        timeMax: searchEnd.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const existingEvents = eventsResponse.data.items || [];
      console.log(`📋 Found ${existingEvents.length} existing events in time window`);
      
      // Check each event for conflicts with detailed logging
      let hasConflict = false;
      existingEvents.forEach(event => {
        // Skip declined events
        if (event.status === 'cancelled') {
          console.log(`⏭️ Skipping cancelled event: "${event.summary}"`);
          return;
        }

        const eventStart = new Date(event.start.dateTime || event.start.date);
        const eventEnd = new Date(event.end.dateTime || event.end.date);
        
        console.log(`🔍 Checking event: "${event.summary}"`);
        console.log(`   Event time: ${eventStart.toLocaleString()} - ${eventEnd.toLocaleString()}`);
        console.log(`   Requested: ${requestStart.toLocaleString()} - ${requestEnd.toLocaleString()}`);
        
        // Check for overlap: events overlap if start < otherEnd && end > otherStart
        const overlap = requestStart < eventEnd && requestEnd > eventStart;
        
        if (overlap) {
          console.log(`❌ CONFLICT DETECTED with event: "${event.summary}"`);
          console.log(`   Overlap details:`);
          console.log(`     Requested starts: ${requestStart.toISOString()}`);
          console.log(`     Event ends: ${eventEnd.toISOString()}`);
          console.log(`     Requested ends: ${requestEnd.toISOString()}`);
          console.log(`     Event starts: ${eventStart.toISOString()}`);
          hasConflict = true;
        } else {
          console.log(`✅ No conflict with event: "${event.summary}"`);
        }
      });
      
      console.log(`📅 AVAILABILITY RESULT: ${hasConflict ? 'NOT AVAILABLE' : 'AVAILABLE'}`);
      return !hasConflict;
      
    } catch (error) {
      console.error('❌ Error checking slot availability:', error.message);
      return false;
    }
  }

  // FIXED: Enhanced available slots with better business hours handling
  async getAvailableSlots(date, duration = 60) {
    if (!this.initialized) {
      console.warn('⚠️ Google Calendar service not initialized - returning empty array');
      return [];
    }

    try {
      console.log(`🔍 Getting available slots for ${date} (${duration} min duration)`);
      
      const targetDate = new Date(date);
      
      // FIXED: Proper business hours in Pacific Time
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(9, 0, 0, 0); // 9 AM
      
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(17, 0, 0, 0); // 5 PM

      console.log(`📅 Business hours: ${startOfDay.toLocaleString()} to ${endOfDay.toLocaleString()}`);

      const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

      // Get existing events for the entire day
      const eventsResponse = await this.calendar.events.list({
        calendarId: calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const existingEvents = eventsResponse.data.items?.filter(event => 
        event.status !== 'cancelled'
      ) || [];
      
      console.log(`📋 Found ${existingEvents.length} active events for the day`);
      
      if (existingEvents.length > 0) {
        console.log('📅 Existing events:');
        existingEvents.forEach(event => {
          const start = new Date(event.start.dateTime || event.start.date);
          const end = new Date(event.end.dateTime || event.end.date);
          console.log(`   - "${event.summary}": ${start.toLocaleString()} to ${end.toLocaleString()}`);
        });
      }

      // Generate time slots every 30 minutes
      const availableSlots = [];
      const slotDuration = duration * 60 * 1000; // Convert to milliseconds
      const current = new Date(startOfDay);

      while (current < endOfDay) {
        const slotEnd = new Date(current.getTime() + slotDuration);
        
        // Don't go past business hours
        if (slotEnd > endOfDay) {
          break;
        }
        
        console.log(`🕐 Testing slot: ${current.toLocaleString()} - ${slotEnd.toLocaleString()}`);
        
        // Check for conflicts with existing events
        const hasConflict = existingEvents.some(event => {
          const eventStart = new Date(event.start.dateTime || event.start.date);
          const eventEnd = new Date(event.end.dateTime || event.end.date);
          
          // Check for overlap
          const overlap = current < eventEnd && slotEnd > eventStart;
          
          if (overlap) {
            console.log(`   ❌ Conflicts with: "${event.summary}"`);
          }
          return overlap;
        });

        if (!hasConflict) {
          console.log(`   ✅ Slot is available`);
          availableSlots.push({
            startTime: current.toISOString(),
            endTime: slotEnd.toISOString(),
            displayTime: current.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: 'America/Los_Angeles'
            }),
            date: current.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }),
            dateTime: current.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
          });
        }

        // Move to next 30-minute slot
        current.setMinutes(current.getMinutes() + 30);
      }

      console.log(`✅ Found ${availableSlots.length} available slots for ${targetDate.toDateString()}`);
      
      if (availableSlots.length > 0) {
        console.log('📋 Available slots:');
        availableSlots.slice(0, 5).forEach((slot, index) => {
          console.log(`   ${index + 1}. ${slot.displayTime}`);
        });
      }

      return availableSlots;
    } catch (error) {
      console.error('❌ Error getting available slots:', error.message);
      return [];
    }
  }

  // FIXED: Enhanced event creation with conflict prevention
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

      // CRITICAL: Double-check availability before creating
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
            { method: 'email', minutes: 24 * 60 },
            { method: 'email', minutes: 60 },
            { method: 'popup', minutes: 10 }
          ]
        }
      };

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
      
      if (error.code === 403) {
        console.error('🔒 Permission denied. Check service account permissions');
      } else if (error.code === 409) {
        console.error('⏰ Scheduling conflict detected');
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  // FIXED: Better time parsing
  parseTimePreference(userInput, preferredDay) {
    console.log(`🔤 Parsing time preference: "${userInput}" for day: "${preferredDay}"`);
    
    const fullInput = `${userInput} ${preferredDay}`.toLowerCase();
    const today = new Date();
    let targetDate = new Date();

    // Handle day preferences
    const dayMatch = fullInput.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/i);
    if (dayMatch) {
      const preferredDayName = dayMatch[0].toLowerCase();
      
      if (preferredDayName === 'tomorrow') {
        targetDate.setDate(targetDate.getDate() + 1);
      } else if (preferredDayName === 'today') {
        // Keep today's date
      } else {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayIndex = days.indexOf(preferredDayName);
        
        if (dayIndex !== -1) {
          const currentDay = today.getDay();
          let daysToAdd = dayIndex - currentDay;
          if (daysToAdd <= 0) daysToAdd += 7;
          
          targetDate.setDate(today.getDate() + daysToAdd);
        }
      }
    }

    // Enhanced time parsing
    let preferredHour = 10; // Default 10 AM
    
    const timeMatch = fullInput.match(/\b(\d{1,2})\s*(am|pm|a\.?m\.?|p\.?m\.?)\b/i);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1]);
      const ampm = timeMatch[2].toLowerCase();
      
      if (ampm.includes('p') && hour !== 12) {
        preferredHour = hour + 12;
      } else if (ampm.includes('a') && hour === 12) {
        preferredHour = 0;
      } else {
        preferredHour = hour;
      }
    } else if (fullInput.includes('morning')) {
      preferredHour = 10;
    } else if (fullInput.includes('afternoon')) {
      preferredHour = 14;
    } else if (fullInput.includes('evening')) {
      preferredHour = 16;
    }

    // Ensure business hours
    if (preferredHour < 9) preferredHour = 9;
    if (preferredHour > 16) preferredHour = 16; // Last slot starts at 4 PM

    targetDate.setHours(preferredHour, 0, 0, 0);
    
    return {
      preferredDateTime: targetDate,
      preferredHour,
      dayName: targetDate.toLocaleDateString('en-US', { weekday: 'long' }),
      timeString: targetDate.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      })
    };
  }
}

module.exports = GoogleCalendarService;
