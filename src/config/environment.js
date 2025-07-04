// src/config/environment.js - COMPLETE FILE WITH LEARNING SYSTEM
require('dotenv').config();

const config = {
  // Server Configuration
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // OpenAI Configuration
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  
  // Retell Configuration
  RETELL_API_KEY: process.env.RETELL_API_KEY,
  RETELL_AGENT_ID: process.env.RETELL_AGENT_ID,
  
  // Google Calendar Configuration
  GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID,
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
  GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
  GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID || 'jaden@nexellaai.com',
  GOOGLE_PRIVATE_KEY_ID: process.env.GOOGLE_PRIVATE_KEY_ID,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
  GOOGLE_IMPERSONATE_EMAIL: process.env.GOOGLE_IMPERSONATE_EMAIL || 'jaden@nexellaai.com',
  GOOGLE_SUBJECT_EMAIL: process.env.GOOGLE_SUBJECT_EMAIL,
  
  // RAG Memory System Configuration
  PINECONE_API_KEY: process.env.PINECONE_API_KEY,
  PINECONE_INDEX_NAME: process.env.PINECONE_INDEX_NAME || 'nexella-memory',
  
  // Memory System Feature Flags
  ENABLE_MEMORY: process.env.ENABLE_MEMORY === 'true',
  MEMORY_TEST_MODE: process.env.MEMORY_TEST_MODE === 'true',
  MEMORY_BETA_CUSTOMERS: process.env.MEMORY_BETA_CUSTOMERS?.split(',').filter(Boolean) || [],
  MEMORY_ROLLOUT_PERCENTAGE: parseInt(process.env.MEMORY_ROLLOUT_PERCENTAGE) || 0,
  
  // Learning System Configuration
  ENABLE_LEARNING: process.env.ENABLE_LEARNING === 'true',
  LEARNING_TEST_MODE: process.env.LEARNING_TEST_MODE === 'true',
  LEARNING_BETA_CUSTOMERS: process.env.LEARNING_BETA_CUSTOMERS?.split(',').filter(Boolean) || [],
  LEARNING_ROLLOUT_PERCENTAGE: parseInt(process.env.LEARNING_ROLLOUT_PERCENTAGE) || 0,
  AUTO_LEARNING_ENABLED: process.env.AUTO_LEARNING_ENABLED !== 'false', // Default true
  LEARNING_INTERVAL: parseInt(process.env.LEARNING_INTERVAL) || 3600000, // 1 hour default
  LEARNING_MIN_SCORE_THRESHOLD: parseInt(process.env.LEARNING_MIN_SCORE_THRESHOLD) || 70,
  LEARNING_MAX_HISTORY_CALLS: parseInt(process.env.LEARNING_MAX_HISTORY_CALLS) || 100,
  
  // Webhook Configuration
  TRIGGER_SERVER_URL: process.env.TRIGGER_SERVER_URL || 'https://trigger-server-qt7u.onrender.com',
  N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL || 'https://n8n-clp2.onrender.com/webhook/retell-scheduling',
  
  // Application Configuration
  TIMEZONE: 'America/Phoenix',
  BUSINESS_START_HOUR: 8,  // 8 AM
  BUSINESS_END_HOUR: 16,   // 4 PM
  
  // Validation
  validate() {
    const required = ['OPENAI_API_KEY', 'RETELL_API_KEY', 'GOOGLE_PROJECT_ID', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_CLIENT_EMAIL'];
    const missing = required.filter(key => !this[key]);
    
    // Check memory system requirements if enabled
    if (this.ENABLE_MEMORY) {
      const memoryRequired = ['PINECONE_API_KEY'];
      const memoryMissing = memoryRequired.filter(key => !this[key]);
      
      if (memoryMissing.length > 0) {
        console.warn('⚠️ Memory system enabled but missing required variables:', memoryMissing);
        console.warn('⚠️ Memory features will be disabled');
        this.ENABLE_MEMORY = false;
      } else {
        console.log('✅ Memory system configuration validated');
      }
    }
    
    // Check learning system requirements if enabled
    if (this.ENABLE_LEARNING) {
      if (!this.ENABLE_MEMORY) {
        console.warn('⚠️ Learning system requires memory system to be enabled');
        console.warn('⚠️ Learning features will be disabled');
        this.ENABLE_LEARNING = false;
      } else if (!this.PINECONE_API_KEY) {
        console.warn('⚠️ Learning system enabled but missing PINECONE_API_KEY');
        console.warn('⚠️ Learning features will be disabled');
        this.ENABLE_LEARNING = false;
      } else {
        console.log('✅ Learning system configuration validated');
      }
    }
    
    if (missing.length > 0) {
      console.error('❌ Missing required environment variables:', missing);
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    
    console.log('✅ All required environment variables present');
    
    // Log calendar configuration
    console.log('📅 Calendar Configuration:');
    console.log('   Calendar ID:', this.GOOGLE_CALENDAR_ID);
    console.log('   Service Account:', this.GOOGLE_CLIENT_EMAIL);
    console.log('   Impersonate Email:', this.GOOGLE_IMPERSONATE_EMAIL);
    
    // Log memory system status
    if (this.ENABLE_MEMORY) {
      console.log('🧠 Memory system: ENABLED');
      if (this.MEMORY_TEST_MODE) {
        console.log('🧪 Memory test mode: ACTIVE');
      }
      if (this.MEMORY_BETA_CUSTOMERS.length > 0) {
        console.log('🌟 Memory beta customers:', this.MEMORY_BETA_CUSTOMERS.length);
      }
      if (this.MEMORY_ROLLOUT_PERCENTAGE > 0) {
        console.log('🎲 Memory rollout percentage:', this.MEMORY_ROLLOUT_PERCENTAGE + '%');
      }
    } else {
      console.log('📞 Memory system: DISABLED');
    }
    
    // Log learning system status
    if (this.ENABLE_LEARNING) {
      console.log('🧠 Learning system: ENABLED');
      console.log('   Test mode:', this.LEARNING_TEST_MODE);
      console.log('   Beta customers:', this.LEARNING_BETA_CUSTOMERS.length);
      console.log('   Rollout percentage:', this.LEARNING_ROLLOUT_PERCENTAGE + '%');
      console.log('   Auto-learning:', this.AUTO_LEARNING_ENABLED);
      console.log('   Learning interval:', this.LEARNING_INTERVAL / 60000 + ' minutes');
      console.log('   Min score threshold:', this.LEARNING_MIN_SCORE_THRESHOLD);
      console.log('   Max history calls:', this.LEARNING_MAX_HISTORY_CALLS);
    } else {
      console.log('📞 Learning system: DISABLED');
    }
    
    return {
      isValid: true,
      missing: [],
      hasGoogleCalendar: !!(this.GOOGLE_PROJECT_ID && this.GOOGLE_PRIVATE_KEY && this.GOOGLE_CLIENT_EMAIL),
      hasMemorySystem: this.ENABLE_MEMORY,
      hasLearningSystem: this.ENABLE_LEARNING,
      calendarId: this.GOOGLE_CALENDAR_ID
    };
  }
};

// Run validation on module load
try {
  const validation = config.validate();
  console.log('✅ Configuration validated successfully');
} catch (error) {
  console.error('❌ Configuration validation failed:', error.message);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

module.exports = config;
