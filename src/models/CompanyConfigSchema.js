// src/models/schemas/CompanyConfigSchema.js
const mongoose = require('mongoose');

const BusinessHoursSchema = new mongoose.Schema({
  open: String,
  close: String,
  isOpen: { type: Boolean, default: true }
});

const CompanyConfigSchema = new mongoose.Schema({
  companyId: { type: String, required: true, unique: true },
  companyName: { type: String, required: true },
  companyPhone: { type: String, required: true },
  companyEmail: { type: String, required: true },
  website: String,
  address: {
    street: String,
    city: String,
    state: String,
    zip: String
  },
  businessHours: {
    timezone: { type: String, default: 'America/Phoenix' },
    days: {
      monday: BusinessHoursSchema,
      tuesday: BusinessHoursSchema,
      wednesday: BusinessHoursSchema,
      thursday: BusinessHoursSchema,
      friday: BusinessHoursSchema,
      saturday: BusinessHoursSchema,
      sunday: BusinessHoursSchema
    }
  },
  services: {
    emergency: {
      name: String,
      available: Boolean,
      responseTime: String,
      description: String
    },
    installation: {
      types: [String],
      warranties: [String],
      certifications: [String]
    },
    inspection: {
      freeInspection: Boolean,
      droneInspection: Boolean,
      detailedReport: Boolean
    },
    maintenance: {
      plans: [String],
      services: [String]
    }
  },
  aiAgent: {
    name: String,
    role: String,
    personality: String,
    greeting: String,
    voiceSettings: {
      speed: Number,
      pitch: Number,
      voice: String
    }
  },
  scripts: mongoose.Schema.Types.Mixed,
  qualificationQuestions: [{
    id: String,
    question: String,
    options: [String],
    required: Boolean
  }],
  roofingSettings: {
    certifications: [String],
    serviceAreas: {
      primary: [String],
      secondary: [String]
    },
    materials: {
      preferred: [String],
      inStock: [String]
    },
    insurance: {
      liability: String,
      workersComp: Boolean,
      bonded: Boolean
    }
  },
  calendar: {
    provider: String,
    calendarId: String,
    appointmentDuration: Number,
    bufferTime: Number,
    leadTime: Number,
    maxDaysOut: Number
  },
  leadRouting: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

CompanyConfigSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('CompanyConfig', CompanyConfigSchema);
