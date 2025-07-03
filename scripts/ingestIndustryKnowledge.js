// scripts/ingestIndustryKnowledge.js
// Run this script to populate the vector database with industry-specific knowledge

const RAGMemoryService = require('../src/services/memory/RAGMemoryService');

async function ingestIndustryKnowledge() {
  const memoryService = new RAGMemoryService();
  console.log('🚀 Starting industry knowledge ingestion...');
  
  // Industry-specific pain point solutions
  const industryKnowledge = [
    // SOLAR INDUSTRY
    {
      industry: 'Solar',
      pain_point: "We're not generating enough leads",
      solution: "For solar companies struggling with lead generation, Nexella AI provides three powerful solutions: AI Texting captures website visitors instantly when they're researching solar savings, SMS Revive reactivates your database of old quotes and inquiries, and our Review Collector boosts your online reputation so homeowners choose you over competitors.",
      services: ["AI Texting", "SMS Revive", "Review Collector"],
      context: "Solar lead generation is expensive with Google Ads costing $50-150 per lead. Competition from national brands like SunRun and Tesla makes it harder for local installers."
    },
    {
      industry: 'Solar',
      pain_point: "We're not following up with leads quickly enough",
      solution: "Solar buyers get multiple quotes within hours. Our AI responds to every lead in under 5 seconds, answers questions about panel types, savings calculations, tax credits, and installation timelines, then books qualified appointments while your competitors are still checking voicemail.",
      services: ["AI Voice Calls", "SMS Follow-Ups", "Appointment Bookings"],
      context: "The average solar buyer contacts 5-7 companies. The first to respond professionally wins 78% of the time. Speed is everything in solar sales."
    },
    {
      industry: 'Solar',
      pain_point: "We miss calls too much",
      solution: "Our AI Voice system ensures you never miss another $30k solar opportunity. It answers calls 24/7, qualifies homeowners on roof ownership and credit, explains federal tax credits, and books consultations. If they can't talk, it automatically texts them to continue the conversation.",
      services: ["AI Voice Calls", "SMS Follow-Ups"],
      context: "Missed calls in solar mean missed revenue. Each residential solar installation averages $20,000-30,000. Missing just one call per day could cost $600k annually."
    },
    
    // REAL ESTATE INDUSTRY
    {
      industry: 'Real Estate',
      pain_point: "We're not generating enough leads",
      solution: "Break free from Zillow and Realtor.com dependency. Our AI Texting captures leads from YOUR website, SMS campaigns nurture past clients for referrals (where 80% of business comes from), and automated review collection improves your Google presence so locals find you first.",
      services: ["AI Texting", "SMS Revive", "Review Collector"],
      context: "Real estate agents spend $12,000+ annually on Zillow leads with declining ROI. Building your own lead sources is critical for long-term success."
    },
    {
      industry: 'Real Estate',
      pain_point: "We miss calls too much",
      solution: "In real estate, the agent who answers first gets the listing. Our AI becomes your 24/7 assistant, answering buyer and seller calls, qualifying their timeline and pre-approval status, scheduling showings, and following up on open house visitors automatically.",
      services: ["AI Voice Calls", "SMS Follow-Ups", "Appointment Bookings"],
      context: "76% of real estate leads go with the first agent who responds. Missing calls means losing listings and buyers to faster competitors."
    },
    
    // ROOFING INDUSTRY
    {
      industry: 'Roofing',
      pain_point: "We're not generating enough leads",
      solution: "Generate roofing leads year-round, not just storm season. AI chat on your website provides instant quotes, SMS campaigns target neighborhoods after weather events, and review automation establishes you as the trusted local roofer homeowners call first.",
      services: ["AI Texting", "SMS Revive", "Review Collector"],
      context: "Roofing is highly seasonal with 70% of revenue in storm months. Building consistent lead flow year-round is crucial for stable business."
    },
    {
      industry: 'Roofing',
      pain_point: "We miss calls too much",
      solution: "When homeowners have water dripping through their ceiling, they call every roofer until someone answers. Our AI picks up 24/7, assesses damage urgency, provides ballpark estimates based on roof size, and schedules immediate inspections for emergencies.",
      services: ["AI Voice Calls", "SMS Follow-Ups", "Appointment Bookings"],
      context: "Emergency roofing calls are the most profitable jobs. Missing these calls means losing $5,000-15,000 repairs to competitors who answer."
    },
    
    // DENTAL INDUSTRY
    {
      industry: 'Dental',
      pain_point: "We miss calls too much",
      solution: "Patients in pain won't wait for callbacks. Our AI answers immediately, assesses urgency for same-day appointments, explains insurance coverage, and books directly into your practice management system. After-hours calls get proper attention instead of just voicemail.",
      services: ["AI Voice Calls", "SMS Follow-Ups", "Appointment Bookings", "CRM Integration"],
      context: "60% of dental calls come outside business hours. Each new patient has a lifetime value of $10,000+. Missing calls directly impacts practice revenue."
    },
    {
      industry: 'Dental',
      pain_point: "We're not following up with leads quickly enough",
      solution: "Dental patients shop around for the best experience and price. Our AI follows up instantly on website inquiries, price shoppers, and insurance questions. It educates about procedures, confirms coverage, and books consultations before they choose another practice.",
      services: ["AI Texting", "SMS Follow-Ups", "Appointment Bookings"],
      context: "New patient acquisition costs $250-500 in dental. Quick follow-up dramatically improves conversion rates and ROI on marketing spend."
    },
    
    // MED SPA INDUSTRY
    {
      industry: 'Med Spa',
      pain_point: "We're not generating enough leads",
      solution: "Med spa success requires sophisticated lead nurturing. AI chat engages website visitors researching treatments, SMS campaigns re-engage past clients for maintenance appointments, and review automation showcases your results to attract new clients seeking transformations.",
      services: ["AI Texting", "SMS Revive", "Review Collector"],
      context: "Med spa clients research extensively before choosing a provider. Average treatment packages range from $1,500-5,000. Trust and reviews are critical."
    },
    {
      industry: 'Med Spa',
      pain_point: "We're not following up with leads quickly enough",
      solution: "Med spa inquiries require immediate, knowledgeable responses. Our AI answers questions about treatments, recovery time, and pricing, books consultations while interest is high, and nurtures leads through their decision process with personalized follow-ups.",
      services: ["AI Voice Calls", "SMS Follow-Ups", "Appointment Bookings"],
      context: "Med spa clients often get multiple consultations. The provider who responds fastest and most professionally typically wins the business."
    },
    
    // HOME SERVICES INDUSTRY
    {
      industry: 'Home Services',
      pain_point: "We miss calls too much",
      solution: "When a pipe bursts or AC fails, homeowners call every service company until someone answers. Our AI responds 24/7, dispatches emergency calls, provides arrival windows, and books routine maintenance. You capture every urgent, high-value job.",
      services: ["AI Voice Calls", "SMS Follow-Ups", "Appointment Bookings"],
      context: "Emergency home service calls command premium pricing. Missing one emergency call can mean losing a $2,000-5,000 job to a competitor."
    },
    {
      industry: 'Home Services',
      pain_point: "We can't handle the amount of leads",
      solution: "Seasonal surges don't have to mean chaos. Our AI handles unlimited simultaneous calls, prioritizes emergencies, provides accurate scheduling based on your capacity, and keeps customers informed with automated updates. Your team focuses on the work, not the phones.",
      services: ["Complete AI Revenue Rescue System", "CRM Integration"],
      context: "Home services see 300% call volume increases during peak seasons. Without proper systems, service quality and customer satisfaction suffer."
    }
  ];

  let successCount = 0;
  
  for (const knowledge of industryKnowledge) {
    try {
      // Create comprehensive content for embedding
      const content = `Industry: ${knowledge.industry}
Pain Point: ${knowledge.pain_point}
Solution: ${knowledge.solution}
Recommended Services: ${knowledge.services.join(', ')}
Industry Context: ${knowledge.context}`;

      console.log(`\n📝 Ingesting: ${knowledge.industry} - ${knowledge.pain_point}`);
      
      // Create embedding
      const embedding = await memoryService.createEmbedding(content);
      
      // Store in vector database
      await memoryService.storeMemories([{
        id: `industry_${knowledge.industry.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}_${successCount}`,
        values: embedding,
        metadata: {
          memory_type: 'industry_solution',
          industry: knowledge.industry,
          pain_point: knowledge.pain_point,
          solution: knowledge.solution,
          recommended_services: knowledge.services,
          context: knowledge.context,
          source: 'nexella_knowledge',
          timestamp: new Date().toISOString(),
          content: content
        }
      }]);
      
      successCount++;
      console.log(`✅ Successfully stored knowledge for ${knowledge.industry}`);
      
    } catch (error) {
      console.error(`❌ Error storing ${knowledge.industry} knowledge:`, error.message);
    }
  }
  
  console.log(`\n✅ Industry knowledge ingestion complete: ${successCount}/${industryKnowledge.length} items stored`);
  
  // Also store general Nexella value propositions
  const nexellaValueProps = [
    {
      topic: "24/7 Availability",
      content: "Nexella AI never sleeps. While competitors use basic voicemail or answering services, our AI conducts full conversations, qualifies leads, and books appointments at 2 AM just as effectively as 2 PM."
    },
    {
      topic: "Instant Response",
      content: "Speed wins deals. Nexella AI responds in under 5 seconds to every lead. Studies show 78% of customers buy from the company that responds first. We make sure that's always you."
    },
    {
      topic: "Lead Qualification",
      content: "Stop wasting time on tire-kickers. Nexella AI asks YOUR specific qualifying questions, whether that's budget, timeline, decision-maker status, or industry-specific criteria. Only qualified leads reach your team."
    },
    {
      topic: "Seamless Integration",
      content: "Nexella AI integrates with popular CRMs like GoHighLevel, HubSpot, Salesforce, and more. Every interaction is logged, every lead is tracked, and your workflow remains uninterrupted."
    },
    {
      topic: "ROI and Results",
      content: "Nexella AI clients see average increases of 47% in lead-to-appointment conversion, 3x faster response times, and 35% reduction in cost per acquisition. The system pays for itself within 60 days."
    }
  ];
  
  console.log('\n🚀 Ingesting Nexella value propositions...');
  
  for (const prop of nexellaValueProps) {
    try {
      const embedding = await memoryService.createEmbedding(prop.content);
      
      await memoryService.storeMemories([{
        id: `nexella_value_${prop.topic.toLowerCase().replace(/\s+/g, '_')}`,
        values: embedding,
        metadata: {
          memory_type: 'nexella_value_proposition',
          topic: prop.topic,
          content: prop.content,
          source: 'nexella_knowledge',
          timestamp: new Date().toISOString()
        }
      }]);
      
      console.log(`✅ Stored: ${prop.topic}`);
    } catch (error) {
      console.error(`❌ Error storing ${prop.topic}:`, error.message);
    }
  }
  
  console.log('\n🎉 Knowledge base ingestion complete!');
  process.exit(0);
}

// Run the ingestion
ingestIndustryKnowledge().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
