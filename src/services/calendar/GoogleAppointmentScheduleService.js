// src/services/calendar/GoogleAppointmentScheduleService.js - Use Appointment Schedule
const { google } = require('googleapis');
const config = require('../../config/environment');

class GoogleAppointmentScheduleService {
  constructor() {
    this.calendar = null;
    this.auth = null;
    this.timezone = config.TIMEZONE || 'America/Phoenix';
    
    // Extract schedule ID from the URL
    this.scheduleId = this.extractScheduleId(config.GOOGLE_APPOINTMENT_SCHEDULE_URL);
    
    console.log('🔧 GoogleAppointmentScheduleService constructor called');
    console.log('📅 Schedule ID:', this.scheduleId);
  }

  extractScheduleId(url) {
    if (!url) return null;
    
    // Extract from URL like: https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ1-X85n75lz94LdlcSf5CMe2WJLxb7sML9AaKD2I7O7OaIkvdxuDUEEKEkQ7loxtQfRxsVnK__u
    const match = url.match(/schedules\/([^\/\?]+)/);
    return match ? match[1] : null;
  }

  async initialize() {
    try {
      console.log('🔧 Initializing Google Appointment Schedule service...');
      console.log('🔍 Environment Variable Check:');
      console.log('   GOOGLE_PROJECT_ID:', config.GOOGLE_PROJECT_ID ? '✅ SET' : '❌ MISSING');
      console.log('   GOOGLE_PRIVATE_KEY:', config.GOOGLE_PRIVATE_KEY ? '✅ SET' : '❌ MISSING');
      console.log('   GOOGLE_CLIENT_EMAIL:', config.GOOGLE_CLIENT_EMAIL ? '✅ SET' : '❌ MISSING');
      console.log('   GOOGLE_APPOINTMENT_SCHEDULE_URL:', config.GOOGLE_APPOINTMENT_SCHEDULE_URL ? '✅ SET' : '❌ MISSING');
      
      if (!this.scheduleId) {
        console.error('❌ No valid appointment schedule ID found in URL');
        return false;
      }
      
      // Check if we have the minimum required variables
      if (!config.GOOGLE_PROJECT_ID || !config.GOOGLE_PRIVATE_KEY || !config.GOOGLE_CLIENT_EMAIL) {
        console.error('❌ Missing required Google Calendar environment variables');
        return false;
      }
      
      await this.setupAuthentication();
      
      if (this.auth) {
        this.calendar = google.calendar({ version: 'v3', auth: this.auth });
        console.log('✅ Google Appointment Schedule service initialized successfully');
        
        // Test the connection
        const testResult = await this.testConnection();
        return testResult;
      } else {
        console.warn('⚠️ Google Calendar authentication failed');
        return false;
      }
    } catch (error) {
      console.error('❌ Failed to initialize Google Appointment Schedule service:', error.message);
      return false;
    }
  }

