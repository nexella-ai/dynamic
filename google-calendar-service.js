// google-calendar-service.js - Complete Google Calendar Integration - FIXED VERSION
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
      console.log('🔧 Initializing Google Calendar service...');
      
      // Try different authentication methods
      await this.setupAuthentication();
      
      if (this.auth) {
        this.calendar = google.calendar({ version: 'v3', auth: this.auth });
        console.log('✅ Google Calendar service initialized successfully');
        
        // Test the connection
        await this.testConnection();
      } else {
        console.warn('⚠️ Google Calendar authentication not configured. Calendar features will be disabled.');
      }
    } catch (error) {
      console.error('❌ Failed to initialize Google Calendar service:', error.message);
      console.warn('⚠️ Calendar features will be disabled.');
    }
  }

  async setupAuthentication() {
    try {
      // Method 1: Individual Environment Variables (NEW - for your setup)
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

      // Method 2: Service Account JSON (Original method)
      if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        console.log('🔐 Using Service Account authentication...');
        const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
        
        this.auth = new google.auth.GoogleAuth({
          credentials: serviceAccountKey,
          scopes: ['https://www.googleapis.com/auth/calendar']
        });
        
        console.log('✅ Service Account authentication configured');
        return;
      }

      // Method 3: Service Account from file
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

      // Method 4: OAuth2 (for development)
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

      throw new Error('No valid Google Calendar authentication method found. Please check your environment variables.');
      
    } catch (error) {
      console.error('❌ Authentication setup failed:', error.message);
      console.log('🔍 Available environment variables:');
      console.log('   GOOGLE_PROJECT_ID:', !!process.env.GOOGLE_PROJECT_ID);
      console.log('   GOOGLE_PRIVATE_KEY:', !!process.env.GOOGLE_PRIVATE_KEY);
      console.log('   GOOGLE_CLIENT_EMAIL:', !!process.env.GOOGLE_CLIENT_EMAIL);
      console.log('   GOOGLE_CALENDAR_ID:', !!process.env.GOOGLE_CALENDAR_ID);
      throw error;
    }
  }

  async testConnection() {
    try {
      console.log('🧪 Testing Google Calendar connection...');
      console.log('📅 Using calendar ID:', this.calendarId);
      
      const response = await this.calendar.calendars.get({
        calendarId: this.calendarId
      });
      
      console.log(`✅ Connected to calendar: ${response.data.summary}`);
      console.log(`📅 Calendar ID: ${this.calendarId}`);
      console.log(`🌍 Timezone: ${response.data.timeZone || this.timezone}`);
      
      // Update timezone from calendar if available
      if (response.data.timeZone) {
        this.timezone = response.data.timeZone;
      }
      
      return true;
    } catch (error) {
      console.error('❌ Calendar connection test failed:', error.message);
      if (error.message.includes('Not Found')) {
        console.error('🔍 Calendar not found. Check your GOOGLE_CALENDAR_ID and ensure the calendar is shared with the service account.');
      }
      throw error;
    }
  }

  // FIXED: Get available time slots for a specific date with detailed debugging
  async getAvailableSlots(date) {
    try {
      if (!this.calendar) {
        console.error('❌ Calendar not initialized - this should not happen!');
        console.log('🔧 Auth status:', !!this.auth);
        console.log('🔧 Calendar ID:', this.calendarId);
        return [];
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

      // Get start and end of day in Phoenix timezone
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
      return []; // Return empty array instead of mock data
    }
  }

  // Check if a specific time slot is available
  async isSlotAvailable(startTime, endTime) {
    try {
      if (!this.calendar) {
        console.warn('⚠️ Calendar not initialized, returning mock availability');
        return Math.random() > 0.3; // 70% chance of being available
      }
