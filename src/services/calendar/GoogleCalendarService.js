// src/services/calendar/GoogleCalendarService.js - Google Calendar Integration
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const config = require('../../config/environment');

class GoogleCalendarService {
  constructor() {
    this.calendar = null;
    this.auth = null;
    this.calendarId = config.GOOGLE_CALENDAR_ID;
    this.timezone = config.TIMEZONE;
    
    // Business hours configuration
    this.businessHours = {
      start: 9, // 9 AM
      end: 17,  // 5 PM
      days: [1, 2, 3, 4, 5] // Monday to Friday (0 = Sunday, 6 = Saturday)
    };
    
    console.log('🔧 GoogleCalendarService constructor called');
  }

  async initialize() {
    try {
      console.log('🔧 Initializing Google Calendar service...');
      console.log('🔍 Environment Variable Check:');
      console.log('   GOOGLE_PROJECT_ID:', config.GOOGLE_PROJECT_ID ? '✅ SET' : '❌ MISSING');
      console.log('   GOOGLE_PRIVATE_KEY:', config.GOOGLE_PRIVATE_KEY ? '✅ SET' : '❌ MISSING');
      console.log('   GOOGLE_CLIENT_EMAIL:', config.GOOGLE_CLIENT_EMAIL ? '✅ SET' : '❌ MISSING');
      console.log('   GOOGLE_CALENDAR_ID:', config.GOOGLE_CALENDAR_ID ? '✅ SET' : '❌ MISSING');
      
      // Check if we have the minimum required variables
      if (!config.GOOGLE_PROJECT_ID || !config.GOOGLE_PRIVATE_KEY || !config.GOOGLE_CLIENT_EMAIL) {
        console.error('❌ Missing required Google Calendar environment variables');
        console.log('⚠️ Calendar service will be DISABLED - falling back to manual scheduling');
        return false; // Don't throw error, just disable calendar
      }
      
      await this.setupAuthentication();
      
      if (this.auth) {
        this.calendar = google.calendar({ version: 'v3', auth: this.auth });
        console.log('✅ Google Calendar service initialized successfully');
        
        // Test the connection
        const testResult = await this.testConnection();
        return testResult;
      } else {
        console.warn('⚠️ Google Calendar authentication failed - calendar disabled');
        return false;
      }
    } catch (error) {
      console.error('❌ Failed to initialize Google Calendar service:', error.message);
      console.warn('⚠️ Calendar features will be disabled - manual scheduling only');
      return false; // Don't crash the server
    }
  }

  async setupAuthentication() {
    try {
      console.log('🔐 Setting up Google Calendar authentication...');
      
      // Check private key format
      if (config.GOOGLE_PRIVATE_KEY) {
        const privateKey = config.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
        console.log('🔑 Private key format check:', privateKey.includes('-----BEGIN PRIVATE KEY-----') ? '✅ Valid' : '❌ Invalid');
      }
      
      // Method 1: Individual Environment Variables
      if (config.GOOGLE_PROJECT_ID && config.GOOGLE_PRIVATE_KEY && config.GOOGLE_CLIENT_EMAIL) {
        console.log('🔐 Using individual environment variables...');
        
        const serviceAccountKey = {
          type: "service_account",
          project_id: config.GOOGLE_PROJECT_ID,
          private_key_id: config.GOOGLE_PRIVATE_KEY_ID || "dummy_key_id",
          private_key: config.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          client_email: config.GOOGLE_CLIENT_EMAIL,
          client_id: config.GOOGLE_CLIENT_ID || "dummy_client_id",
          auth_uri: "https://accounts.google.com/o/oauth2/auth",
          token_uri: "https://oauth2.googleapis.com/token",
          auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
          client_x509_cert_url: `https://www.googleapis.com/oauth2/v1/certs/${encodeURIComponent(config.GOOGLE_CLIENT_EMAIL)}`
        };
        
        console.log('📧 Service account email:', serviceAccountKey.client_email);
        console.log('🏗️ Project ID:', serviceAccountKey.project_id);
        
        this.auth = new google.auth.GoogleAuth({
          credentials: serviceAccountKey,
          scopes: ['https://www.googleapis.com/auth/calendar']
        });
        
        console.log('✅ Authentication configured successfully');
        return;
      }

      // Method 2: Service Account JSON (Fallback)
      if (config.GOOGLE_SERVICE_ACCOUNT_KEY) {
        console.log('🔐 Using Service Account JSON...');
        const serviceAccountKey = JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_KEY);
        
        this.auth = new google.auth.GoogleAuth({
          credentials: serviceAccountKey,
          scopes: ['https://www.googleapis.com/auth/calendar']
        });
        
        console.log('✅ Service Account JSON authentication configured');
        return;
      }

      // Method 3: Service Account from file (Development)
      const serviceAccountPath = path.join(__dirname, '../../../service-account.json');
      try {
        await fs.access(serviceAccountPath);
        console.log('🔐 Using Service Account from file...');
        
        this.auth = new google.auth.GoogleAuth({
          keyFile: serviceAccountPath,
          scopes: ['https://www.googleapis.com/auth/calendar']
        });
        
        console.log('✅ Service Account file authentication configured');
        return;
      } catch (fileError) {
        console.log('ℹ️ No service account file found');
      }

      // Method 4: OAuth2 (Development)
      if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REFRESH_TOKEN) {
        console.log('🔐 Using OAuth2 authentication...');
        
        const oauth2Client = new google.auth.OAuth2(
          config.GOOGLE_CLIENT_ID,
          config.GOOGLE_CLIENT_SECRET,
          'urn:ietf:wg:oauth:2.0:oob'
        );

        oauth2Client.setCredentials({
          refresh_token: config.GOOGLE_REFRESH_TOKEN
        });

        this.auth = oauth2Client;
        console.log('✅ OAuth2 authentication configured');
        return;
      }