  async setupAuthentication() {
    try {
      console.log('🔐 Setting up Google Calendar authentication...');
      
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
        scopes: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.appointments'
        ]
      });
      
      console.log('✅ Authentication configured successfully with appointment permissions');
      return;
      
    } catch (error) {
      console.error('❌ Authentication setup failed:', error.message);
      throw error;
    }
  }

  async testConnection() {
    try {
      console.log('🧪 Testing Google Appointment Schedule connection...');
      
      // Try to get appointment schedule info
      const response = await this.calendar.appointmentSchedules.get({
        name: `calendars/primary/appointmentSchedules/${this.scheduleId}`
      });
      
      console.log(`✅ Connected to appointment schedule: ${response.data.displayName || 'Unnamed Schedule'}`);
      console.log(`📅 Schedule ID: ${this.scheduleId}`);
      console.log(`🌍 Timezone: ${response.data.timeZone || this.timezone}`);
      
      if (response.data.timeZone) {
        this.timezone = response.data.timeZone;
      }
      
      return true;
    } catch (error) {
      console.error('❌ Appointment schedule connection test failed:', error.message);
      console.error('🔍 This might be because:');
      console.error('   1. The schedule ID is incorrect');
      console.error('   2. The service account needs appointment permissions');
      console.error('   3. The schedule is not publicly accessible');
      return false;
    }
  }

  async getAvailableSlots(date) {
    try {
      if (!this.calendar || !this.scheduleId) {
        console.log('⚠️ Appointment schedule not available');
        return [];
      }

      console.log(`📅 [APPOINTMENT SCHEDULE] Getting available slots for: ${date}`);
      
      const targetDate = new Date(date);
      
      // Check if it's in the past
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (targetDate < today) {
        console.log('📅 Date is in the past, no slots available');
        return [];
      }

      // Get start and end of day
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      console.log(`🕐 [APPOINTMENT SCHEDULE] Checking from ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);

      try {
        // Get available time slots from the appointment schedule
        const response = await this.calendar.appointmentSchedules.getAvailabilitySlots({
          name: `calendars/primary/appointmentSchedules/${this.scheduleId}`,
          timeMin: startOfDay.toISOString(),
          timeMax: endOfDay.toISOString()
        });

        const slots = response.data.slots || [];
        console.log(`📋 [APPOINTMENT SCHEDULE] Found ${slots.length} available slots`);

        const availableSlots = slots.map(slot => {
          const startTime = new Date(slot.startTime);
          return {
            startTime: slot.startTime,
            endTime: slot.endTime,
            displayTime: startTime.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: this.timezone
            })
          };
        });

        console.log(`✅ [APPOINTMENT SCHEDULE] Generated ${availableSlots.length} formatted slots`);
        availableSlots.forEach((slot, index) => {
          console.log(`   ${index + 1}. ${slot.displayTime}`);
        });

        return availableSlots;

      } catch (apiError) {
        console.error('❌ Error calling appointment schedule API:', apiError.message);
        
        // Fallback: Generate reasonable business hour slots if API fails
        console.log('🔄 Falling back to business hour generation for appointment schedule');
        return this.generateBusinessHourSlots(targetDate);
      }

    } catch (error) {
      console.error('❌ Error getting appointment schedule slots:', error.message);
      return [];
    }
  }

  generateBusinessHourSlots(targetDate) {
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
    
    // Generate slots every hour from 8 AM to 4 PM (business hours)
    const availableHours = [8, 9, 10, 11, 12, 13, 14, 15, 16]; // 8 AM to 4 PM
    
    availableHours.forEach(hour => {
      const slotTime = new Date(targetDate);
      slotTime.setHours(hour, 0, 0, 0);
      
      // If it's today, only show future times
      if (targetDate.toDateString() === today.toDateString()) {
        const now = new Date();
        if (slotTime <= now) return;
      }
      
      const endTime = new Date(slotTime);
      endTime.setHours(hour + 1);
      
      // Convert to proper display format
      let displayHour = hour;
      let period = 'AM';
      
      if (hour === 0) {
        displayHour = 12;
        period = 'AM';
      } else if (hour === 12) {
        displayHour = 12;
        period = 'PM';
      } else if (hour > 12) {
        displayHour = hour - 12;
        period = 'PM';
      }
      
      slots.push({
        startTime: slotTime.toISOString(),
        endTime: endTime.toISOString(),
        displayTime: `${displayHour}:00 ${period}`
      });
    });
    
    console.log(`🔄 Generated ${slots.length} fallback business hour slots`);
    return slots;
  }

  async isSlotAvailable(startTime, endTime) {
    try {
      if (!this.calendar || !this.scheduleId) {
        console.log('⚠️ Appointment schedule not available for availability check');
        return true; // Assume available if we can't check
      }

      // For appointment schedules, we check if the slot exists in available slots
      const date = new Date(startTime).toDateString();
      const availableSlots = await this.getAvailableSlots(date);
      
      const isAvailable = availableSlots.some(slot => 
        slot.startTime === startTime && slot.endTime === endTime
      );
      
      console.log(`📊 [APPOINTMENT SCHEDULE] Slot availability: ${isAvailable ? 'Available ✅' : 'Not Available ❌'}`);
      return isAvailable;

    } catch (error) {
      console.error('❌ Error checking appointment schedule slot availability:', error.message);
      return true; // Assume available if we can't check
    }
  }

  async createAppointment(appointmentDetails) {
    try {
      if (!this.calendar || !this.scheduleId) {
        console.log('⚠️ Appointment schedule not available, cannot create appointment');
        return {
          success: false,
          error: 'Appointment schedule not available',
          message: 'Cannot create appointment - schedule not configured'
        };
      }

      console.log('📅 [APPOINTMENT SCHEDULE] Creating appointment:', appointmentDetails.summary);

      const appointment = {
        summary: appointmentDetails.summary || 'Nexella AI Consultation Call',
        description: appointmentDetails.description || 'Discovery call scheduled via Nexella AI',
        startTime: appointmentDetails.startTime,
        endTime: appointmentDetails.endTime,
        attendee: {
          displayName: appointmentDetails.attendeeName,
          email: appointmentDetails.attendeeEmail
        }
      };

      const response = await this.calendar.appointmentSchedules.createAppointment({
        parent: `calendars/primary/appointmentSchedules/${this.scheduleId}`,
        requestBody: appointment
      });

      const createdAppointment = response.data;
      console.log('✅ [APPOINTMENT SCHEDULE] Appointment created:', createdAppointment.name);

      return {
        success: true,
        appointmentId: createdAppointment.name,
        meetingLink: createdAppointment.meetingLink,
        message: 'Appointment created successfully',
        customerEmail: appointmentDetails.attendeeEmail,
        customerName: appointmentDetails.attendeeName
      };

    } catch (error) {
      console.error('❌ Error creating appointment:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'Failed to create appointment'
      };
    }
  }

  isInitialized() {
    return !!(this.calendar && this.auth && this.scheduleId);
  }

  getScheduleInfo() {
    return {
      scheduleId: this.scheduleId,
      timezone: this.timezone,
      initialized: this.isInitialized(),
      hasAuth: !!this.auth,
      hasCalendar: !!this.calendar,
      scheduleUrl: config.GOOGLE_APPOINTMENT_SCHEDULE_URL
    };
  }
}

module.exports = GoogleAppointmentScheduleService;
