// src/services/calendar/GoogleCalendarService.js - SIMPLIFIED ARIZONA TIME ONLY
const { google } = require('googleapis');
const config = require('../../config/environment');

class GoogleCalendarService {
  constructor() {
    this.calendar = null;
    this.auth = null;
    this.calendarId = config.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com';
    
    // Arizona timezone - MST year-round (no DST)
    this.timezone = 'America/Phoenix';
    
    // Business hours in Arizona
    this.businessHours = {
      start: 8,   // 8 AM
      end: 16,    // 4 PM
      days: [1, 2, 3, 4, 5], // Monday to Friday
      availableHours: [8, 9, 10, 11, 13, 14, 15] // Skip noon for lunch
    };
    
    console.log('🔧 GoogleCalendarService initialized');
    console.log('📅 Calendar ID:', this.calendarId);
    console.log('🌍 Timezone:', this.timezone);
  }

  async initialize() {
    try {
      console.log('🔧 Initializing Google Calendar service...');
      
      if (!config.GOOGLE_PROJECT_ID || !config.GOOGLE_PRIVATE_KEY || !config.GOOGLE_CLIENT_EMAIL) {
        throw new Error('Missing required Google Calendar environment variables');
      }
      
      await this.setupAuthentication();
      
      if (this.auth) {
        this.calendar = google.calendar({ version: 'v3', auth: this.auth });
        console.log('✅ Google Calendar service initialized successfully');
        
        const testResult = await this.testConnection();
        if (!testResult) {
          console.warn('⚠️ Calendar connection test had issues but continuing...');
        }
        return true;
      } else {
        throw new Error('Google Calendar authentication failed');
      }
    } catch (error) {
      console.error('❌ Failed to initialize Google Calendar service:', error.message);
      throw error;
    }
  }

  async setupAuthentication() {
    try {
      console.log('🔐 Setting up Google Calendar authentication...');
      
      let privateKey = config.GOOGLE_PRIVATE_KEY;
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }
      
      const authClient = new google.auth.GoogleAuth({
        credentials: {
          type: "service_account",
          project_id: config.GOOGLE_PROJECT_ID,
          private_key_id: config.GOOGLE_PRIVATE_KEY_ID || "key_id",
          private_key: privateKey,
          client_email: config.GOOGLE_CLIENT_EMAIL,
          client_id: config.GOOGLE_CLIENT_ID || "client_id",
          auth_uri: "https://accounts.google.com/o/oauth2/auth",
          token_uri: "https://oauth2.googleapis.com/token",
          auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
          client_x509_cert_url: `https://www.googleapis.com/oauth2/v1/certs/${encodeURIComponent(config.GOOGLE_CLIENT_EMAIL)}`
        },
        scopes: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events'
        ]
      });
      
