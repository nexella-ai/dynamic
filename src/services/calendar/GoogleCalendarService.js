// src/services/calendar/GoogleCalendarService.js - FIXED FOR ACTUAL EVENT CREATION
const { google } = require('googleapis');
const config = require('../../config/environment');

class GoogleCalendarService {
  constructor() {
    this.calendar = null;
    this.auth = null;
    this.calendarId = config.GOOGLE_CALENDAR_ID || 'primary';
    
    // Arizona timezone - MST year-round (no DST)
    this.timezone = 'America/Phoenix';
    
    // Your business hours in Arizona MST
    this.businessHours = {
      start: 8,   // 8 AM Arizona time
      end: 16,    // 4 PM Arizona time (16:00 in 24-hour format)
      days: [1, 2, 3, 4, 5], // Monday to Friday only
      slotDuration: 60, // 1 hour appointments
      availableHours: [8, 9, 10, 11, 13, 14, 15] // 8AM-11AM, 1PM-3PM (skip 12PM for lunch)
    };
    
    console.log('🔧 GoogleCalendarService initialized for Arizona MST');
    console.log('📅 Calendar ID:', this.calendarId);
    console.log('🌍 Timezone:', this.timezone);
  }

  async initialize() {
    try {
      console.log('🔧 Initializing Google Calendar service...');
      console.log('🔍 Environment Check:');
      console.log('   GOOGLE_PROJECT_ID:', config.GOOGLE_PROJECT_ID ? '✅ SET' : '❌ MISSING');
      console.log('   GOOGLE_PRIVATE_KEY:', config.GOOGLE_PRIVATE_KEY ? `✅ SET (${config.GOOGLE_PRIVATE_KEY.length} chars)` : '❌ MISSING');
      console.log('   GOOGLE_CLIENT_EMAIL:', config.GOOGLE_CLIENT_EMAIL ? '✅ SET' : '❌ MISSING');
      
      if (!config.GOOGLE_PROJECT_ID || !config.GOOGLE_PRIVATE_KEY || !config.GOOGLE_CLIENT_EMAIL) {
        throw new Error('Missing required Google Calendar environment variables');
      }
      
      await this.setupAuthentication();
      
      if (this.auth) {
        this.calendar = google.calendar({ version: 'v3', auth: this.auth });
        console.log('✅ Google Calendar service initialized successfully');
        
        // Test the connection
        const testResult = await this.testConnection();
        if (!testResult) {
          throw new Error('Calendar connection test failed');
        }
        return true;
      } else {
        throw new Error('Google Calendar authentication failed');
      }
    } catch (error) {
      console.error('❌ Failed to initialize Google Calendar service:', error.message);
      console.error('Stack:', error.stack);
      throw error;
    }
  }

  async setupAuthentication() {
    try {
      console.log('🔐 Setting up Google Calendar authentication...');
      
      // Process the private key properly
      let privateKey = config.GOOGLE_PRIVATE_KEY;
      
      // Handle different private key formats
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }
      
      // Ensure proper formatting
      if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        console.error('❌ Private key format invalid - missing BEGIN marker');
        throw new Error('Invalid private key format');
      }
      
      console.log('🔑 Private key format check:', 
        privateKey.includes('-----BEGIN PRIVATE KEY-----') && 
        privateKey.includes('-----END PRIVATE KEY-----') ? '✅ Valid' : '❌ Invalid'
      );
      
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
      
      // Get the auth client
      this.auth = await authClient.getClient();
      
