// src/services/memory/DocumentIngestionService.js
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const RAGMemoryService = require('./RAGMemoryService');

class DocumentIngestionService {
  constructor() {
    this.memoryService = new RAGMemoryService();
    this.chunkSize = 1000; // Characters per chunk
    this.chunkOverlap = 200; // Overlap between chunks
  }

  // MAIN INGESTION METHODS

  /**
   * Ingest company knowledge base documents
   */
  async ingestCompanyDocuments(documentsPath = './knowledge-base/') {
    try {
      console.log('📚 Starting company document ingestion...');
      
      const files = await this.getDocumentFiles(documentsPath);
      let totalChunks = 0;
      
      for (const file of files) {
        console.log(`📄 Processing: ${file}`);
        const chunks = await this.processDocument(file);
        totalChunks += chunks.length;
        
        // Store chunks in vector database
        await this.storeDocumentChunks(chunks, {
          source: 'company_knowledge',
          file: path.basename(file),
          ingestedAt: new Date().toISOString()
        });
      }
      
      console.log(`✅ Ingested ${files.length} documents (${totalChunks} chunks)`);
      return { success: true, documents: files.length, chunks: totalChunks };
      
    } catch (error) {
      console.error('❌ Document ingestion failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Ingest FAQ data
   */
  async ingestFAQs(faqData) {
    try {
      console.log('❓ Ingesting FAQ data...');
      
      const faqChunks = faqData.map((faq, index) => ({
        id: `faq_${index}`,
        content: `Q: ${faq.question}\nA: ${faq.answer}`,
        metadata: {
          memory_type: 'faq',
          question: faq.question,
          answer: faq.answer,
          category: faq.category || 'general',
          source: 'company_faq',
          ingestedAt: new Date().toISOString()
        }
      }));
      
      // Create embeddings for each FAQ
      const embeddings = [];
      for (const chunk of faqChunks) {
        const embedding = await this.memoryService.createEmbedding(chunk.content);
        embeddings.push({
          id: chunk.id,
          values: embedding,
          metadata: chunk.metadata
        });
      }
      
      // Store in Pinecone
      await this.memoryService.storeMemories(embeddings);
      
      console.log(`✅ Ingested ${faqData.length} FAQs`);
      return { success: true, faqs: faqData.length };
      
    } catch (error) {
      console.error('❌ FAQ ingestion failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Ingest product/service information
   */
  async ingestProductInfo(products) {
    try {
      console.log('🛍️ Ingesting product information...');
      
      const productChunks = [];
      
      for (const product of products) {
        const content = `Product: ${product.name}
Description: ${product.description}
Features: ${product.features?.join(', ') || 'Not specified'}
Pricing: ${product.pricing || 'Contact for pricing'}
Target Market: ${product.targetMarket || 'General'}
Benefits: ${product.benefits || ''}`;

        productChunks.push({
          id: `product_${product.id || product.name.replace(/\s+/g, '_').toLowerCase()}`,
          content,
          metadata: {
            memory_type: 'product_info',
            product_name: product.name,
            category: product.category || 'product',
            price_range: product.priceRange || 'unknown',
            source: 'company_products',
            ingestedAt: new Date().toISOString()
          }
        });
      }
      
      // Create embeddings and store
      await this.storeProductChunks(productChunks);
      
      console.log(`✅ Ingested ${products.length} products`);
      return { success: true, products: products.length };
      
    } catch (error) {
      console.error('❌ Product ingestion failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Ingest company policies and procedures
   */
  async ingestCompanyPolicies(policies) {
    try {
      console.log('📋 Ingesting company policies...');
      
      const policyChunks = [];
      
      for (const policy of policies) {
        // Split long policies into chunks
        const chunks = this.splitTextIntoChunks(policy.content);
        
        chunks.forEach((chunk, index) => {
          policyChunks.push({
            id: `policy_${policy.id}_chunk_${index}`,
            content: `Policy: ${policy.title}\nSection: ${chunk}`,
            metadata: {
              memory_type: 'company_policy',
              policy_title: policy.title,
              policy_category: policy.category || 'general',
              chunk_index: index,
              total_chunks: chunks.length,
              source: 'company_policies',
              ingestedAt: new Date().toISOString()
            }
          });
        });
      }
      
      await this.storePolicyChunks(policyChunks);
      
      console.log(`✅ Ingested ${policies.length} policies (${policyChunks.length} chunks)`);
      return { success: true, policies: policies.length, chunks: policyChunks.length };
      
    } catch (error) {
      console.error('❌ Policy ingestion failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Ingest Nexella-specific knowledge base
   */
  async ingestNexellaKnowledgeBase() {
    try {
      console.log('🚀 Starting Nexella knowledge base ingestion...');
      
      let totalIngested = 0;
      
      // 1. Ingest Services
      const servicesResult = await this.ingestNexellaServices();
      totalIngested += servicesResult.count || 0;
      
      // 2. Ingest Company Overview
      const overviewResult = await this.ingestNexellaOverview();
      totalIngested += overviewResult.count || 0;
      
      // 3. Ingest Success Stories
      const storiesResult = await this.ingestNexellaSuccessStories();
      totalIngested += storiesResult.count || 0;
      
      // 4. Ingest FAQs (using your existing method)
      const nexellaFAQs = this.getNexellaFAQs();
      const faqResult = await this.ingestFAQs(nexellaFAQs);
      totalIngested += faqResult.faqs || 0;
      
      console.log(`✅ Nexella knowledge base ingestion complete: ${totalIngested} items`);
      return { success: true, totalItems: totalIngested };
      
    } catch (error) {
      console.error('❌ Nexella knowledge base ingestion failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Ingest Nexella services
   */
  async ingestNexellaServices() {
    const services = [
      {
        name: 'AI Texting',
        description: 'Our Texting App integrates directly or extended from your website. So customers can receive immediate info and book from a human-like agent.',
        benefits: 'Immediate response, human-like interaction, seamless website integration'
      },
      {
        name: 'SMS Revive',
        description: 'Our SMS system will text your dead leads and revive them. Resulting in booked appointments from low interest customers.',
        benefits: 'Revive dead leads, convert low-interest prospects, automated re-engagement'
      },
      {
        name: 'AI Voice Calls',
        description: 'Our human-like AI voice will call your customers, follow up, nurture, log every detail into your crm, and schedule appointments for you.',
        benefits: 'Automated calling, CRM integration, appointment scheduling, detailed logging'
      },
      {
        name: 'Appointment Bookings',
        description: 'Our AI Systems will book your appointments hands-free for you.',
        benefits: 'Hands-free booking, calendar integration, automated scheduling'
      },
      {
        name: 'SMS Follow-Ups',
        description: 'Our SMS Flows will follow-up on leads making sure they don\'t lose interest and close.',
        benefits: 'Persistent follow-up, lead nurturing, increased conversion rates'
      },
      {
        name: 'CRM Integration',
        description: 'Easily integrate to several of the most popular CRM\'s.',
        benefits: 'Seamless data sync, popular CRM support, unified workflow'
      },
      {
        name: 'Review Collector',
        description: 'Collect reviews automatically after the customer was taken care of.',
        benefits: 'Automated review requests, improved online reputation, customer feedback'
      }
    ];

    const chunks = [];
    for (const service of services) {
      const content = `Nexella AI Service: ${service.name}. ${service.description} Benefits: ${service.benefits}`;
      chunks.push({
        id: `nexella_service_${service.name.replace(/\s+/g, '_').toLowerCase()}`,
        content,
        metadata: {
          memory_type: 'nexella_service',
          service_name: service.name,
          description: service.description,
          benefits: service.benefits,
          source: 'nexella_knowledge',
          category: 'services'
        }
      });
    }

    await this.storeDocumentChunks(chunks, { source: 'nexella_knowledge' });
    return { success: true, count: chunks.length };
  }

  /**
   * Ingest Nexella company overview
   */
  async ingestNexellaOverview() {
    const overviewChunks = [
      {
        id: 'nexella_overview_problem',
        content: 'Nexella AI solves critical business problems: The average business loses 50% of leads due to slow response times. Appointment no-shows and weak follow-ups drain your calendar and cash flow. Overwhelmed support teams cause refund requests, bad reviews, and lost trust.',
        metadata: {
          memory_type: 'company_overview',
          topic: 'problems_solved',
          source: 'nexella_knowledge'
        }
      },
      {
        id: 'nexella_overview_solution',
        content: 'Nexella AI simplifies your system and implements AI to automate your follow up process, onboarding, and appointment booking. We implement SMS and email systems to nurture your leads. We handle all calls, follow ups, lead qualification, nurturing, CRM updating. So you can sit back, relax, and watch the qualified leads come in.',
        metadata: {
          memory_type: 'company_overview',
          topic: 'solution',
          source: 'nexella_knowledge'
        }
      }
    ];

    await this.storeDocumentChunks(overviewChunks, { source: 'nexella_knowledge' });
    return { success: true, count: overviewChunks.length };
  }

  /**
   * Ingest Nexella success stories
   */
  async ingestNexellaSuccessStories() {
    const stories = [
      {
        id: 'nexella_success_retroshot',
        content: 'Nexella AI Success Story: We took Retroshot from $10k/mo to over $200k/mo in 6 months using our own SMS Flows, email flows, AI sales assistants, and Ad Strategies. That\'s a 20x increase in revenue!',
        metadata: {
          memory_type: 'success_story',
          client: 'Retroshot',
          revenue_before: '$10k/mo',
          revenue_after: '$200k/mo',
          timeframe: '6 months',
          services_used: 'SMS Flows, email flows, AI sales assistants, Ad Strategies',
          source: 'nexella_knowledge'
        }
      },
      {
        id: 'nexella_success_nebula_orb',
        content: 'Nexella AI Success Story: We took Nebula Orb from $25k/mo to over $250k/mo in 8 months using our SMS Flows, AI sales assistants, AI Voice Call, AI Texting, SMS Revive, and Ad Strategies. That\'s a 10x increase in revenue!',
        metadata: {
          memory_type: 'success_story',
          client: 'Nebula Orb',
          revenue_before: '$25k/mo',
          revenue_after: '$250k/mo',
          timeframe: '8 months',
          services_used: 'SMS Flows, AI sales assistants, AI Voice Call, AI Texting, SMS Revive, Ad Strategies',
          source: 'nexella_knowledge'
        }
      }
    ];

    await this.storeDocumentChunks(stories, { source: 'nexella_knowledge' });
    return { success: true, count: stories.length };
  }

  /**
   * Get Nexella FAQs
   */
  getNexellaFAQs() {
    return [
      {
        question: 'How fast is your response time?',
        answer: 'Our AI Systems respond to leads immediately or we can set a delay to your liking.',
        category: 'performance'
      },
      {
        question: 'Will you book my appointments to my calendar?',
        answer: 'Our AI systems will text and or call your leads, follow up, collect information and book your appointments automatically to your calendar.',
        category: 'features'
      },
      {
        question: 'Can your service ask questions to qualify leads?',
        answer: 'Yes, we can add a string of questions to qualify leads. You tell us exactly what you need and we will train our AI using a vector database to speak your company\'s language.',
        category: 'features'
      },
      {
        question: 'What type of support does your team offer?',
        answer: 'Nexella provides comprehensive support to assist you every step of the way. Our dedicated support team is available to address any questions, concerns, or technical issues you may encounter. You can reach out to us via email at info@nexella.io, through our online chat feature inside the platform and for certain plans via a dedicated slack support channel.',
        category: 'support'
      },
      {
        question: 'Can I cancel my subscription anytime?',
        answer: 'Yes, if for any reason you decide Nexella AI is not for you. You are welcome to cancel inside of your account or contact our team.',
        category: 'billing'
      },
      {
        question: 'Can I integrate Nexella with other tools or platforms?',
        answer: 'Yes, Nexella offers flexible integration options to seamlessly connect with your existing tools and platforms. Whether it\'s CRM software, helpdesk systems, or other communication channels, you can integrate Nexella to enhance workflow efficiency and maximize productivity.',
        category: 'integration'
      },
      {
        question: 'Can I make outbound and inbound calls with Nexella AI?',
        answer: 'Yes. Nexella supports both inbound and outbound call capabilities in all plans.',
        category: 'features'
      },
      {
        question: 'Do I need to bring my own Twilio and other APIs?',
        answer: 'No, when you create an account with Nexella AI, the Platform, Voice, LLM, Transcription and Telephony systems are already included. We focus on bringing a centralized solution for lightning speed deployments and best results.',
        category: 'technical'
      },
      {
        question: 'Can I use my number for outgoing calls with Nexella AI?',
        answer: 'Yes. Nexella AI allows you to import your Caller ID for free.',
        category: 'features'
      },
      {
        question: 'Can I use Nexella AI for Sales Calls?',
        answer: 'Yes, absolutely! Nexella is designed to enhance sales calls by providing AI-powered agents that can engage with customers, answer questions, and assist in closing deals effectively.',
        category: 'use_cases'
      },
      {
        question: 'Can I use Nexella AI for Customer Support?',
        answer: 'Certainly! Nexella is ideal for customer support, allowing you to automate responses, handle inquiries, and provide assistance to customers in a timely and efficient manner.',
        category: 'use_cases'
      },
      {
        question: 'How much does cost? What\'s your pricing?',
        answer: 'Our pricing ranges from as little as $2,000 to as high as $25,000 depending on the complexity of your setup. Your setup heavily depends on your situation and various factors. Book a call with us so we can determine what plan fits best for you.',
        category: 'pricing'
      }
    ];
  }

  // DOCUMENT PROCESSING HELPERS

  async getDocumentFiles(directoryPath) {
    try {
      const files = await fs.readdir(directoryPath);
      return files
        .filter(file => /\.(txt|md|json|csv)$/i.test(file))
        .map(file => path.join(directoryPath, file));
    } catch (error) {
      console.log(`⚠️ Directory ${directoryPath} not found, creating sample structure...`);
      await this.createSampleKnowledgeBase(directoryPath);
      return [];
    }
  }

  async processDocument(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const content = await fs.readFile(filePath, 'utf8');
    
    switch (extension) {
      case '.txt':
      case '.md':
        return this.processTextDocument(content, filePath);
      case '.json':
        return this.processJSONDocument(content, filePath);
      case '.csv':
        return this.processCSVDocument(content, filePath);
      default:
        console.log(`⚠️ Unsupported file type: ${extension}`);
        return [];
    }
  }

  processTextDocument(content, filePath) {
    const chunks = this.splitTextIntoChunks(content);
    const fileName = path.basename(filePath, path.extname(filePath));
    
    return chunks.map((chunk, index) => ({
      id: `doc_${fileName}_chunk_${index}`,
      content: chunk,
      metadata: {
        memory_type: 'company_document',
        document_name: fileName,
        chunk_index: index,
        total_chunks: chunks.length,
        file_type: 'text',
        source: 'company_knowledge',
        ingestedAt: new Date().toISOString()
      }
    }));
  }

  processJSONDocument(content, filePath) {
    try {
      const data = JSON.parse(content);
      const fileName = path.basename(filePath, '.json');
      
      // Handle different JSON structures
      if (Array.isArray(data)) {
        return data.map((item, index) => ({
          id: `json_${fileName}_item_${index}`,
          content: typeof item === 'string' ? item : JSON.stringify(item, null, 2),
          metadata: {
            memory_type: 'structured_data',
            document_name: fileName,
            item_index: index,
            source: 'company_knowledge',
            ingestedAt: new Date().toISOString()
          }
        }));
      } else {
        // Single JSON object
        return [{
          id: `json_${fileName}`,
          content: JSON.stringify(data, null, 2),
          metadata: {
            memory_type: 'structured_data',
            document_name: fileName,
            source: 'company_knowledge',
            ingestedAt: new Date().toISOString()
          }
        }];
      }
    } catch (error) {
      console.error(`❌ Invalid JSON in ${filePath}:`, error.message);
      return [];
    }
  }

  processCSVDocument(content, filePath) {
    const lines = content.split('\n').filter(line => line.trim());
    const fileName = path.basename(filePath, '.csv');
    
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1);
    
    return rows.map((row, index) => {
      const values = row.split(',').map(v => v.trim());
      const rowObject = {};
      headers.forEach((header, i) => {
        rowObject[header] = values[i] || '';
      });
      
      return {
        id: `csv_${fileName}_row_${index}`,
        content: `${headers.join(': ')}\n${values.join(': ')}`,
        metadata: {
          memory_type: 'tabular_data',
          document_name: fileName,
          row_index: index,
          headers: headers,
          source: 'company_knowledge',
          ingestedAt: new Date().toISOString()
        }
      };
    });
  }

  splitTextIntoChunks(text) {
    const chunks = [];
    let start = 0;
    
    while (start < text.length) {
      let end = start + this.chunkSize;
      
      // If we're not at the end, try to break at a sentence or paragraph
      if (end < text.length) {
        const lastPeriod = text.lastIndexOf('.', end);
        const lastNewline = text.lastIndexOf('\n', end);
        const breakPoint = Math.max(lastPeriod, lastNewline);
        
        if (breakPoint > start + this.chunkSize * 0.5) {
          end = breakPoint + 1;
        }
      }
      
      chunks.push(text.slice(start, end).trim());
      start = Math.max(start + this.chunkSize - this.chunkOverlap, end);
    }
    
    return chunks.filter(chunk => chunk.length > 50); // Filter out very short chunks
  }

  // STORAGE HELPERS

  async storeDocumentChunks(chunks, commonMetadata) {
    const embeddings = [];
    
    for (const chunk of chunks) {
      try {
        const embedding = await this.memoryService.createEmbedding(chunk.content);
        embeddings.push({
          id: chunk.id,
          values: embedding,
          metadata: { ...chunk.metadata, ...commonMetadata }
        });
      } catch (error) {
        console.error(`❌ Error creating embedding for chunk ${chunk.id}:`, error.message);
      }
    }
    
    if (embeddings.length > 0) {
      await this.memoryService.storeMemories(embeddings);
    }
  }

  async storeProductChunks(productChunks) {
    const embeddings = [];
    
    for (const chunk of productChunks) {
      try {
        const embedding = await this.memoryService.createEmbedding(chunk.content);
        embeddings.push({
          id: chunk.id,
          values: embedding,
          metadata: chunk.metadata
        });
      } catch (error) {
        console.error(`❌ Error creating embedding for product ${chunk.id}:`, error.message);
      }
    }
    
    if (embeddings.length > 0) {
      await this.memoryService.storeMemories(embeddings);
    }
  }

  async storePolicyChunks(policyChunks) {
    const embeddings = [];
    
    for (const chunk of policyChunks) {
      try {
        const embedding = await this.memoryService.createEmbedding(chunk.content);
        embeddings.push({
          id: chunk.id,
          values: embedding,
          metadata: chunk.metadata
        });
      } catch (error) {
        console.error(`❌ Error creating embedding for policy chunk ${chunk.id}:`, error.message);
      }
    }
    
    if (embeddings.length > 0) {
      await this.memoryService.storeMemories(embeddings);
    }
  }

  // UTILITY METHODS

  async createSampleKnowledgeBase(directoryPath) {
    try {
      await fs.mkdir(directoryPath, { recursive: true });
      
      // Create sample files
      const sampleFAQ = `# Frequently Asked Questions

## What services does Nexella AI provide?
Nexella AI provides AI-powered call automation, lead qualification, and appointment scheduling solutions.

## How does the AI calling system work?
Our AI agents conduct natural conversations with prospects, ask qualifying questions, and schedule appointments automatically.

## What industries do you serve?
We serve businesses across all industries including healthcare, real estate, professional services, and e-commerce.

## How much does it cost?
Our pricing is customized based on call volume and features needed. Contact us for a personalized quote.
`;

      const sampleProducts = `# Nexella AI Products

## AI Call Agent
Automated phone conversations that feel natural and human-like.

Features:
- Natural language processing
- Intelligent conversation flow
- Real-time calendar integration
- CRM synchronization

## Lead Qualification System
Automatically qualify prospects based on your criteria.

Features:
- Custom qualification questions
- Lead scoring algorithms
- Automated follow-up sequences
- Integration with popular CRMs
`;

      await fs.writeFile(path.join(directoryPath, 'faq.md'), sampleFAQ);
      await fs.writeFile(path.join(directoryPath, 'products.md'), sampleProducts);
      
      console.log(`✅ Created sample knowledge base in ${directoryPath}`);
    } catch (error) {
      console.error('❌ Error creating sample knowledge base:', error.message);
    }
  }

  // SEARCH AND RETRIEVAL

  /**
   * Search company knowledge for relevant information
   */
  async searchCompanyKnowledge(query, limit = 5) {
    try {
      const queryEmbedding = await this.memoryService.createEmbedding(query);
      
      const searchResults = await this.memoryService.index.query({
        vector: queryEmbedding,
        filter: {
          source: { $in: ['company_knowledge', 'company_faq', 'company_products', 'company_policies'] }
        },
        topK: limit,
        includeMetadata: true
      });
      
      return this.memoryService.processSearchResults(searchResults);
    } catch (error) {
      console.error('❌ Error searching company knowledge:', error.message);
      return [];
    }
  }

  /**
   * Get statistics about ingested documents
   */
  async getIngestionStats() {
    try {
      const stats = await this.memoryService.getMemoryStats();
      
      // Get breakdown by source
      const sources = ['company_knowledge', 'company_faq', 'company_products', 'company_policies'];
      const breakdown = {};
      
      for (const source of sources) {
        try {
          const sourceStats = await this.memoryService.index.query({
            vector: new Array(3072).fill(0),
            filter: { source: { $eq: source } },
            topK: 1,
            includeMetadata: true
          });
          breakdown[source] = sourceStats.matches?.length || 0;
        } catch (error) {
          breakdown[source] = 0;
        }
      }
      
      return {
        total: stats,
        breakdown
      };
    } catch (error) {
      console.error('❌ Error getting ingestion stats:', error.message);
      return null;
    }
  }
}

module.exports = DocumentIngestionService;
