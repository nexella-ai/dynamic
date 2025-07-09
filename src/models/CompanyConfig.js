// src/models/CompanyConfig.js
class CompanyConfig {
  constructor(data) {
    // Basic Company Info
    this.companyId = data.companyId;
    this.companyName = data.companyName;
    this.companyPhone = data.companyPhone;
    this.companyEmail = data.companyEmail;
    this.website = data.website;
    this.address = data.address;
    
    // Business Hours
    this.businessHours = data.businessHours || {
      timezone: 'America/Phoenix',
      days: {
        monday: { open: '08:00', close: '17:00', isOpen: true },
        tuesday: { open: '08:00', close: '17:00', isOpen: true },
        wednesday: { open: '08:00', close: '17:00', isOpen: true },
        thursday: { open: '08:00', close: '17:00', isOpen: true },
        friday: { open: '08:00', close: '17:00', isOpen: true },
        saturday: { open: '09:00', close: '14:00', isOpen: true },
        sunday: { isOpen: false }
      },
      holidaySchedule: data.holidaySchedule || []
    };
    
    // Roofing Services
    this.services = data.services || {
      emergency: {
        name: 'Emergency Roof Repair',
        available: true,
        responseTime: '2 hours',
        description: 'Available 24/7 for storm damage and leaks'
      },
      installation: {
        types: ['Asphalt Shingles', 'Metal Roofing', 'Tile Roofing', 'Flat Roofing'],
        warranties: ['10-year workmanship', '25-year manufacturer'],
        certifications: ['GAF Certified', 'Owens Corning Preferred Contractor']
      },
      inspection: {
        freeInspection: true,
        droneInspection: true,
        detailedReport: true
      },
      maintenance: {
        plans: ['Annual', 'Semi-Annual', 'Quarterly'],
        services: ['Gutter Cleaning', 'Roof Cleaning', 'Minor Repairs']
      }
    };
    
    // Pricing Configuration
    this.pricing = data.pricing || {
      inspectionFee: 0, // Free
      minimumJobSize: 500,
      paymentOptions: ['Cash', 'Check', 'Credit Card', 'Financing Available'],
      financingPartners: ['GreenSky', 'Synchrony']
    };
    
    // AI Agent Configuration
    this.aiAgent = data.aiAgent || {
      name: 'Sarah',
      role: 'Roofing Specialist',
      personality: 'professional, empathetic, knowledgeable about roofing',
      greeting: `Hi {firstName}! This is {agentName} from {companyName}. How are you doing today?`,
      voiceSettings: {
        speed: 1.0,
        pitch: 1.0,
        voice: 'female-professional'
      }
    };
    
    // Conversation Scripts
    this.scripts = data.scripts || this.getDefaultRoofingScripts();
    
    // Qualification Questions
    this.qualificationQuestions = data.qualificationQuestions || [
      {
        id: 'property_type',
        question: 'Is this for a residential or commercial property?',
        options: ['Residential', 'Commercial', 'Both'],
        required: true
      },
      {
        id: 'roof_age',
        question: 'How old is your current roof?',
        options: ['Less than 5 years', '5-10 years', '10-20 years', 'Over 20 years', 'Not sure'],
        required: true
      },
      {
        id: 'issue_type',
        question: 'What type of roofing issue are you experiencing?',
        options: ['Leak/Water Damage', 'Storm Damage', 'General Wear', 'Complete Replacement', 'Just Inspecting'],
        required: true
      },
      {
        id: 'urgency',
        question: 'How urgent is your roofing need?',
        options: ['Emergency - Active Leak', 'Within 48 hours', 'This week', 'This month', 'Just gathering quotes'],
        required: true
      },
      {
        id: 'insurance_claim',
        question: 'Will you be filing an insurance claim?',
        options: ['Yes', 'No', 'Not sure yet'],
        required: false
      }
    ];
    
    // Calendar Integration
    this.calendar = data.calendar || {
      provider: 'google',
      calendarId: data.calendarId || 'primary',
      appointmentDuration: 60, // minutes
      bufferTime: 30, // minutes between appointments
      leadTime: 24, // hours minimum before booking
      maxDaysOut: 14 // maximum days in advance
    };
    
    // CRM Integration
    this.crm = data.crm || {
      provider: null,
      apiKey: null,
      customFields: {}
    };
    
    // Lead Routing Rules
    this.leadRouting = data.leadRouting || {
      emergency: {
        notifyNumbers: [data.emergencyPhone || data.companyPhone],
        notifyEmails: [data.emergencyEmail || data.companyEmail],
        autoResponse: 'We received your emergency request and are dispatching a team immediately.'
      },
      highValue: {
        threshold: 10000, // estimated job value
        assignTo: 'senior-sales',
        priority: 'high'
      },
      commercial: {
        assignTo: 'commercial-team',
        requiresApproval: true
      }
    };
    
    // Industry-Specific Settings (Roofing)
    this.roofingSettings = data.roofingSettings || {
      materials: {
        preferred: ['GAF', 'Owens Corning', 'CertainTeed'],
        inStock: ['Asphalt Shingles', 'Metal Panels']
      },
      serviceAreas: {
        primary: data.serviceAreas?.primary || [],
        secondary: data.serviceAreas?.secondary || [],
        noServiceMessage: "I apologize, but we don't currently service that area. We focus on {primaryAreas} to ensure quality service."
      },
      certifications: data.certifications || [],
      insurance: {
        liability: '2M',
        workersComp: true,
        bonded: true
      },
      specialOffers: data.specialOffers || []
    };
  }
  