      console.log('📧 Service account email:', config.GOOGLE_CLIENT_EMAIL);
      console.log('🏗️ Project ID:', config.GOOGLE_PROJECT_ID);
      console.log('✅ Authentication client created successfully');
      
    } catch (error) {
      console.error('❌ Authentication setup failed:', error.message);
      console.error('Stack:', error.stack);
      throw error;
    }
  }

  async testConnection() {
    try {
      console.log('🧪 Testing Google Calendar connection...');
      
      // First try to list calendars to verify basic access
      const calendarList = await this.calendar.calendarList.list({
        maxResults: 10
      });
      
      console.log(`✅ Can access calendar API - found ${calendarList.data.items?.length || 0} calendars`);
      
      // Try to get the specific calendar
      try {
        const calendarResponse = await this.calendar.calendars.get({
          calendarId: this.calendarId
        });
        
        console.log(`✅ Connected to calendar: ${calendarResponse.data.summary || this.calendarId}`);
        console.log(`📅 Calendar timezone: ${calendarResponse.data.timeZone || 'Not set'}`);
        
        // Test event list permission
        const testEventList = await this.calendar.events.list({
          calendarId: this.calendarId,
          maxResults: 1,
          timeMin: new Date().toISOString()
        });
        
        console.log('✅ Can list events from calendar');
        
      } catch (calendarError) {
        console.error('⚠️ Cannot access specific calendar:', calendarError.message);
        console.log('💡 Make sure to share the calendar with:', config.GOOGLE_CLIENT_EMAIL);
        console.log('💡 The service account needs "Make changes to events" permission');
      }
      
      return true;
    } catch (error) {
      console.error('❌ Calendar connection test failed:', error.message);
      console.error('Details:', error.response?.data || error);
      return false;
    }
  }

  async getAvailableSlots(date) {
    try {
      console.log(`📅 Getting available slots for: ${date} (Arizona MST)`);
      
      const targetDate = new Date(date);
      const dayOfWeek = targetDate.getDay();
      
      // Check if it's a business day
      if (!this.businessHours.days.includes(dayOfWeek)) {
        console.log('📅 Not a business day, no slots available');
        return [];
      }

      // Check if it's in the past
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (targetDate < today) {
        console.log('📅 Date is in the past, no slots available');
        return [];
      }

      // Get start and end of day in Arizona time
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Get existing events for the day
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
      
      for (const hour of this.businessHours.availableHours) {
        // Create slot time properly
        const slotStart = new Date(targetDate);
        slotStart.setHours(hour, 0, 0, 0);
        
        const slotEnd = new Date(targetDate);
        slotEnd.setHours(hour + 1, 0, 0, 0);
        
        // If it's today, only show future slots
        if (targetDate.toDateString() === today.toDateString()) {
          const now = new Date();
          const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
          
          if (slotStart <= oneHourFromNow) {
            console.log(`⏰ Skipping past/too-soon slot: ${hour}:00 MST`);
            continue;
          }
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
          
          console.log(`✅ Available slot: ${hour}:00 MST`);
        } else {
          console.log(`❌ Slot conflict at ${hour}:00 MST`);
        }
      }

      console.log(`✅ Generated ${availableSlots.length} available slots`);
      return availableSlots;

    } catch (error) {
      console.error('❌ Error getting calendar slots:', error.message);
      console.error('Details:', error.response?.data || error);
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
      // Return true to allow booking attempt anyway
      return true;
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

      // First, check if the slot is still available
      const isAvailable = await this.isSlotAvailable(eventDetails.startTime, eventDetails.endTime);
      if (!isAvailable) {
        console.log('❌ Slot no longer available');
        return {
          success: false,
          error: 'Slot no longer available',
          message: 'That time slot has been booked by someone else'
        };
      }

      // Create the event object
      const event = {
        summary: eventDetails.summary || 'Nexella AI Consultation Call',
        description: eventDetails.description || 'Discovery call scheduled via Nexella AI',
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
            displayName: eventDetails.attendeeName || eventDetails.attendeeEmail
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
            { method: 'email', minutes: 60 }
          ]
        }
      };

      console.log('📅 Sending event creation request to Google Calendar...');
      console.log('Event object:', JSON.stringify(event, null, 2));

      // Create the event
      const response = await this.calendar.events.insert({
        calendarId: this.calendarId,
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all'
      });

      const createdEvent = response.data;
      console.log('✅ Event created successfully!');
      console.log('📅 Event ID:', createdEvent.id);
      console.log('🔗 Event Link:', createdEvent.htmlLink);
      console.log('🎥 Meeting Link:', createdEvent.hangoutLink || createdEvent.conferenceData?.entryPoints?.[0]?.uri);

      // Extract meeting link
      const meetingLink = createdEvent.conferenceData?.entryPoints?.[0]?.uri || 
                         createdEvent.hangoutLink || 
                         '';

      // Format display time
      const startDate = new Date(eventDetails.startTime);
      const displayTime = startDate.toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: this.timezone
      });

      return {
        success: true,
        eventId: createdEvent.id,
        meetingLink: meetingLink,
        eventLink: createdEvent.htmlLink,
        message: 'Appointment created successfully',
        customerEmail: eventDetails.attendeeEmail,
        customerName: eventDetails.attendeeName,
        startTime: eventDetails.startTime,
        endTime: eventDetails.endTime,
        displayTime: displayTime
      };

    } catch (error) {
      console.error('❌ Error creating calendar event:', error.message);
      console.error('Error details:', error.response?.data || error);
      
      // Provide specific error messages
      if (error.response?.status === 401) {
        return {
          success: false,
          error: 'Authentication failed',
          message: 'Calendar authentication failed - check service account credentials'
        };
      } else if (error.response?.status === 403) {
        return {
          success: false,
          error: 'Permission denied',
          message: 'Calendar permissions insufficient - share calendar with service account'
        };
      } else if (error.response?.status === 404) {
        return {
          success: false,
          error: 'Calendar not found',
          message: 'Calendar not found - check GOOGLE_CALENDAR_ID'
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
      hasCalendar: !!this.calendar,
      serviceAccount: config.GOOGLE_CLIENT_EMAIL
    };
  }
}

module.exports = GoogleCalendarService;
