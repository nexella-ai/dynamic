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

  // Enhanced availability checking with detailed logging
  async isSlotAvailable(startTime, endTime) {
    if (!this.initialized) {
      console.warn('⚠️ Google Calendar service not initialized - returning false');
      return false;
    }

    try {
      console.log(`🔍 Checking availability for slot: ${startTime} to ${endTime}`);
      const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
      
      // Use freebusy query for more accurate availability checking
      const response = await this.calendar.freebusy.query({
        resource: {
          timeMin: startTime,
          timeMax: endTime,
          timeZone: 'America/Los_Angeles',
          items: [{ id: calendarId }]
        }
      });

      console.log('📊 Freebusy response:', JSON.stringify(response.data, null, 2));

      const busyTimes = response.data.calendars[calendarId]?.busy || [];
      const isAvailable = busyTimes.length === 0;
      
      console.log(`📅 Slot ${startTime} to ${endTime}: ${isAvailable ? 'AVAILABLE' : 'BUSY'}`);
      if (!isAvailable) {
        console.log('⏰ Busy times found:', busyTimes);
      }
      
      return isAvailable;
    } catch (error) {
      console.error('❌ Error checking slot availability:', error.message);
      console.error('Full error:', error);
      return false;
    }
  }

  // Enhanced method to get available slots with better conflict detection
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
          console.log(`   - ${event.summary}: ${event.start.dateTime || event.start.date} to ${event.end.dateTime || event.end.date}`);
        });
      }

      if (busyTimes.length > 0) {
        console.log('⏰ Busy times:');
        busyTimes.forEach(busy => {
          console.log(`   - ${busy.start} to ${busy.end}`);
        });
      }

      // Generate potential time slots (every 30 minutes from 9 AM to 5 PM)
      const availableSlots = [];
      const slotDuration = duration * 60 * 1000; // Convert minutes to milliseconds
      const current = new Date(startOfDay);

      while (current < endOfDay) {
        const slotEnd = new Date(current.getTime() + slotDuration);
        
        // Check conflicts with both events and busy times
        const hasEventConflict = existingEvents.some(event => {
          const eventStart = new Date(event.start.dateTime || event.start.date);
          const eventEnd = new Date(event.end.dateTime || event.end.date);
          return (current < eventEnd && slotEnd > eventStart);
        });

        const hasBusyConflict = busyTimes.some(busy => {
          const busyStart = new Date(busy.start);
          const busyEnd = new Date(busy.end);
          return (current < busyEnd && slotEnd > busyStart);
        });

        const hasConflict = hasEventConflict || hasBusyConflict;

        if (!hasConflict) {
          availableSlots.push({
            startTime: current.toISOString(),
            endTime: slotEnd.toISOString(),
            displayTime: current.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            }),
            date: current.toLocaleDateString()
          });
        } else {
          console.log(`❌ Slot ${current.toLocaleTimeString()} blocked by ${hasEventConflict ? 'event' : 'busy time'}`);
        }

        current.setMinutes(current.getMinutes() + 30); // 30-minute intervals
      }

      console.log(`✅ Found ${availableSlots.length} available slots`);
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

  // Parse user input for preferred times (same as before but with logging)
  parseTimePreference(userInput, preferredDay) {
    console.log(`🔤 Parsing time preference: "${userInput}" for day: "${preferredDay}"`);
    
    const input = userInput.toLowerCase();
    const today = new Date();
    let targetDate = new Date();

    // Handle day preferences
    if (preferredDay) {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayIndex = days.findIndex(day => preferredDay.toLowerCase().includes(day));
      
      if (dayIndex !== -1) {
        const currentDay = today.getDay();
        let daysToAdd = dayIndex - currentDay;
        if (daysToAdd <= 0) daysToAdd += 7; // Next week if day has passed
        
        targetDate.setDate(today.getDate() + daysToAdd);
      }
    }

    // Handle time preferences
    let preferredHour = 10; // Default 10 AM
    
    // Morning preferences
    if (input.includes('morning') || input.includes('9') || input.includes('10') || input.includes('11')) {
      if (input.includes('9')) preferredHour = 9;
      else if (input.includes('10')) preferredHour = 10;
      else if (input.includes('11')) preferredHour = 11;
      else preferredHour = 10; // Default morning
    }
    // Afternoon preferences
    else if (input.includes('afternoon') || input.includes('1') || input.includes('2') || input.includes('3')) {
      if (input.includes('1')) preferredHour = 13;
      else if (input.includes('2')) preferredHour = 14;
      else if (input.includes('3')) preferredHour = 15;
      else preferredHour = 14; // Default afternoon
    }
    // Evening preferences
    else if (input.includes('evening') || input.includes('4') || input.includes('5')) {
      if (input.includes('4')) preferredHour = 16;
      else if (input.includes('5')) preferredHour = 17;
      else preferredHour = 16; // Default evening
    }

    targetDate.setHours(preferredHour, 0, 0, 0);
    
    const result = {
      preferredDateTime: targetDate,
      preferredHour,
      dayName: targetDate.toLocaleDateString('en-US', { weekday: 'long' })
    };
    
    console.log('📅 Parsed time preference result:', result);
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
