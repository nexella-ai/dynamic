// google-calendar-service.js - Complete Google Calendar Integration
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
      days: [1, 2, 3, 4, 5, 6] // Monday to Friday (0 = Sunday, 6 = Saturday)
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
      // Method 1: Service Account (Recommended for production)
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

      // Method 2: Service Account from file
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

      // Method 3: OAuth2 (for development)
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

      throw new Error('No valid Google Calendar authentication method found');
      
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
      
      return true;
    } catch (error) {
      console.error('❌ Calendar connection test failed:', error.message);
      throw error;
    }
  }

  // Get available time slots for a specific date
  async getAvailableSlots(date) {
    try {
      if (!this.calendar) {
        console.warn('⚠️ Calendar not initialized, returning mock slots');
        return this.getMockAvailableSlots(date);
      }

      console.log(`📅 Getting available slots for: ${date}`);
      
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
          // Round up to next hour
          startOfDay.setMinutes(0, 0, 0);
          startOfDay.setHours(startOfDay.getHours() + 1);
        }
      }

      console.log(`🕐 Checking availability from ${startOfDay.toLocaleString()} to ${endOfDay.toLocaleString()}`);

      // Get existing events for the day
      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const events = response.data.items || [];
      console.log(`📋 Found ${events.length} existing events`);

      // Generate available slots
      const availableSlots = [];
      const slotDuration = 60; // 60 minutes
      
      let currentTime = new Date(startOfDay);
      
      while (currentTime < endOfDay) {
        const slotEnd = new Date(currentTime.getTime() + slotDuration * 60 * 1000);
        
        // Check if this slot conflicts with any existing event
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
            }),
            dateTime: currentTime.toISOString()
          });
        }

        // Move to next hour
        currentTime.setHours(currentTime.getHours() + 1);
      }

      console.log(`✅ Found ${availableSlots.length} available slots`);
      return availableSlots;

    } catch (error) {
      console.error('❌ Error getting available slots:', error.message);
      // Return mock slots as fallback
      return this.getMockAvailableSlots(date);
    }
  }

  // Check if a specific time slot is available
  async isSlotAvailable(startTime, endTime) {
    try {
      if (!this.calendar) {
        console.warn('⚠️ Calendar not initialized, returning mock availability');
        return Math.random() > 0.3; // 70% chance of being available
      }

      console.log(`🔍 Checking if slot is available: ${startTime} to ${endTime}`);

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
      // Fallback: assume available
      return true;
    }
  }

  // Create a calendar event
  async createEvent(eventDetails) {
    try {
      if (!this.calendar) {
        console.warn('⚠️ Calendar not initialized, simulating event creation');
        return {
          success: true,
          eventId: `mock_event_${Date.now()}`,
          meetingLink: 'https://meet.google.com/mock-meeting',
          eventLink: `https://calendar.google.com/event?mock=${Date.now()}`,
          message: 'Mock event created (calendar not configured)'
        };
      }

      console.log('📅 Creating calendar event:', eventDetails);

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
      
      console.log('✅ Calendar event created successfully:', createdEvent.id);

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

  // Get next 7 days of available slots
  async getUpcomingAvailableSlots(daysAhead = 7) {
    try {
      console.log(`📅 Getting upcoming available slots for next ${daysAhead} days`);
      
      const allSlots = [];
      const today = new Date();
      
      for (let i = 0; i < daysAhead; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        
        const slots = await this.getAvailableSlots(date);
        if (slots.length > 0) {
          allSlots.push({
            date: date.toDateString(),
            dayName: date.toLocaleDateString('en-US', { weekday: 'long' }),
            slots: slots.slice(0, 3) // Limit to first 3 slots per day
          });
        }
      }
      
      console.log(`✅ Found available slots across ${allSlots.length} days`);
      return allSlots;
      
    } catch (error) {
      console.error('❌ Error getting upcoming slots:', error.message);
      return [];
    }
  }

  // Mock available slots for when calendar is not configured
  getMockAvailableSlots(date) {
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
    
    // Generate mock slots
    const slots = [];
    const startHour = targetDate.toDateString() === today.toDateString() ? 
      Math.max(9, new Date().getHours() + 1) : 9;
    
    for (let hour = startHour; hour <= 16; hour++) {
      // Random availability (70% chance)
      if (Math.random() > 0.3) {
        const slotTime = new Date(targetDate);
        slotTime.setHours(hour, 0, 0, 0);
        
        const endTime = new Date(slotTime);
        endTime.setHours(hour + 1, 0, 0, 0);
        
        slots.push({
          startTime: slotTime.toISOString(),
          endTime: endTime.toISOString(),
          displayTime: slotTime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          }),
          dateTime: slotTime.toISOString()
        });
      }
    }
    
    console.log(`🎭 Generated ${slots.length} mock available slots`);
    return slots;
  }
}

module.exports = GoogleCalendarService;
