// google-calendar-service.js - REAL Google Calendar Integration Only - NO MOCK DATA
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

class GoogleCalendarService {
  constructor() {
    this.calendar = null;
    this.auth = null;
    this.calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    this.timezone = process.env.TIMEZONE || 'America/Phoenix'; // Arizona timezone
    
    // Business hours configuration
    this.businessHours = {
      start: 9, // 9 AM
      end: 17,  // 5 PM
      days: [1, 2, 3, 4, 5] // Monday to Friday (0 = Sunday, 6 = Saturday)
    };
    
    this.initialize();
  }

  async initialize() {
    try {
      console.log('🔧 Initializing REAL Google Calendar service...');
      
      // Try different authentication methods
      await this.setupAuthentication();
      
      if (this.auth) {
        this.calendar = google.calendar({ version: 'v3', auth: this.auth });
        console.log('✅ REAL Google Calendar service initialized successfully');
        
        // Test the connection
        await this.testConnection();
      } else {
        console.error('❌ Google Calendar authentication FAILED - Calendar features will NOT work');
        throw new Error('Calendar authentication required but not configured');
      }
    } catch (error) {
      console.error('❌ CRITICAL: Failed to initialize Google Calendar service:', error.message);
      console.error('❌ Calendar features are DISABLED. Fix authentication to enable scheduling.');
      throw error; // Don't allow fallback - require real calendar
    }
  }

  async setupAuthentication() {
    try {
      // Method 1: Individual Environment Variables (PRIMARY - for your setup)
      if (process.env.GOOGLE_PROJECT_ID && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CLIENT_EMAIL) {
        console.log('🔐 Using individual environment variables for authentication...');
        
        // Construct the service account object from individual env vars
        const serviceAccountKey = {
          type: "service_account",
          project_id: process.env.GOOGLE_PROJECT_ID,
          private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Fix newlines
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          client_id: process.env.GOOGLE_CLIENT_ID,
          auth_uri: "https://accounts.google.com/o/oauth2/auth",
          token_uri: "https://oauth2.googleapis.com/token",
          auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
          client_x509_cert_url: `https://www.googleapis.com/oauth2/v1/certs/${encodeURIComponent(process.env.GOOGLE_CLIENT_EMAIL)}`
        };
        
        console.log('📧 Using service account email:', serviceAccountKey.client_email);
        console.log('🏗️ Using project ID:', serviceAccountKey.project_id);
        
        this.auth = new google.auth.GoogleAuth({
          credentials: serviceAccountKey,
          scopes: ['https://www.googleapis.com/auth/calendar']
        });
        
        console.log('✅ Individual environment variables authentication configured');
        return;
      }

      // Method 2: Service Account JSON (Fallback)
      if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        console.log('🔐 Using Service Account JSON authentication...');
        const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
        
        this.auth = new google.auth.GoogleAuth({
          credentials: serviceAccountKey,
          scopes: ['https://www.googleapis.com/auth/calendar']
        });
        
        console.log('✅ Service Account JSON authentication configured');
        return;
      }

      // Method 3: Service Account from file (Development only)
      const serviceAccountPath = path.join(__dirname, 'service-account.json');
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

      // Method 4: OAuth2 (Development only)
      if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
        console.log('🔐 Using OAuth2 authentication...');
        
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          'urn:ietf:wg:oauth:2.0:oob'
        );

        oauth2Client.setCredentials({
          refresh_token: process.env.GOOGLE_REFRESH_TOKEN
        });