      this.auth = await authClient.getClient();
      console.log('✅ Authentication configured successfully');
      
    } catch (error) {
      console.error('❌ Authentication setup failed:', error.message);
      throw error;
    }
  }

  async testConnection() {
    try {
      console.log('🧪 Testing Google Calendar connection...');
      
      const response = await this.calendar.calendars.get({
        calendarId: this.calendarId
      });
      
      console.log(`✅ Connected to calendar: ${response.data.summary || this.calendarId}`);
      return true;
      
    } catch (error) {
      console.error('❌ Calendar connection test failed:', error.message);
      return false;
    }
  }

  async getAvailableSlots(date) {
    try {
      console.log('📅 Getting available slots for:', date);
      
      const targetDate = new Date(date);
      const dayOfWeek = targetDate.getDay();
      
      // Check if it's a business day
      if (!this.businessHours.days.includes(dayOfWeek)) {
        console.log('📅 Not a business day');
        return [];
      }

      // Check if it's in the past
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (targetDate < today) {
        console.log('📅 Date is in the past');
        return [];
      }

      // Get start and end of day
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Get existing events
      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const existingEvents = response.data.items || [];
      console.log(`📋 Found ${existingEvents.length} existing events`);

      // Generate available slots
      const availableSlots = [];
      const now = new Date();
      
      for (const hour of this.businessHours.availableHours) {
        const slotStart = new Date(targetDate);
        slotStart.setHours(hour, 0, 0, 0);
        
        const slotEnd = new Date(targetDate);
        slotEnd.setHours(hour + 1, 0, 0, 0);
        
        // Skip if in the past
        if (slotStart <= now) {
          console.log(`⏰ Skipping past time: ${hour}:00`);
          continue;
        }
        
        // Check for conflicts
        const hasConflict = existingEvents.some(event => {
          if (!event.start?.dateTime) return false;
          const eventStart = new Date(event.start.dateTime);
          const eventEnd = new Date(event.end.dateTime);
          return (slotStart < eventEnd && slotEnd > eventStart);
        });

        if (!hasConflict) {
          availableSlots.push({
            startTime: slotStart.toISOString(),
            endTime: slotEnd.toISOString(),
            displayTime: `${hour > 12 ? hour - 12 : hour}:00 ${hour >= 12 ? 'PM' : 'AM'}`
          });
          console.log(`✅ Available slot: ${hour}:00`);
        } else {
          console.log(`❌ Slot conflict at ${hour}:00`);
        }
      }

      console.log(`✅ Generated ${availableSlots.length} available slots`);
      return availableSlots;

    } catch (error) {
      console.error('❌ Error getting calendar slots:', error.message);
      throw error;
    }
  }

  async isSlotAvailable(startTime, endTime) {
    try {
      console.log(`🔍 Checking availability: ${startTime} to ${endTime}`);
      
      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startTime,
        timeMax: endTime,
        singleEvents: true
      });

      const events = response.data.items || [];
      const isAvailable = events.length === 0;
      
      console.log(`📊 Slot availability: ${isAvailable ? 'Available ✅' : 'Booked ❌'}`);
      return isAvailable;

    } catch (error) {
      console.error('❌ Error checking slot availability:', error.message);
      return true; // Assume available if can't check
    }
  }

  async createEvent(eventDetails) {
    try {
      console.log('📅 Creating calendar event:', eventDetails.summary);
      console.log('🕐 Start time:', eventDetails.startTime);
      console.log('🕐 End time:', eventDetails.endTime);
      console.log('📧 Attendee:', eventDetails.attendeeEmail);

      // Validate inputs
      if (!eventDetails.attendeeEmail || eventDetails.attendeeEmail === 'prospect@example.com') {
        throw new Error('Valid attendee email required');
      }

      // Check availability first
      const isAvailable = await this.isSlotAvailable(eventDetails.startTime, eventDetails.endTime);
      if (!isAvailable) {
        return {
          success: false,
          error: 'Slot no longer available',
          message: 'That time slot has been booked'
        };
      }

      // Create the event
      const event = {
        summary: eventDetails.summary || 'Nexella AI Consultation Call',
        description: eventDetails.description || 'Discovery call scheduled via Nexella AI',
        location: 'Phone Call / Video Conference',
        start: {
          dateTime: eventDetails.startTime,
          timeZone: this.timezone
        },
        end: {
          dateTime: eventDetails.endTime,
          timeZone: this.timezone
        },
        attendees: [
          {
            email: eventDetails.attendeeEmail,
            displayName: eventDetails.attendeeName || 'Guest'
          }
        ],
        conferenceData: {
          createRequest: {
            requestId: `nexella_${Date.now()}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet'
            }
          }
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 },
            { method: 'email', minutes: 60 },
            { method: 'popup', minutes: 30 }
          ]
        }
      };

      console.log('📅 Creating event...');
      
      const response = await this.calendar.events.insert({
        calendarId: this.calendarId,
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all'
      });

      const createdEvent = response.data;
      console.log('✅ Event created successfully!');
      console.log('📅 Event ID:', createdEvent.id);
      
      const meetingLink = createdEvent.hangoutLink || 
                         createdEvent.conferenceData?.entryPoints?.[0]?.uri || '';

      return {
        success: true,
        eventId: createdEvent.id,
        meetingLink: meetingLink,
        eventLink: createdEvent.htmlLink,
        message: 'Appointment created successfully',
        customerEmail: eventDetails.attendeeEmail,
        customerName: eventDetails.attendeeName,
        startTime: eventDetails.startTime,
        endTime: eventDetails.endTime
      };

    } catch (error) {
      console.error('❌ Error creating calendar event:', error.message);
      
      if (error.response?.status === 401) {
        return {
          success: false,
          error: 'Authentication failed',
          message: 'Calendar authentication failed'
        };
      } else if (error.response?.status === 403) {
        return {
          success: false,
          error: 'Permission denied',
          message: 'Calendar permissions insufficient'
        };
      } else if (error.response?.status === 404) {
        return {
          success: false,
          error: 'Calendar not found',
          message: 'Calendar not found or not accessible'
        };
      } else {
        return {
          success: false,
          error: error.message,
          message: 'Failed to create calendar event'
        };
      }
    }
  }

  isInitialized() {
    return !!(this.calendar && this.auth);
  }

  getCalendarInfo() {
    return {
      calendarId: this.calendarId,
      timezone: this.timezone,
      businessHours: this.businessHours,
      initialized: this.isInitialized(),
      hasAuth: !!this.auth,
      hasCalendar: !!this.calendar
    };
  }
}

module.exports = GoogleCalendarService;
