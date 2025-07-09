// src/admin/CompanyConfigManager.js
const express = require('express');
const router = express.Router();
const configLoader = require('../services/config/ConfigurationLoader');

// Web interface for managing company configs
router.get('/dashboard', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Roofing AI Configuration Manager</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .company-card { border: 1px solid #ddd; padding: 20px; margin: 10px 0; }
        .config-section { margin: 20px 0; }
        input, textarea, select { width: 100%; padding: 8px; margin: 5px 0; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; cursor: pointer; }
      </style>
    </head>
    <body>
      <h1>Roofing AI Configuration Manager</h1>
      <div id="company-selector">
        <h2>Select Company</h2>
        <select id="companyId" onchange="loadCompanyConfig()">
          <option value="">-- Select Company --</option>
          <option value="premium_roofing_az">Premium Roofing Arizona</option>
          <option value="quality_roofing_tx">Quality Roofing Texas</option>
          <option value="new">+ Add New Company</option>
        </select>
      </div>
      
      <div id="config-editor" style="display:none;">
        <h2>Company Configuration</h2>
        
        <div class="config-section">
          <h3>Basic Information</h3>
          <input type="text" id="companyName" placeholder="Company Name">
          <input type="tel" id="companyPhone" placeholder="Company Phone">
          <input type="email" id="companyEmail" placeholder="Company Email">
          <input type="url" id="website" placeholder="Website">
        </div>
        
        <div class="config-section">
          <h3>AI Agent Settings</h3>
          <input type="text" id="agentName" placeholder="Agent Name">
          <input type="text" id="agentRole" placeholder="Agent Role">
          <textarea id="agentPersonality" placeholder="Agent Personality"></textarea>
          <textarea id="greeting" placeholder="Greeting Script"></textarea>
        </div>
        
        <div class="config-section">
          <h3>Business Hours</h3>
          <div id="business-hours"></div>
        </div>
        
        <div class="config-section">
          <h3>Services</h3>
          <label><input type="checkbox" id="emergency"> Emergency Repair</label>
          <label><input type="checkbox" id="installation"> New Installation</label>
          <label><input type="checkbox" id="inspection"> Free Inspection</label>
          <label><input type="checkbox" id="maintenance"> Maintenance Plans</label>
        </div>
        
        <div class="config-section">
          <h3>Service Areas</h3>
          <textarea id="serviceAreas" placeholder="Enter service areas, comma separated"></textarea>
        </div>
        
        <div class="config-section">
          <h3>Certifications</h3>
          <textarea id="certifications" placeholder="Enter certifications, one per line"></textarea>
        </div>
        
        <button onclick="saveConfig()">Save Configuration</button>
      </div>
      
      <script>
        async function loadCompanyConfig() {
          const companyId = document.getElementById('companyId').value;
          if (!companyId) return;
          
          if (companyId === 'new') {
            // Show empty form for new company
            document.getElementById('config-editor').style.display = 'block';
            clearForm();
            return;
          }
          
          // Load existing company config
          const response = await fetch('/api/companies/' + companyId + '/config');
          const config = await response.json();
          
          // Populate form
          document.getElementById('companyName').value = config.companyName;
          document.getElementById('companyPhone').value = config.companyPhone;
          document.getElementById('companyEmail').value = config.companyEmail;
          document.getElementById('website').value = config.website || '';
          
          document.getElementById('agentName').value = config.aiAgent.name;
          document.getElementById('agentRole').value = config.aiAgent.role;
          document.getElementById('agentPersonality').value = config.aiAgent.personality;
          document.getElementById('greeting').value = config.aiAgent.greeting;
          
          // Show form
          document.getElementById('config-editor').style.display = 'block';
        }
        
        async function saveConfig() {
          const companyId = document.getElementById('companyId').value;
          const config = {
            companyName: document.getElementById('companyName').value,
            companyPhone: document.getElementById('companyPhone').value,
            companyEmail: document.getElementById('companyEmail').value,
            website: document.getElementById('website').value,
            aiAgent: {
              name: document.getElementById('agentName').value,
              role: document.getElementById('agentRole').value,
              personality: document.getElementById('agentPersonality').value,
              greeting: document.getElementById('greeting').value
            }
          };
          
          const response = await fetch('/api/companies/' + companyId + '/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
          });
          
          if (response.ok) {
            alert('Configuration saved successfully!');
          } else {
            alert('Error saving configuration');
          }
        }
        
        function clearForm() {
          document.querySelectorAll('input, textarea').forEach(el => el.value = '');
        }
      </script>
    </body>
    </html>
  `);
});

module.exports = router;