        this.auth = oauth2Client;
        console.log('✅ OAuth2 authentication configured');
        return;
      }

      throw new Error('CRITICAL: No valid Google Calendar authentication method found. Please check your environment variables.');
      
    } catch (error) {
      console.error('❌ Authentication setup FAILED:', error.message);
      console.log('🔍 Required environment variables:');
      console.log('   GOOGLE_PROJECT_ID:', !!process.env.GOOGLE_PROJECT_ID);
      console.log('   GOOGLE_PRIVATE_KEY:', !!process.env.GOOGLE_PRIVATE_KEY);
      console.log('   GOOGLE_CLIENT_EMAIL:', !!process.env.GOOGLE_CLIENT_EMAIL);
      console.log('   GOOGLE_CALENDAR_ID:', !!process.env.GOOGLE_CALENDAR_ID);
      throw error;
    }
  }

  async testConnection() {
    try {
      console.log('🧪 Testing REAL Google Calendar connection...');
      console.log('📅 Using calendar ID:', this.calendarId);
      
      const response = await this.calendar.calendars.get({
        calendarId: this.calendarId
      });
      
      console.log(`✅ Connected to REAL calendar: ${response.data.summary}`);
      console.log(`📅 Calendar ID: ${this.calendarId}`);
      console.log(`🌍 Timezone: ${response.data.timeZone || this.timezone}`);
      
      // Update timezone from calendar if available
      if (response.data.timeZone) {
        this.timezone = response.data.timeZone;
      }
      
      return true;
    } catch (error) {
      console.error('❌ REAL Calendar connection test FAILED:', error.message);
      if (error.message.includes('Not Found')) {
        console.error('🔍 Calendar not found. Check your GOOGLE_CALENDAR_ID and ensure the calendar is shared with the service account.');
      }
      throw error;
    }
  }

  // REAL CALENDAR ONLY: Get available time slots for a specific date
  async getAvailableSlots(date) {
    try {
      if (!this.calendar) {
        console.error('❌ CRITICAL: Calendar not initialized - cannot get slots');
        throw new Error('Calendar service not available - check authentication');
      }

      console.log(`📅 [REAL CALENDAR] Getting available slots for: ${date}`);
      
      const targetDate = new Date(date);
      const dayOfWeek = targetDate.getDay();
      
      console.log(`📅 Target date: ${targetDate.toDateString()}, Day of week: ${dayOfWeek}`);
      
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

      // Get start and end of day in timezone
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
          // Round up to next hour
          startOfDay.setMinutes(0, 0, 0);
          startOfDay.setHours(startOfDay.getHours() + 1);
        }
      }

      console.log(`🕐 [REAL CALENDAR] Checking from ${startOfDay.toLocaleString()} to ${endOfDay.toLocaleString()}`);

      // Get existing events for the day from REAL CALENDAR
      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const events = response.data.items || [];
      console.log(`📋 [REAL CALENDAR] Found ${events.length} existing events:`);
      
      // Debug: Log all existing events
      events.forEach((event, index) => {
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const eventEnd = new Date(event.end.dateTime || event.end.date);
        console.log(`   ${index + 1}. ${event.summary || 'No title'}: ${eventStart.toLocaleTimeString()} - ${eventEnd.toLocaleTimeString()}`);
      });

      // Generate available slots
      const availableSlots = [];
      const slotDuration = 60; // 60 minutes
      
      let currentTime = new Date(startOfDay);
      
      console.log(`🔄 [REAL CALENDAR] Generating slots from ${currentTime.toLocaleTimeString()}`);
      
      while (currentTime < endOfDay) {
        const slotEnd = new Date(currentTime.getTime() + slotDuration * 60 * 1000);
        
        // Check if this slot conflicts with any existing event
        const hasConflict = events.some(event => {
          const eventStart = new Date(event.start.dateTime || event.start.date);
          const eventEnd = new Date(event.end.dateTime || event.end.date);
          
          const conflict = (currentTime < eventEnd && slotEnd > eventStart);
          if (conflict) {
            console.log(`❌ Conflict found: ${currentTime.toLocaleTimeString()}-${slotEnd.toLocaleTimeString()} conflicts with ${event.summary}`);
          }
          return conflict;
        });

        if (!hasConflict) {
          const slot = {
            startTime: currentTime.toISOString(),
            endTime: slotEnd.toISOString(),
            displayTime: currentTime.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: this.timezone
            }),
            dateTime: currentTime.toISOString()
          };
          
          availableSlots.push(slot);
          console.log(`✅ Available slot: ${slot.displayTime}`);
        }

        // Move to next hour
        currentTime.setHours(currentTime.getHours() + 1);
      }

      console.log(`✅ [REAL CALENDAR] Generated ${availableSlots.length} available slots`);
      return availableSlots;

    } catch (error) {
      console.error('❌ [REAL CALENDAR] Error getting available slots:', error.message);
      console.error('❌ Full error:', error);
      throw error; // Don't return empty array - let caller handle the error
    }
  }

  // REAL CALENDAR ONLY: Check if a specific time slot is available
  async isSlotAvailable(startTime, endTime) {
    try {
      if (!this.calendar) {
        console.error('❌ CRITICAL: Calendar not initialized - cannot check availability');
        throw new Error('Calendar service not available - check authentication');
      }

      console.log(`🔍 [REAL CALENDAR] Checking if slot is available: ${startTime} to ${endTime}`);

      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startTime,
        timeMax: endTime,
        singleEvents: true
      });

      const events = response.data.items || [];
      const isAvailable = events.length === 0;
      
      console.log(`📊 [REAL CALENDAR] Slot availability: ${isAvailable ? 'Available ✅' : 'Booked ❌'}`);
      if (!isAvailable) {
        console.log(`📋 Conflicts with ${events.length} event(s):`, events.map(e => e.summary).join(', '));
      }
      
      return isAvailable;

    } catch (error) {
      console.error('❌ [REAL CALENDAR] Error checking slot availability:', error.message);
      throw error; // Don't fallback - require real calendar data
    }
  }

  // REAL CALENDAR ONLY: Create a calendar event
  async createEvent(eventDetails) {
    try {
      if (!this.calendar) {
        console.error('❌ CRITICAL: Calendar not initialized - cannot create event');
        throw new Error('Calendar service not available - check authentication');
      }

      console.log('📅 [REAL CALENDAR] Creating calendar event:', eventDetails);

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
            { method: 'email', minutes: 24 * 60 }, // 24 hours before
            { method: 'popup', minutes: 30 }       // 30 minutes before
          ]
        }
      };

      const response = await this.calendar.events.insert({
        calendarId: this.calendarId,
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all' // Send invitations to attendees
      });

      const createdEvent = response.data;
      
      console.log('✅ [REAL CALENDAR] Event created successfully:', createdEvent.id);
      console.log('📧 Calendar invitation sent to:', eventDetails.attendeeEmail);

      return {
        success: true,
        eventId: createdEvent.id,
        meetingLink: createdEvent.conferenceData?.entryPoints?.[0]?.uri || createdEvent.hangoutLink,
        eventLink: createdEvent.htmlLink,
        message: 'Event created and invitation sent'
      };

    } catch (error) {
      console.error('❌ [REAL CALENDAR] Error creating calendar event:', error.message);
      console.error('❌ Event creation failed for:', eventDetails.attendeeEmail);
      return {
        success: false,
        error: error.message,
        message: 'Failed to create calendar event'
      };
    }
  }

  // Parse time preference from user input
  parseTimePreference(userMessage, preferredDay) {
    console.log('🔍 Parsing time preference:', { userMessage, preferredDay });
    
    let targetDate = new Date();
    
    // Parse the day
    if (preferredDay.toLowerCase().includes('tomorrow')) {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (preferredDay.toLowerCase().includes('today')) {
      // Keep today
    } else if (preferredDay.toLowerCase().includes('next week')) {
      targetDate.setDate(targetDate.getDate() + 7);
    } else {
      // Try to parse specific day name
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayMatch = preferredDay.toLowerCase().match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
      
      if (dayMatch) {
        const requestedDayName = dayMatch[0];
        const requestedDayIndex = daysOfWeek.indexOf(requestedDayName);
        const currentDayIndex = targetDate.getDay();
        
        let daysToAdd = requestedDayIndex - currentDayIndex;
        if (daysToAdd <= 0) {
          daysToAdd += 7; // Next week
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

  // REAL CALENDAR ONLY: Get next 7 days of available slots
  async getUpcomingAvailableSlots(daysAhead = 7) {
    try {
      if (!this.calendar) {
        console.error('❌ CRITICAL: Calendar not initialized - cannot get upcoming slots');
        throw new Error('Calendar service not available - check authentication');
      }

      console.log(`📅 [REAL CALENDAR] Getting upcoming available slots for next ${daysAhead} days`);
      
      const allSlots = [];
      const today = new Date();
      
      for (let i = 0; i < daysAhead; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        
        try {
          const slots = await this.getAvailableSlots(date);
          if (slots.length > 0) {
            allSlots.push({
              date: date.toDateString(),
              dayName: date.toLocaleDateString('en-US', { weekday: 'long' }),
              slots: slots.slice(0, 3) // Limit to first 3 slots per day
            });
          }
        } catch (dayError) {
          console.error(`❌ Error getting slots for ${date.toDateString()}:`, dayError.message);
          // Continue to next day
        }
      }
      
      console.log(`✅ [REAL CALENDAR] Found available slots across ${allSlots.length} days`);
      return allSlots;
      
    } catch (error) {
      console.error('❌ [REAL CALENDAR] Error getting upcoming slots:', error.message);
      throw error; // Don't return empty array - let caller handle
    }
  }

  // REMOVED: All mock functions - Real calendar only
  // No getMockAvailableSlots or any mock functionality
  
  // Utility function to validate business hours
  isBusinessHours(dateTime) {
    const date = new Date(dateTime);
    const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
    const hour = date.getHours();
    
    // Monday to Friday (1-5), 9 AM to 5 PM
    return this.businessHours.days.includes(dayOfWeek) && 
           hour >= this.businessHours.start && 
           hour < this.businessHours.end;
  }

  // Get business hours for a specific day
  getBusinessHoursForDay(date) {
    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getDay();
    
    if (!this.businessHours.days.includes(dayOfWeek)) {
      return null; // Not a business day
    }
    
    const startTime = new Date(targetDate);
    startTime.setHours(this.businessHours.start, 0, 0, 0);
    
    const endTime = new Date(targetDate);
    endTime.setHours(this.businessHours.end, 0, 0, 0);
    
    return {
      start: startTime,
      end: endTime,
      dayName: targetDate.toLocaleDateString('en-US', { weekday: 'long' })
    };
  }

  // Check if calendar service is properly initialized
  isInitialized() {
    return !!(this.calendar && this.auth);
  }

  // Get calendar info
  getCalendarInfo() {
    return {
      calendarId: this.calendarId,
      timezone: this.timezone,
      businessHours: this.businessHours,
      initialized: this.isInitialized()
    };
  }
}

module.exports = GoogleCalendarService;
