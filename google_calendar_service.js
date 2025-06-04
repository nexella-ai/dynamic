// google-calendar-service.js - NEW FILE
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');

class GoogleCalendarService {
  constructor() {
    this.calendar = null;
    this.init();
  }

  init() {
    try {
      // Create JWT auth
      const auth = new google.auth.GoogleAuth({
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

      this.calendar = google.calendar({ version: 'v3', auth });
      console.log('✅ Google Calendar service initialized');
    } catch (error) {
      console.error('❌ Error initializing Google Calendar service:', error);
    }
  }

  // Get available time slots for a specific date
  async getAvailableSlots(date, duration = 30) {
    try {
      const targetDate = new Date(date);
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(9, 0, 0, 0); // 9 AM start
      
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(17, 0, 0, 0); // 5 PM end

      console.log(`🔍 Checking availability for ${targetDate.toDateString()}`);

      // Get existing events for the day
      const response = await this.calendar.events.list({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const existingEvents = response.data.items || [];
      console.log(`📅 Found ${existingEvents.length} existing events`);

      // Generate potential time slots (every 30 minutes from 9 AM to 5 PM)
      const availableSlots = [];
      const current = new Date(startOfDay);

      while (current < endOfDay) {
        const slotEnd = new Date(current.getTime() + duration * 60000);
        
        // Check if this slot conflicts with any existing event
        const hasConflict = existingEvents.some(event => {
          const eventStart = new Date(event.start.dateTime || event.start.date);
          const eventEnd = new Date(event.end.dateTime || event.end.date);
          
          return (current < eventEnd && slotEnd > eventStart);
        });

        if (!hasConflict) {
          availableSlots.push({
            startTime: current.toISOString(),
            endTime: slotEnd.toISOString(),
            displayTime: current.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            })
          });
        }

        current.setMinutes(current.getMinutes() + 30); // 30-minute intervals
      }

      console.log(`✅ Found ${availableSlots.length} available slots`);
      return availableSlots;
    } catch (error) {
      console.error('❌ Error getting available slots:', error);
      return [];
    }
  }

  // Check if a specific time slot is available
  async isSlotAvailable(startTime, endTime) {
    try {
      const response = await this.calendar.events.list({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        timeMin: startTime,
        timeMax: endTime,
        singleEvents: true
      });

      const conflicts = response.data.items || [];
      return conflicts.length === 0;
    } catch (error) {
      console.error('❌ Error checking slot availability:', error);
      return false;
    }
  }

  // Create a calendar event
  async createEvent(eventDetails) {
    try {
      const { 
        summary = 'Nexella AI Consultation',
        description = '',
        startTime,
        endTime,
        attendeeEmail,
        attendeeName = 'Guest'
      } = eventDetails;

      const event = {
        summary,
        description: `Meeting with ${attendeeName}\n\n${description}`,
        start: {
          dateTime: startTime,
          timeZone: 'America/Los_Angeles' // Adjust to your timezone
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

      const response = await this.calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        resource: event,
        conferenceDataVersion: 1,
        sendNotifications: true
      });

      console.log('✅ Calendar event created:', response.data.id);
      
      return {
        success: true,
        eventId: response.data.id,
        meetingLink: response.data.conferenceData?.entryPoints?.[0]?.uri || '',
        eventLink: response.data.htmlLink
      };
    } catch (error) {
      console.error('❌ Error creating calendar event:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Parse user input for preferred times
  parseTimePreference(userInput, preferredDay) {
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
    
    return {
      preferredDateTime: targetDate,
      preferredHour,
      dayName: targetDate.toLocaleDateString('en-US', { weekday: 'long' })
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

module.exports = GoogleCalendarService;