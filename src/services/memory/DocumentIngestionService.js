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