  getDefaultRoofingScripts() {
    return {
      painPoints: {
        'leak': {
          acknowledgment: "A roof leak is definitely urgent - water damage can escalate quickly. I completely understand your concern.",
          solution: "The good news is we offer 24/7 emergency leak repair. Our certified technicians can be at your property within 2 hours to stop the leak and prevent further damage.",
          urgency: "Every minute counts with an active leak. Let me get someone out there right away."
        },
        'storm_damage': {
          acknowledgment: "Storm damage can be really stressful, especially when you're dealing with insurance. I'm here to help make this easier.",
          solution: "We're insurance claim specialists. We'll do a free inspection, document all damage with our drone technology, and work directly with your insurance company. Most homeowners pay just their deductible.",
          urgency: "The sooner we document the damage, the smoother your claim will be. Many insurance companies have time limits on storm damage claims."
        },
        'old_roof': {
          acknowledgment: "An aging roof is a ticking time bomb - you're smart to be proactive about this.",
          solution: "We offer free comprehensive inspections using drone technology. We'll give you a detailed report showing exactly what needs attention, and multiple options from repairs to full replacement with financing available.",
          urgency: "Getting ahead of problems now can save you thousands compared to emergency repairs later."
        }
      },
      objectionHandling: {
        'too_expensive': "I understand budget is important. That's why we offer multiple financing options with payments as low as $99/month. Plus, a new roof can actually save you money on energy bills and insurance premiums.",
        'getting_other_quotes': "That's smart! While you're comparing, ask other contractors about their certifications, warranty terms, and if they use subcontractors. We're {certifications}, use only our employed crews, and offer a {warranty} warranty.",
        'not_urgent': "I appreciate that. Just so you know, we're booking about {daysOut} days out right now. If you'd like, I can schedule a free inspection so you have all the information when you're ready to move forward.",
        'bad_experience': "I'm sorry you had that experience. Unfortunately, there are some contractors who cut corners. That's why we're {certifications} and have an A+ BBB rating. Would you like to hear what our actual customers say about us?"
      },
      benefits: {
        certification: "As {certification} contractors, we get exclusive warranties and pricing that we pass on to you.",
        warranty: "Our {warranty} warranty is fully transferable, which adds value if you sell your home.",
        insurance: "We work with all insurance companies and handle the entire claim process for you.",
        technology: "Our drone inspections find issues that others miss, and you get a detailed report with photos.",
        local: "We've been serving {serviceArea} for {yearsInBusiness} years. We're your neighbors, not a storm-chasing outfit."
      }
    };
  }
}

module.exports = CompanyConfig;
