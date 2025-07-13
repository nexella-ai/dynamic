// src/services/config/ConfigurationLoader.js
const CompanyConfig = require('../../models/CompanyConfig');
const fs = require('fs').promises;
const path = require('path');

class ConfigurationLoader {
  constructor() {
    this.configs = new Map();
    this.currentConfig = null;
    this.configSource = process.env.CONFIG_SOURCE || 'file'; // 'file', 'database', 'api'
  }
  
  async loadCompanyConfig(companyId) {
    try {
      console.log(`📋 Loading configuration for company: ${companyId}`);
      
      let configData;
      
      switch (this.configSource) {
        case 'file':
          configData = await this.loadFromFile(companyId);
          break;
        case 'database':
          configData = await this.loadFromDatabase(companyId);
          break;
        case 'api':
          configData = await this.loadFromAPI(companyId);
          break;
        default:
          throw new Error(`Unknown config source: ${this.configSource}`);
      }
      
      const config = new CompanyConfig(configData);
      this.configs.set(companyId, config);
      this.currentConfig = config;
      
      console.log(`✅ Configuration loaded for: ${config.companyName}`);
      return config;
      
    } catch (error) {
      console.error(`❌ Error loading configuration for ${companyId}:`, error);
      throw error;
    }
  }
  
  async loadFromFile(companyId) {
    const configPath = path.join(__dirname, '../../../configs', `${companyId}.json`);
    const data = await fs.readFile(configPath, 'utf8');
    return JSON.parse(data);
  }
  
  async loadFromDatabase(companyId) {
    // Implement database loading logic
    // This could be MongoDB, PostgreSQL, etc.
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI);
    
    try {
      await client.connect();
      const db = client.db('nexella_configs');
      const config = await db.collection('company_configs').findOne({ companyId });
      return config;
    } finally {
      await client.close();
    }
  }
  
  async loadFromAPI(companyId) {
    // Load from external API
    const axios = require('axios');
    const response = await axios.get(`${process.env.CONFIG_API_URL}/companies/${companyId}/config`, {
      headers: {
        'Authorization': `Bearer ${process.env.CONFIG_API_KEY}`
      }
    });
    return response.data;
  }
  
  getCurrentConfig() {
    if (!this.currentConfig) {
      throw new Error('No configuration loaded');
    }
    return this.currentConfig;
  }
  
  getConfig(companyId) {
    return this.configs.get(companyId);
  }
  
  async reloadConfig(companyId) {
    console.log(`🔄 Reloading configuration for ${companyId}`);
    return await this.loadCompanyConfig(companyId);
  }
  
  // Helper methods for dynamic access
  getBusinessHours(dayOfWeek) {
    const config = this.getCurrentConfig();
    return config.businessHours.days[dayOfWeek.toLowerCase()];
  }
  
  isBusinessOpen(date = new Date()) {
    const config = this.getCurrentConfig();
    const dayName = date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      timeZone: config.businessHours.timezone 
    }).toLowerCase();
    
    const hours = config.businessHours.days[dayName];
    if (!hours || !hours.isOpen) return false;
    
    const currentTime = date.toLocaleTimeString('en-US', {
      hour12: false,
      timeZone: config.businessHours.timezone
    }).slice(0, 5);
    
    return currentTime >= hours.open && currentTime <= hours.close;
  }
  
  getScript(category, subcategory) {
    const config = this.getCurrentConfig();
    return config.scripts?.[category]?.[subcategory] || '';
  }
  
  formatScript(script, variables = {}) {
    if (!script || typeof script !== 'string') {
      return script || '';
    }
    
    const config = this.getCurrentConfig();
    
    // Default variables with safe access
    const defaultVars = {
      companyName: config.companyName || '',
      agentName: config.aiAgent?.name || '',
      firstName: variables.firstName || 'there',
      certifications: config.roofingSettings?.certifications?.join(', ') || '',
      warranty: config.services?.installation?.warranties?.[0] || 
                config.roofingSettings?.warranties?.workmanship || 
                'comprehensive warranty',
      serviceArea: config.roofingSettings?.serviceAreas?.primary?.join(', ') || '',
      daysOut: this.getBookingLeadDays(),
      yearsInBusiness: config.roofingSettings?.yearsInBusiness || 'many',
      ...variables
    };
    
    // Replace all {variable} placeholders
    return script.replace(/{(\w+)}/g, (match, key) => {
      return defaultVars[key] || match;
    });
  }
  
  getBookingLeadDays() {
    // Calculate how many days out we're currently booking
    // This would connect to your calendar system
    return 3; // Default
  }
  
  async saveConfig(companyId, updates) {
    const config = this.getConfig(companyId);
    if (!config) {
      throw new Error(`No configuration found for ${companyId}`);
    }
    
    // Merge updates
    Object.assign(config, updates);
    
    // Save based on source
    switch (this.configSource) {
      case 'file':
        await this.saveToFile(companyId, config);
        break;
      case 'database':
        await this.saveToDatabase(companyId, config);
        break;
      case 'api':
        await this.saveToAPI(companyId, config);
        break;
    }
    
    console.log(`✅ Configuration saved for ${companyId}`);
  }
  
  async saveToFile(companyId, config) {
    const configPath = path.join(__dirname, '../../../configs', `${companyId}.json`);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }
  
  async saveToDatabase(companyId, config) {
    // Implement database save logic
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI);
    
    try {
      await client.connect();
      const db = client.db('nexella_configs');
      await db.collection('company_configs').replaceOne(
        { companyId },
        config,
        { upsert: true }
      );
    } finally {
      await client.close();
    }
  }
  
  async saveToAPI(companyId, config) {
    // Implement API save logic
    const axios = require('axios');
    await axios.put(`${process.env.CONFIG_API_URL}/companies/${companyId}/config`, 
      config,
      {
        headers: {
          'Authorization': `Bearer ${process.env.CONFIG_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
  }
  
  async listCompanies() {
    try {
      switch (this.configSource) {
        case 'file':
          // List all JSON files in configs directory
          const configDir = path.join(__dirname, '../../../configs');
          const files = await fs.readdir(configDir);
          return files
            .filter(file => file.endsWith('.json'))
            .map(file => file.replace('.json', ''));
            
        case 'database':
          // List from database
          const { MongoClient } = require('mongodb');
          const client = new MongoClient(process.env.MONGODB_URI);
          try {
            await client.connect();
            const db = client.db('nexella_configs');
            const configs = await db.collection('company_configs')
              .find({}, { projection: { companyId: 1, companyName: 1 } })
              .toArray();
            return configs.map(c => c.companyId);
          } finally {
            await client.close();
          }
          
        case 'api':
          // List from API
          const axios = require('axios');
          const response = await axios.get(`${process.env.CONFIG_API_URL}/companies`, {
            headers: {
              'Authorization': `Bearer ${process.env.CONFIG_API_KEY}`
            }
          });
          return response.data.companies;
          
        default:
          return [];
      }
    } catch (error) {
      console.error('Error listing companies:', error);
      return [];
    }
  }
}

// Create singleton instance
const configLoader = new ConfigurationLoader();
module.exports = configLoader;
