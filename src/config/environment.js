// src/config/environment.js - Environment Configuration (FIXED - NO FALLBACKS)
require('dotenv').config();

const config = {
  // Server Configuration
  PORT: process.env.PORT || 3000,
  
  // OpenAI Configuration
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  
  // Retell Configuration
  RETELL_API_KEY: process.env.RETELL_API_KEY,
  RETELL_AGENT_ID: process.env.RETELL_AGENT_ID,
  
  // Google Calendar Configuration
  GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID,
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
  GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
  GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID || 'primary',
  GOOGLE_PRIVATE_KEY_ID: process.env.GOOGLE_PRIVATE_KEY_ID,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
  
  // Webhook Configuration
  TRIGGER_SERVER_URL: process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com',
  N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL || 'https://n8n-clp2.onrender.com/webhook/retell-scheduling',
  
  // Application Configuration - YOUR ACTUAL SCHEDULE
  TIMEZONE: 'America/Phoenix',
  BUSINESS_START_HOUR: 8,  // 8 AM
  BUSINESS_END_HOUR: 16,   // 4 PM
  
  // Validation
  validate() {
    const required = ['OPENAI_API_KEY', 'RETELL_API_KEY', 'GOOGLE_PROJECT_ID', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_CLIENT_EMAIL'];
    const missing = required.filter(key => !this[key]);
    
    if (missing.length > 0) {
      console.error('❌ Missing required environment variables:', missing);
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    
    console.log('✅ All required environment variables present');
    return {
      isValid: true,
      missing: []
    };
  }
};

module.exports = config;