      throw new Error('Required environment variables not found');
      
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
      
      console.log(`✅ Connected to calendar: ${response.data.summary}`);
      console.log(`📅 Calendar ID: ${this.calendarId}`);
      console.log(`🌍 Timezone: ${response.data.timeZone || this.timezone}`);
      
      if (response.data.timeZone) {
        this.timezone = response.data.timeZone;
      }
      
      return true;
    } catch (error) {
      console.error('❌ Calendar connection test failed:', error.message);
      if (error.message.includes('Not Found')) {
        console.error('🔍 Calendar not found. Check GOOGLE_CALENDAR_ID and calendar sharing settings.');
      }
      return false;
    }
  }

  // Safe method that returns mock data if calendar isn't available
  async getAvailableSlots(date) {
    try {
      if (!this.calendar) {
        console.log('⚠️ Calendar not available, generating mock slots for demo');
        return this.generateMockSlots(date);
      }

      console.log(`📅 [REAL CALENDAR] Getting available slots for: ${date}`);
      
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

      // Get start and end of day
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(this.businessHours.start, 0, 0, 0);
      
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(this.businessHours.end, 0, 0, 0);

      // If it's today, start from current time + 1 hour
      if (targetDate.toDateString() === today.toDateString()) {
        const now = new Date();
        const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
        if (oneHourFromNow > startOfDay) {
          startOfDay.setTime(oneHourFromNow.getTime());
          startOfDay.setMinutes(0, 0, 0);
          startOfDay.setHours(startOfDay.getHours() + 1);
        }
      }

      // Get existing events
      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const events = response.data.items || [];
      console.log(`📋 [REAL CALENDAR] Found ${events.length} existing events`);

      // Generate available slots
      const availableSlots = [];
      let currentTime = new Date(startOfDay);
      
      while (currentTime < endOfDay) {
        const slotEnd = new Date(currentTime.getTime() + 60 * 60 * 1000);
        
        const hasConflict = events.some(event => {
          const eventStart = new Date(event.start.dateTime || event.start.date);
          const eventEnd = new Date(event.end.dateTime || event.end.date);
          return (currentTime < eventEnd && slotEnd > eventStart);
        });

        if (!hasConflict) {
          availableSlots.push({
            startTime: currentTime.toISOString(),
            endTime: slotEnd.toISOString(),
            displayTime: currentTime.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: this.timezone
            })
          });
        }

        currentTime.setHours(currentTime.getHours() + 1);
      }

      console.log(`✅ [REAL CALENDAR] Generated ${availableSlots.length} available slots`);
      return availableSlots;

    } catch (error) {
      console.error('❌ Error getting real calendar slots:', error.message);
      console.log('⚠️ Falling back to mock slots for demo');
      return this.generateMockSlots(date);
    }
  }

  // Generate realistic mock slots for demo when calendar isn't available
  generateMockSlots(date) {
    console.log('🎭 Generating mock slots for demo purposes');
    
    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getDay();
    
    // No slots on weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return [];
    }
    
    // Check if it's in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (targetDate < today) {
      return [];
    }
    
    const slots = [];
    
    // Generate 3-4 available slots for demo
    const availableHours = [10, 11, 14, 15]; // 10 AM, 11 AM, 2 PM, 3 PM
    
    availableHours.forEach(h => {
      const slotTime = new Date(targetDate);
      slotTime.setHours(h, 0, 0, 0);
      
      // If it's today, only show future times
      if (targetDate.toDateString() === today.toDateString()) {
        const now = new Date();
        if (slotTime <= now) return;
      }
      
      const endTime = new Date(slotTime);
      endTime.setHours(h + 1);
      
      slots.push({
        startTime: slotTime.toISOString(),
        endTime: endTime.toISOString(),
        displayTime: slotTime.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: this.timezone
        })
      });
    });
    
    console.log(`🎭 Generated ${slots.length} mock demo slots`);
    return slots;
  }

  async isSlotAvailable(startTime, endTime) {
    try {
      if (!this.calendar) {
        console.log('⚠️ Calendar not available, returning mock availability');
        // For demo: make most times available, but block some for realism
        const hour = new Date(startTime).getHours();
        return ![13, 16].includes(hour); // Block 1 PM and 4 PM for demo
      }

      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startTime,
        timeMax: endTime,
        singleEvents: true
      });

      const events = response.data.items || [];
      const isAvailable = events.length === 0;
      
      console.log(`📊 [REAL CALENDAR] Slot availability: ${isAvailable ? 'Available ✅' : 'Booked ❌'}`);
      return isAvailable;

    } catch (error) {
      console.error('❌ Error checking slot availability:', error.message);
      return true; // Default to available for demo
    }
  }

  async createEvent(eventDetails) {
    try {
      if (!this.calendar) {
        console.log('⚠️ Calendar not available, simulating event creation');
        return {
          success: true,
          eventId: `demo_event_${Date.now()}`,
          meetingLink: 'https://meet.google.com/demo-meeting-link',
          eventLink: `https://calendar.google.com/event?demo=${Date.now()}`,
          message: 'Demo booking created (calendar not configured)'
        };
      }

      console.log('📅 [REAL CALENDAR] Creating event:', eventDetails.summary);

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
            requestId: `meet_${Date.now()}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet'
            }
          }
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 },
            { method: 'popup', minutes: 30 }
          ]
        }
      };

      const response = await this.calendar.events.insert({
        calendarId: this.calendarId,
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all'
      });

      const createdEvent = response.data;
      console.log('✅ [REAL CALENDAR] Event created:', createdEvent.id);

      return {
        success: true,
        eventId: createdEvent.id,
        meetingLink: createdEvent.conferenceData?.entryPoints?.[0]?.uri || createdEvent.hangoutLink,
        eventLink: createdEvent.htmlLink,
        message: 'Event created and invitation sent'
      };

    } catch (error) {
      console.error('❌ Error creating calendar event:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'Failed to create calendar event'
      };
    }
  }

  parseTimePreference(userMessage, preferredDay) {
    let targetDate = new Date();
    
    if (preferredDay.toLowerCase().includes('tomorrow')) {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (preferredDay.toLowerCase().includes('today')) {
      // Keep today
    } else if (preferredDay.toLowerCase().includes('next week')) {
      targetDate.setDate(targetDate.getDate() + 7);
    } else {
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayMatch = preferredDay.toLowerCase().match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
      
      if (dayMatch) {
        const requestedDayName = dayMatch[0];
        const requestedDayIndex = daysOfWeek.indexOf(requestedDayName);
        const currentDayIndex = targetDate.getDay();
        
        let daysToAdd = requestedDayIndex - currentDayIndex;
        if (daysToAdd <= 0) {
          daysToAdd += 7;
        }
        
        targetDate.setDate(targetDate.getDate() + daysToAdd);
      }
    }
    
    // Parse time
    let preferredHour = 10; // Default 10 AM
    const timeMatch = preferredDay.match(/(\d{1,2})\s*(am|pm)/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      const period = timeMatch[2].toLowerCase();
      
      if (period === 'pm' && hour !== 12) {
        hour += 12;
      } else if (period === 'am' && hour === 12) {
        hour = 0;
      }
      
      preferredHour = hour;
    } else if (preferredDay.toLowerCase().includes('morning')) {
      preferredHour = 10;
    } else if (preferredDay.toLowerCase().includes('afternoon')) {
      preferredHour = 14;
    } else if (preferredDay.toLowerCase().includes('evening')) {
      preferredHour = 16;
    }
    
    targetDate.setHours(preferredHour, 0, 0, 0);
    
    return {
      preferredDateTime: targetDate,
      dayName: preferredDay,
      hour: preferredHour
    };
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