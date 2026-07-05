// Quote Builder view controller
import { getProducts, getSettings, saveQuote, checkJobIdUnique, saveSettings, getCustomers, getSupabase, getCurrentUserProfile, uploadFileToStorage } from './db.js?v=67';
import { formatCurrency, showToast, fileToBase64, generateJobIdSuggestion, compressImage } from './utils.js';
import { navigateToView, viewQuoteDetails } from './app.js?v=67';
import { renderQuoteDetails } from './quotes-list.js?v=67';
import { openCustomerModalInline } from './customers.js?v=67';

let currentQuote = {
  id: null,
  jobId: '',
  quoteNumber: '',
  date: '',
  expirationDate: '',
  customerId: null,
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  projectAddress: '',
  sections: [], // Array<{ id, title, description, items: Array }>
  taxRate: 8.8,
  markupPercent: 15,
  status: 'Pending',
  companyLogo: '',
  notes: '',
  photos: [], 
  printShowDetails: true,
  printShowDetailPricing: true,
  printShowQuantities: true,
  isLegacy: false,
  version: 1
};

let activePhotoUrl = ''; 
let galleryFilterCategory = 'all';
let isTaxRateEdited = false;

export function initQuoteBuilderView() {
  setupBuilderListeners();
}

// Resets form and starts a clean quote
export async function startNewQuote() {
  const settings = await getSettings();
  
  currentQuote = {
    id: null,
    jobId: generateJobIdSuggestion(),
    quoteNumber: '',
    date: new Date().toISOString().split('T')[0],
    expirationDate: '',
    customerId: null,
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    projectAddress: '',
    sections: [
      {
        id: 'sec_' + Math.random().toString(36).substr(2, 9),
        title: 'Section One',
        description: '',
        items: []
      }
    ],
    taxRate: settings.defaultTaxRate || 0,
    taxPlusApplicable: settings.defaultTaxPlusApplicable || false,
    markupPercent: settings.defaultMarkupPercent || 0,
    status: 'Pending',
    companyLogo: settings.companyLogo || '',
    notes: settings.defaultTermsNotes || 'Payment Terms: 50% deposit required upon authorization, 50% upon project completion. Quote is valid until expiration date.',
    photos: [],
    printShowDetails: true,
    printShowDetailPricing: true,
    printShowQuantities: true,
    isLegacy: false,
    version: 1
  };
  isTaxRateEdited = false;

  await populateCustomerSelectDropdown();
  populateBuilderFields();
  await renderBuilderSections();
  renderBuilderGallery();
  calculateTotals();
  
  const updateCostsBtn = document.getElementById('builder-update-costs-btn');
  if (updateCostsBtn) updateCostsBtn.style.display = 'none';

  document.getElementById('builder-title').textContent = 'New Construction Quote';
}

// Edit existing quote
export async function loadQuoteForEditing(quote) {
  const updateCostsBtn = document.getElementById('builder-update-costs-btn');
  if (updateCostsBtn) updateCostsBtn.style.display = 'inline-block';

  currentQuote = JSON.parse(JSON.stringify(quote)); // Deep clone
  if (currentQuote.taxPlusApplicable === undefined) currentQuote.taxPlusApplicable = false;
  if (!currentQuote.photos) currentQuote.photos = [];
  if (!currentQuote.sections) currentQuote.sections = [];
  isTaxRateEdited = false;
  
  // Backward compatibility check
  if (currentQuote.items && currentQuote.sections.length === 0) {
    currentQuote.sections = [{
      id: 'sec_mig_' + Math.random().toString(36).substr(2, 9),
      title: 'General Proposal Details',
      description: 'Standard product and task details carried over from previous format.',
      items: currentQuote.items
    }];
    delete currentQuote.items;
  }
  
  await populateCustomerSelectDropdown();
  populateBuilderFields();
  await renderBuilderSections();
  renderBuilderGallery();
  calculateTotals();
  
  document.getElementById('builder-title').textContent = `Edit Quote - ${quote.jobId}`;
}

// Clone quote as template
export async function loadQuoteAsTemplate(quote) {
  currentQuote = JSON.parse(JSON.stringify(quote));
  if (currentQuote.taxPlusApplicable === undefined) currentQuote.taxPlusApplicable = false;
  if (!currentQuote.photos) currentQuote.photos = [];
  if (!currentQuote.sections) currentQuote.sections = [];
  isTaxRateEdited = false;
  
  if (currentQuote.items && currentQuote.sections.length === 0) {
    currentQuote.sections = [{
      id: 'sec_mig_' + Math.random().toString(36).substr(2, 9),
      title: 'General Proposal Details',
      description: 'Standard details.',
      items: currentQuote.items
    }];
    delete currentQuote.items;
  }

  currentQuote.id = null;
  currentQuote.quoteNumber = '';
  currentQuote.jobId = `${quote.jobId}-COPY`;
  currentQuote.date = new Date().toISOString().split('T')[0];
  currentQuote.status = 'Pending';
  currentQuote.isLegacy = false;
  currentQuote.version = 1;
  
  await populateCustomerSelectDropdown();
  populateBuilderFields();
  await renderBuilderSections();
  renderBuilderGallery();
  calculateTotals();
  
  document.getElementById('builder-title').textContent = `New Quote (From Template: ${quote.jobId})`;
}

// Populate customer dropdown list
export async function populateCustomerSelectDropdown() {
  const dropdown = document.getElementById('builder-customer-select');
  if (!dropdown) return;

  const customers = await getCustomers();
  const visibleCustomers = customers.filter(c => c.status !== 'Inactive' || currentQuote.customerId === c.id);

  dropdown.innerHTML = `
    <option value="">-- Select Existing Customer --</option>
    ${visibleCustomers.map(c => `
      <option value="${c.id}" ${currentQuote.customerId === c.id ? 'selected' : ''}>${escapeHtml(c.name)} ${c.status === 'Inactive' ? '(Inactive)' : ''}</option>
    `).join('')}
  `;
}

// Fills html fields from state
function populateBuilderFields() {
  document.getElementById('builder-job-id').value = currentQuote.jobId;
  document.getElementById('builder-job-id').classList.remove('error');
  document.getElementById('job-id-error').classList.remove('active');
  
  document.getElementById('builder-quote-number').value = currentQuote.quoteNumber || 'Generated automatically';
  const todayStr = new Date().toISOString().split('T')[0];
  document.getElementById('builder-quote-date').value = todayStr;
  currentQuote.date = todayStr;
  document.getElementById('builder-expiry-date').value = currentQuote.expirationDate;
  document.getElementById('builder-customer-name').value = currentQuote.customerName;
  document.getElementById('builder-customer-email').value = currentQuote.customerEmail;
  document.getElementById('builder-customer-phone').value = currentQuote.customerPhone;
  document.getElementById('builder-project-address').value = currentQuote.projectAddress;
  document.getElementById('builder-markup').value = currentQuote.markupPercent;
  document.getElementById('builder-tax').value = currentQuote.taxRate;
  document.getElementById('builder-notes').value = currentQuote.notes;

  const plusTaxCheck = document.getElementById('builder-tax-plus-applicable');
  if (plusTaxCheck) {
    plusTaxCheck.checked = currentQuote.taxPlusApplicable || false;
    document.getElementById('builder-tax').disabled = currentQuote.taxPlusApplicable || false;
  }

  const detCheck = document.getElementById('print-show-details');
  const prCheck = document.getElementById('print-show-pricing');
  const qtyCheck = document.getElementById('print-show-quantities');

  if (detCheck) detCheck.checked = currentQuote.printShowDetails !== false;
  if (prCheck) prCheck.checked = currentQuote.printShowDetailPricing !== false;
  if (qtyCheck) qtyCheck.checked = currentQuote.printShowQuantities !== false;

  updatePrintOptionsUI();

  const logoPreview = document.getElementById('builder-logo-preview');
  const logoClearBtn = document.getElementById('builder-logo-clear-btn');
  const saveDefaultCheckbox = document.getElementById('builder-save-default-logo');
  
  saveDefaultCheckbox.checked = false;
  
  if (currentQuote.companyLogo) {
    logoPreview.innerHTML = `<img src="${currentQuote.companyLogo}" alt="Logo Preview">`;
    if (logoClearBtn) logoClearBtn.style.display = 'flex';
  } else {
    logoPreview.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    `;
    if (logoClearBtn) logoClearBtn.style.display = 'none';
  }
}

function updatePrintOptionsUI() {
  const detCheck = document.getElementById('print-show-details');
  const wrapper = document.getElementById('print-show-pricing-wrapper');
  if (detCheck && wrapper) {
    if (detCheck.checked) {
      wrapper.style.opacity = '1';
      wrapper.querySelector('input').disabled = false;
    } else {
      wrapper.style.opacity = '0.5';
      wrapper.querySelector('input').disabled = true;
    }
  }
}

/* ==================== SECTIONS RENDER WORKSPACE ==================== */
export async function renderBuilderSections() {
  const container = document.getElementById('builder-sections-container');
  if (!container) return;

  const products = await getProducts();
  const activeProducts = products.filter(p => p.status !== 'Inactive');
  activeProducts.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  const productsDropdownHtml = `
    <option value="">-- Add Product from Database --</option>
    ${activeProducts.map(p => `
      <option value="${p.id}">[${escapeHtml(p.category)}] ${escapeHtml(p.name)} - ${formatCurrency(p.price)}/UOM</option>
    `).join('')}
  `;

  if (currentQuote.sections.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 3rem; background-color: var(--bg-secondary); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
        Quote has no sections. Click below to add a section.
      </div>
    `;
    return;
  }

  container.innerHTML = currentQuote.sections.map((section, secIdx) => {
    const isOnlyOne = currentQuote.sections.length === 1;
    
    let rowsHtml = '';
    if (section.items.length === 0) {
      rowsHtml = `
        <tr class="empty-builder-row">
          <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.5rem; font-style: italic;">
            No items in this section. Add catalog items or tasks below.
          </td>
        </tr>
      `;
    } else {
      rowsHtml = section.items.map((item, itemIdx) => {
        const isLaborOnly = item.isLaborOnly === true;
        const itemTotal = item.qty * (item.price + item.laborRate);
        const itemMarkup = item.markupPercent !== undefined ? item.markupPercent : (currentQuote.markupPercent || 0);
        const markedUpTotal = itemTotal * (1 + itemMarkup / 100);
        
        return `
          <tr data-sec-idx="${secIdx}" data-item-idx="${itemIdx}">
            <td>
              ${isLaborOnly ? `
                <input type="text" class="item-row-input item-name-input" value="${escapeHtml(item.name)}" placeholder="Labor task name..." required>
              ` : `
                <div style="font-weight: 600; font-size: 0.9rem;" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
                <div style="font-size: 0.7rem; color: var(--text-muted);">${escapeHtml(item.description || 'No description')}</div>
              `}
            </td>
            <td>
              <span class="badge ${item.category.toLowerCase() === 'labor' ? 'badge-pending' : 'badge-legacy'}">${escapeHtml(item.category)}</span>
            </td>
            <td>
              ${isLaborOnly ? `
                <select class="item-row-input item-uom-input">
                  <option value="EA" ${item.uom === 'EA' ? 'selected' : ''}>EA</option>
                  <option value="LF" ${item.uom === 'LF' ? 'selected' : ''}>LF</option>
                  <option value="SF" ${item.uom === 'SF' ? 'selected' : ''}>SF</option>
                  <option value="SY" ${item.uom === 'SY' ? 'selected' : ''}>SY</option>
                </select>
              ` : `
                <span style="font-weight: 500;">${item.uom}</span>
              `}
            </td>
            <td>
              <input type="number" class="item-row-input item-qty-input" value="${item.qty}" min="0.01" step="any" style="width: 65px;" required>
            </td>
            <td>
              <input type="number" class="item-row-input item-price-input" value="${item.price.toFixed(2)}" min="0" step="0.01" style="width: 80px;" ${isLaborOnly ? 'disabled style="opacity: 0.5;"' : ''}>
            </td>
            <td>
              <input type="number" class="item-row-input item-labor-input" value="${item.laborRate.toFixed(2)}" min="0" step="0.01" style="width: 80px;">
            </td>
            <td>
              <input type="number" class="item-row-input item-markup-input" value="${item.markupPercent !== undefined ? item.markupPercent : ''}" min="-100" step="1" style="width: 55px;" placeholder="${currentQuote.markupPercent || 0}%">
            </td>
            <td class="builder-item-cost-total" style="font-weight: 500; color: var(--text-muted); text-align: right; font-size: 0.85rem; vertical-align: middle;">
              ${formatCurrency(itemTotal)}
            </td>
            <td class="builder-item-markedup-total" style="font-weight: 700; color: var(--text-primary); text-align: right; font-size: 0.9rem; vertical-align: middle;">
              ${formatCurrency(markedUpTotal)}
            </td>
            <td style="text-align: right; vertical-align: middle;">
              <button type="button" class="item-delete-btn remove-item-btn" title="Remove Item">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }

    return `
      <div class="widget-card section-card" data-sec-idx="${secIdx}" style="padding: 1.25rem; margin-bottom: 1.25rem;">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; gap: 0.5rem;">
          <div style="display: flex; flex-direction: column; gap: 0.25rem; flex-grow: 1;">
            <input type="text" class="section-title-input" value="${escapeHtml(section.title)}" placeholder="e.g. Scope Part 1 - Concrete foundations" required style="font-size: 1.05rem; font-weight: 700; border: none; padding: 0.2rem; background: transparent; width: 100%;">
            <textarea class="section-desc-input" placeholder="Describe the scope of work for this section here..." rows="2" style="font-size: 0.8rem; border: none; padding: 0.2rem; background: transparent; width: 100%; resize: vertical; outline: none; font-family: var(--font-main); color: var(--text-secondary);">${escapeHtml(section.description || '')}</textarea>
          </div>
          ${isOnlyOne ? '' : `
            <button type="button" class="btn btn-secondary btn-icon-only remove-section-btn" style="color: var(--danger); padding: 0.35rem;" title="Delete Entire Section">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          `}
        </div>

        <div class="table-container" style="margin: 0.75rem 0 0.5rem 0;">
          <table class="custom-table select-table" style="font-size: 0.85rem;">
            <thead>
              <tr>
                <th style="width: 28%;">Item Detail</th>
                <th style="width: 9%;">Category</th>
                <th style="width: 6%;">UOM</th>
                <th style="width: 6%;">Qty</th>
                <th style="width: 9%;">Material ($)</th>
                <th style="width: 9%;">Labor ($)</th>
                <th style="width: 8%; text-align: center;">Markup %</th>
                <th style="width: 10%; text-align: right;">Cost Sub</th>
                <th style="width: 11%; text-align: right;">Total w/ Markup</th>
                <th style="width: 4%;"></th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>

        <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; justify-content: space-between; align-items: center; flex-wrap: wrap;">
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <select class="form-select section-product-select" style="padding: 0.35rem; font-size: 0.8rem; width: 220px;">
              ${productsDropdownHtml}
            </select>
            <button type="button" class="btn btn-secondary section-add-labor-btn" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
              ➕ Custom Labor
            </button>
          </div>
          <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); display: flex; gap: 1.5rem;">
            <span>Cost Subtotal: <span class="section-subtotal-value" style="color: var(--text-muted); font-weight: 500;">${formatCurrency(calculateSectionSum(section))}</span></span>
            <span>Subtotal w/ Markup: <span class="section-markedup-subtotal-value" style="color: var(--primary);">${formatCurrency(section.items.reduce((sum, item) => sum + (item.qty * (item.price + item.laborRate) * (1 + (item.markupPercent !== undefined ? item.markupPercent : (currentQuote.markupPercent || 0)) / 100)), 0))}</span> <span class="section-markup-percentage-value" style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">(${(calculateSectionSum(section) > 0 ? ((section.items.reduce((sum, item) => sum + (item.qty * (item.price + item.laborRate) * (1 + (item.markupPercent !== undefined ? item.markupPercent : (currentQuote.markupPercent || 0)) / 100)), 0) - calculateSectionSum(section)) / calculateSectionSum(section)) * 100 : (currentQuote.markupPercent || 0)).toFixed(1)}%)</span></span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function calculateSectionSum(section) {
  return section.items.reduce((sum, item) => sum + (item.qty * (item.price + item.laborRate)), 0);
}

function updateBuilderMarkedUpTotals() {
  const globalMarkup = currentQuote.markupPercent || 0;
  currentQuote.sections.forEach((section, secIdx) => {
    let secCostSum = 0;
    let secMarkedUpSum = 0;
    
    section.items.forEach((item, itemIdx) => {
      const itemTotal = item.qty * (item.price + item.laborRate);
      const itemMarkup = item.markupPercent !== undefined ? item.markupPercent : globalMarkup;
      const markedUpTotal = itemTotal * (1 + itemMarkup / 100);
      secCostSum += itemTotal;
      secMarkedUpSum += markedUpTotal;
      
      const row = document.querySelector(`tr[data-sec-idx="${secIdx}"][data-item-idx="${itemIdx}"]`);
      if (row) {
        const costCell = row.querySelector('.builder-item-cost-total');
        if (costCell) costCell.textContent = formatCurrency(itemTotal);
        const markupCell = row.querySelector('.builder-item-markedup-total');
        if (markupCell) markupCell.textContent = formatCurrency(markedUpTotal);
      }
    });
    
    const secCard = document.querySelector(`.section-card[data-sec-idx="${secIdx}"]`);
    if (secCard) {
      const subtotalEl = secCard.querySelector('.section-subtotal-value');
      if (subtotalEl) subtotalEl.textContent = formatCurrency(secCostSum);
      const markedUpSpan = secCard.querySelector('.section-markedup-subtotal-value');
      if (markedUpSpan) {
        markedUpSpan.textContent = formatCurrency(secMarkedUpSum);
      }
      const pctSpan = secCard.querySelector('.section-markup-percentage-value');
      if (pctSpan) {
        const effectiveMarkup = secCostSum > 0 ? ((secMarkedUpSum - secCostSum) / secCostSum) * 100 : globalMarkup;
        pctSpan.textContent = `(${effectiveMarkup.toFixed(1)}%)`;
      }
    }
  });
}

/* ==================== PHOTO GALLERY RENDER ==================== */
function renderBuilderGallery() {
  const container = document.getElementById('builder-gallery-grid');
  if (!container) return;

  const photos = currentQuote.photos || [];
  const filtered = galleryFilterCategory === 'all' ? photos : photos.filter(p => p.category === galleryFilterCategory);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 1.5rem; border: 1px dashed var(--border-color); border-radius: var(--radius-sm);">
        No photos attached under this category.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(p => `
    <div class="photo-thumbnail-card" data-photo-id="${p.id}">
      <img src="${p.url}" alt="Attachment">
      <button type="button" class="remove-gallery-photo-btn" title="Remove Photo">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="12" height="12">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <div class="photo-category-label">${escapeHtml(p.category)}</div>
      <div class="photo-title-label" title="${escapeHtml(p.label)}">${escapeHtml(p.label)}</div>
    </div>
  `).join('');
}

/* ==================== PRICING COMPUTATION ==================== */
function calculateTotals() {
  const subtotal = currentQuote.sections.reduce((sum, sec) => sum + calculateSectionSum(sec), 0);
  
  const markupVal = currentQuote.sections.reduce((sum, sec) => {
    return sum + sec.items.reduce((itemSum, item) => {
      const itemTotal = item.qty * (item.price + item.laborRate);
      const itemMarkup = item.markupPercent !== undefined ? item.markupPercent : (currentQuote.markupPercent || 0);
      return itemSum + (itemTotal * (itemMarkup / 100));
    }, 0);
  }, 0);

  const isPlusTaxes = currentQuote.taxPlusApplicable || false;
  const taxVal = isPlusTaxes ? 0 : (subtotal + markupVal) * (currentQuote.taxRate / 100);
  const grandTotal = subtotal + markupVal + taxVal;

  document.getElementById('builder-summary-subtotal').textContent = formatCurrency(subtotal);
  document.getElementById('builder-summary-markup-val').textContent = formatCurrency(markupVal);
  
  const effectiveMarkupPct = subtotal > 0 ? (markupVal / subtotal) * 100 : (currentQuote.markupPercent || 0);
  const builderSummaryMarkupPct = document.getElementById('builder-summary-markup-pct');
  if (builderSummaryMarkupPct) {
    builderSummaryMarkupPct.textContent = `${effectiveMarkupPct.toFixed(1)}%`;
  }
  
  const taxSummaryVal = document.getElementById('builder-summary-tax-val');
  if (isPlusTaxes) {
    taxSummaryVal.textContent = "Plus Applicable Taxes";
  } else {
    taxSummaryVal.textContent = formatCurrency(taxVal);
  }
  
  document.getElementById('builder-summary-total').textContent = formatCurrency(grandTotal);
}

let isBuilderListenersSetup = false;

/* ==================== EVENT BINDINGS ==================== */
function setupBuilderListeners() {
  if (isBuilderListenersSetup) return;
  isBuilderListenersSetup = true;
  const container = document.getElementById('builder-sections-container');
  const addSectionBtn = document.getElementById('builder-add-section-btn');
  
  const customerSelect = document.getElementById('builder-customer-select');
  const customerAddBtn = document.getElementById('builder-add-customer-inline');
  const jobIdInput = document.getElementById('builder-job-id');
  const dateInput = document.getElementById('builder-quote-date');
  const expiryInput = document.getElementById('builder-expiry-date');
  
  const clientNameInput = document.getElementById('builder-customer-name');
  const clientEmailInput = document.getElementById('builder-customer-email');
  const clientPhoneInput = document.getElementById('builder-customer-phone');
  const clientAddressInput = document.getElementById('builder-project-address');
  
  const markupInput = document.getElementById('builder-markup');
  const taxInput = document.getElementById('builder-tax');
  const notesTextarea = document.getElementById('builder-notes');
  
  const printDetailsCheck = document.getElementById('print-show-details');
  const printPricingCheck = document.getElementById('print-show-pricing');
  const printQtyCheck = document.getElementById('print-show-quantities');

  const logoUpload = document.getElementById('builder-logo-upload');
  const logoClear = document.getElementById('builder-logo-clear-btn');

  const galleryUpload = document.getElementById('builder-gallery-upload');
  const photoFormFields = document.getElementById('builder-photo-add-fields');
  const photoSaveBtn = document.getElementById('builder-photo-save');
  const photoCancelBtn = document.getElementById('builder-photo-cancel');
  const galleryTabs = document.getElementById('builder-gallery-tabs');
  const galleryTbody = document.getElementById('builder-gallery-grid');

  const saveBtn = document.getElementById('builder-save-btn');
  const cancelBtn = document.getElementById('builder-cancel-btn');

  const profile = getCurrentUserProfile();

  // Print checkbox changes
  if (printDetailsCheck) {
    printDetailsCheck.addEventListener('change', () => {
      currentQuote.printShowDetails = printDetailsCheck.checked;
      updatePrintOptionsUI();
    });
  }
  if (printPricingCheck) {
    printPricingCheck.addEventListener('change', () => {
      currentQuote.printShowDetailPricing = printPricingCheck.checked;
    });
  }
  if (printQtyCheck) {
    printQtyCheck.addEventListener('change', () => {
      currentQuote.printShowQuantities = printQtyCheck.checked;
    });
  }

  // Quote info input changes
  if (dateInput) {
    dateInput.addEventListener('change', () => {
      currentQuote.date = dateInput.value;
    });
  }
  if (expiryInput) {
    expiryInput.addEventListener('change', () => {
      currentQuote.expirationDate = expiryInput.value;
    });
  }
  if (clientNameInput) {
    clientNameInput.addEventListener('input', () => {
      currentQuote.customerName = clientNameInput.value.trim();
    });
  }
  if (clientEmailInput) {
    clientEmailInput.addEventListener('input', () => {
      currentQuote.customerEmail = clientEmailInput.value.trim();
    });
  }
  if (clientPhoneInput) {
    clientPhoneInput.addEventListener('input', () => {
      currentQuote.customerPhone = clientPhoneInput.value.trim();
    });
  }
  if (clientAddressInput) {
    clientAddressInput.addEventListener('input', () => {
      currentQuote.projectAddress = clientAddressInput.value.trim();
    });
  }

  if (markupInput) {
    markupInput.addEventListener('input', () => {
      currentQuote.markupPercent = parseFloat(markupInput.value) || 0;
      calculateTotals();
      updateBuilderMarkedUpTotals();
    });
  }
  if (taxInput) {
    taxInput.addEventListener('input', () => {
      currentQuote.taxRate = parseFloat(taxInput.value) || 0;
      isTaxRateEdited = true;
    });
  }
  if (notesTextarea) {
    notesTextarea.addEventListener('input', () => {
      currentQuote.notes = notesTextarea.value;
    });
  }
  const taxPlusCheck = document.getElementById('builder-tax-plus-applicable');
  if (taxPlusCheck) {
    taxPlusCheck.addEventListener('change', () => {
      currentQuote.taxPlusApplicable = taxPlusCheck.checked;
      if (taxInput) taxInput.disabled = taxPlusCheck.checked;
      calculateTotals();
    });
  }

  // Add Section Button
  if (addSectionBtn) {
    addSectionBtn.addEventListener('click', async () => {
      currentQuote.sections.push({
        id: 'sec_' + Math.random().toString(36).substr(2, 9),
        title: `Section ${currentQuote.sections.length + 1} - Scope Details`,
        description: '',
        items: []
      });
      await renderBuilderSections();
      calculateTotals();
      showToast('New section added.');
    });
  }

  // Bind key inputs within Sections (Title, Description, Qty, Prices, Removal)
  if (container) {
    // Title and description inputs
    container.addEventListener('input', (e) => {
      const card = e.target.closest('.section-card');
      if (!card) return;
      const secIdx = parseInt(card.getAttribute('data-sec-idx'));
      const section = currentQuote.sections[secIdx];

      if (e.target.classList.contains('section-title-input')) {
        section.title = e.target.value;
      }
      if (e.target.classList.contains('section-desc-input')) {
        section.description = e.target.value;
      }

      // Qty/Price input rows
      const row = e.target.closest('tr');
      if (row) {
        const itemIdx = parseInt(row.getAttribute('data-item-idx'));
        const item = section.items[itemIdx];

        if (e.target.classList.contains('item-qty-input')) {
          item.qty = parseFloat(e.target.value) || 0.01;
        }
        if (e.target.classList.contains('item-price-input')) {
          item.price = parseFloat(e.target.value) || 0;
        }
        if (e.target.classList.contains('item-labor-input')) {
          item.laborRate = parseFloat(e.target.value) || 0;
        }
        if (e.target.classList.contains('item-name-input')) {
          item.name = e.target.value;
        }
        if (e.target.classList.contains('item-markup-input')) {
          const val = e.target.value.trim();
          if (val === '') {
            delete item.markupPercent;
          } else {
            item.markupPercent = parseFloat(val);
            if (isNaN(item.markupPercent)) delete item.markupPercent;
          }
        }

        // Trigger subtotal update
        const itemTotal = item.qty * (item.price + item.laborRate);
        const costCell = row.querySelector('.builder-item-cost-total');
        if (costCell) costCell.textContent = formatCurrency(itemTotal);
        
        const itemMarkup = item.markupPercent !== undefined ? item.markupPercent : (currentQuote.markupPercent || 0);
        const markedUpTotal = itemTotal * (1 + itemMarkup / 100);
        const markupCell = row.querySelector('.builder-item-markedup-total');
        if (markupCell) markupCell.textContent = formatCurrency(markedUpTotal);
        
        // Update section subtotal and grand totals
        const subtotalEl = card.querySelector('.section-subtotal-value');
        if (subtotalEl) {
          subtotalEl.textContent = formatCurrency(calculateSectionSum(section));
        }
        const markedUpSpan = card.querySelector('.section-markedup-subtotal-value');
        if (markedUpSpan) {
          const secMarkedUp = section.items.reduce((sum, it) => sum + (it.qty * (it.price + it.laborRate) * (1 + (it.markupPercent !== undefined ? it.markupPercent : (currentQuote.markupPercent || 0)) / 100)), 0);
          markedUpSpan.textContent = formatCurrency(secMarkedUp);
          
          const pctSpan = card.querySelector('.section-markup-percentage-value');
          if (pctSpan) {
            const secCost = calculateSectionSum(section);
            const effectiveMarkup = secCost > 0 ? ((secMarkedUp - secCost) / secCost) * 100 : (currentQuote.markupPercent || 0);
            pctSpan.textContent = `(${effectiveMarkup.toFixed(1)}%)`;
          }
        }
        calculateTotals();
      }
    });

    // Handle Selectors and Remove buttons inside Sections
    container.addEventListener('change', async (e) => {
      const card = e.target.closest('.section-card');
      if (!card) return;
      const secIdx = parseInt(card.getAttribute('data-sec-idx'));
      const section = currentQuote.sections[secIdx];

      const row = e.target.closest('tr');
      if (row) {
        const itemIdx = parseInt(row.getAttribute('data-item-idx'));
        const item = section.items[itemIdx];
        if (e.target.classList.contains('item-uom-input')) {
          item.uom = e.target.value;
        }
      }

      // Catalog Product Dropdown Additions
      if (e.target.classList.contains('section-product-select')) {
        const prodId = e.target.value;
        if (!prodId) return;

        const products = await getProducts();
        const p = products.find(prod => prod.id === prodId);
        if (p) {
          section.items.push({
            productId: p.id,
            name: p.name,
            category: p.category,
            uom: p.uom,
            price: p.price,
            laborRate: p.laborRate || 0,
            description: p.description || '',
            qty: 1,
            isLaborOnly: false
          });

          await renderBuilderSections();
          calculateTotals();
          showToast(`Added "${p.name}" to section.`);
        }
      }
    });

    container.addEventListener('click', async (e) => {
      const card = e.target.closest('.section-card');
      if (!card) return;
      const secIdx = parseInt(card.getAttribute('data-sec-idx'));
      const section = currentQuote.sections[secIdx];

      // Delete Section Button
      const removeSecBtn = e.target.closest('.remove-section-btn');
      if (removeSecBtn) {
        if (confirm(`Delete the entire section "${section.title}" and all its line items?`)) {
          currentQuote.sections.splice(secIdx, 1);
          await renderBuilderSections();
          calculateTotals();
          showToast('Section deleted.');
        }
        return;
      }

      // Add Labor Row Button
      const addLaborBtn = e.target.closest('.section-add-labor-btn');
      if (addLaborBtn) {
        section.items.push({
          productId: null,
          name: 'Custom Labor Task',
          category: 'Labor',
          uom: 'LF',
          price: 0,
          laborRate: 15.00,
          description: 'Custom labor description',
          qty: 1,
          isLaborOnly: true
        });

        await renderBuilderSections();
        calculateTotals();
        showToast('Created labor line.');
        return;
      }

      // Remove Item Row Button
      const removeBtn = e.target.closest('.remove-item-btn');
      if (removeBtn) {
        const row = removeBtn.closest('tr');
        const itemIdx = parseInt(row.getAttribute('data-item-idx'));
        section.items.splice(itemIdx, 1);
        await renderBuilderSections();
        calculateTotals();
        showToast('Line item removed.');
      }
    });
  }

  // Customer Dropdown Select fill
  if (customerSelect) {
    customerSelect.addEventListener('change', async () => {
      const custId = customerSelect.value;
      const settings = await getSettings();
      if (custId) {
        const customers = await getCustomers();
        const c = customers.find(cust => cust.id === custId);
        if (c) {
          document.getElementById('builder-customer-name').value = c.name;
          document.getElementById('builder-customer-email').value = c.email || '';
          document.getElementById('builder-customer-phone').value = c.phone || '';
          document.getElementById('builder-project-address').value = c.address;
          
          currentQuote.customerId = c.id;
          currentQuote.customerName = c.name;
          currentQuote.customerEmail = c.email || '';
          currentQuote.customerPhone = c.phone || '';
          currentQuote.projectAddress = c.address;

          // Default markup
          const defaultMarkup = c.defaultMarkupPercent > 0 ? c.defaultMarkupPercent : (settings.defaultMarkupPercent || 15);
          currentQuote.markupPercent = defaultMarkup;
          document.getElementById('builder-markup').value = defaultMarkup;

          // Default terms
          const defaultTerms = c.defaultTermsNotes ? c.defaultTermsNotes : (settings.defaultTermsNotes || '');
          currentQuote.notes = defaultTerms;
          document.getElementById('builder-notes').value = defaultTerms;

          // Default plus tax applicable
          const plusTax = c.defaultTaxPlusApplicable !== undefined ? c.defaultTaxPlusApplicable : (settings.defaultTaxPlusApplicable || false);
          currentQuote.taxPlusApplicable = plusTax;
          const plusTaxCheck = document.getElementById('builder-tax-plus-applicable');
          if (plusTaxCheck) {
            plusTaxCheck.checked = plusTax;
            if (taxInput) taxInput.disabled = plusTax;
          }

          showToast(`Linked customer "${c.name}" defaults.`);
          calculateTotals();
        }
      } else {
        currentQuote.customerId = null;
        // Revert to global settings defaults
        const defaultMarkup = settings.defaultMarkupPercent || 15;
        currentQuote.markupPercent = defaultMarkup;
        document.getElementById('builder-markup').value = defaultMarkup;

        const defaultTerms = settings.defaultTermsNotes || '';
        currentQuote.notes = defaultTerms;
        document.getElementById('builder-notes').value = defaultTerms;

        const plusTax = settings.defaultTaxPlusApplicable || false;
        currentQuote.taxPlusApplicable = plusTax;
        const plusTaxCheck = document.getElementById('builder-tax-plus-applicable');
        if (plusTaxCheck) {
          plusTaxCheck.checked = plusTax;
          if (taxInput) taxInput.disabled = plusTax;
        }

        calculateTotals();
      }
    });
  }

  // Inline Customer Create
  if (customerAddBtn) {
    customerAddBtn.addEventListener('click', () => {
      openCustomerModalInline(async (newCustomer) => {
        await populateCustomerSelectDropdown();
        customerSelect.value = newCustomer.id;
        document.getElementById('builder-customer-name').value = newCustomer.name;
        document.getElementById('builder-customer-email').value = newCustomer.email || '';
        document.getElementById('builder-customer-phone').value = newCustomer.phone || '';
        document.getElementById('builder-project-address').value = newCustomer.address;
        
        currentQuote.customerId = newCustomer.id;
        currentQuote.customerName = newCustomer.name;
        currentQuote.customerEmail = newCustomer.email || '';
        currentQuote.customerPhone = newCustomer.phone || '';
        currentQuote.projectAddress = newCustomer.address;
        showToast(`Created and linked customer: "${newCustomer.name}"`);
      });
    });
  }

  // Job ID Unique Validation
  if (jobIdInput) {
    jobIdInput.addEventListener('input', async () => {
      const val = jobIdInput.value.trim();
      const errSpan = document.getElementById('job-id-error');
      
      if (!val) {
        jobIdInput.classList.add('error');
        return;
      }

      const isUnique = await checkJobIdUnique(val, currentQuote.id);
      if (!isUnique) {
        jobIdInput.classList.add('error');
        errSpan.classList.add('active');
      } else {
        jobIdInput.classList.remove('error');
        errSpan.classList.remove('active');
      }
      currentQuote.jobId = val;
    });
  }

  // Logo uploading to Supabase Storage
  if (logoUpload) {
    logoUpload.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const sb = getSupabase();
        if (sb && profile) {
          showToast('Uploading company logo...');
          const filePath = `${profile.company_id}/logo_${Math.random().toString(36).substr(2, 9)}_${file.name}`;
          const { error } = await uploadFileToStorage('company-logos', filePath, file);
          
          if (error) {
            showToast('Upload failed: ' + error.message, 'danger');
            return;
          }
          
          const { data: { publicUrl } } = sb.storage.from('company-logos').getPublicUrl(filePath);
          currentQuote.companyLogo = publicUrl;
          
          const logoPreview = document.getElementById('builder-logo-preview');
          logoPreview.innerHTML = `<img src="${publicUrl}" alt="Logo Preview">`;
          if (logoClear) logoClear.style.display = 'flex';
          
          showToast('Company logo updated.');
        } else {
          showToast('Database connection not established.', 'danger');
        }
      }
    });
  }

  if (logoClear) {
    logoClear.addEventListener('click', () => {
      currentQuote.companyLogo = '';
      const logoPreview = document.getElementById('builder-logo-preview');
      logoPreview.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      `;
      logoClear.style.display = 'none';
      logoUpload.value = '';
      showToast('Logo cleared.');
    });
  }

  /* ==================== PHOTO GALLERY ACTIONS ==================== */
  if (galleryUpload) {
    galleryUpload.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const sb = getSupabase();
        if (sb && profile) {
          showToast('Uploading project gallery photo...');
          const filePath = `${profile.company_id}/builder_${Math.random().toString(36).substr(2, 9)}_${file.name}`;
          const { error } = await uploadFileToStorage('project-photos', filePath, file);
          
          if (error) {
            showToast('Upload failed: ' + error.message, 'danger');
            return;
          }
          
          const { data: { publicUrl } } = sb.storage.from('project-photos').getPublicUrl(filePath);
          activePhotoUrl = publicUrl;

          document.getElementById('builder-photo-temp-preview').src = publicUrl;
          document.getElementById('builder-photo-label').value = '';
          document.getElementById('builder-photo-category').value = 'before';
          
          photoFormFields.style.display = 'flex';
          photoFormFields.scrollIntoView({ behavior: 'smooth' });
        } else {
          showToast('Database connection not established.', 'danger');
        }
      }
    });
  }

  if (photoSaveBtn) {
    photoSaveBtn.addEventListener('click', () => {
      const category = document.getElementById('builder-photo-category').value;
      const label = document.getElementById('builder-photo-label').value.trim() || 'Project Gallery Photo';

      if (!activePhotoUrl) {
        showToast('No active photo to attach.', 'danger');
        return;
      }

      currentQuote.photos.push({
        id: 'img_' + Math.random().toString(36).substr(2, 9),
        url: activePhotoUrl,
        label,
        category
      });

      activePhotoUrl = '';
      photoFormFields.style.display = 'none';
      galleryUpload.value = ''; 

      renderBuilderGallery();
      showToast('Photo attached to project gallery.');
    });
  }

  if (photoCancelBtn) {
    photoCancelBtn.addEventListener('click', () => {
      activePhotoUrl = '';
      photoFormFields.style.display = 'none';
      galleryUpload.value = '';
      showToast('Photo upload discarded.');
    });
  }

  if (galleryTabs) {
    galleryTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.filter-tab');
      if (tab) {
        galleryTabs.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        galleryFilterCategory = tab.getAttribute('data-cat');
        renderBuilderGallery();
      }
    });
  }

  if (galleryTbody) {
    galleryTbody.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.remove-gallery-photo-btn');
      if (deleteBtn) {
        const card = deleteBtn.closest('.photo-thumbnail-card');
        const id = card.getAttribute('data-photo-id');
        
        if (confirm('Are you sure you want to remove this photo?')) {
          currentQuote.photos = currentQuote.photos.filter(p => p.id !== id);
          renderBuilderGallery();
          showToast('Project photo removed.');
        }
      }
    });
  }

  /* ==================== GENERAL SAVE & CANCEL ==================== */
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const jobId = document.getElementById('builder-job-id').value.trim();
      const expiry = document.getElementById('builder-expiry-date').value;
      const clientName = document.getElementById('builder-customer-name').value.trim();
      const clientAddress = document.getElementById('builder-project-address').value.trim();

      if (!jobId) {
        showToast('Job ID is required.', 'danger');
        document.getElementById('builder-job-id').focus();
        return;
      }
      
      const isUnique = await checkJobIdUnique(jobId, currentQuote.id);
      if (!isUnique) {
        showToast('Job ID must be unique. This one is taken.', 'danger');
        document.getElementById('builder-job-id').focus();
        return;
      }

      if (!expiry) {
        showToast('An Expiration Date is required.', 'danger');
        document.getElementById('builder-expiry-date').focus();
        return;
      }

      if (!clientName) {
        showToast('Client Name is required.', 'danger');
        document.getElementById('builder-customer-name').focus();
        return;
      }

      if (!clientAddress) {
        showToast('Project Address is required.', 'danger');
        document.getElementById('builder-project-address').focus();
        return;
      }

      const totalItems = currentQuote.sections.reduce((acc, sec) => acc + sec.items.length, 0);
      if (totalItems === 0) {
        showToast('Quote must have at least one line item in a section.', 'danger');
        return;
      }

      if (!currentQuote.taxPlusApplicable && !isTaxRateEdited) {
        if (!confirm(`You have not modified the sales tax rate. Are you sure you want to save with the current tax rate of ${currentQuote.taxRate}%?`)) {
          return;
        }
      }

      const missingTitle = currentQuote.sections.some(s => !s.title.trim());
      if (missingTitle) {
        showToast('All quote sections must have a Section Title.', 'danger');
        return;
      }

      const todayStr = new Date().toISOString().split('T')[0];
      currentQuote.date = todayStr;
      currentQuote.jobId = jobId;
      currentQuote.expirationDate = expiry;
      currentQuote.customerName = clientName;
      currentQuote.customerEmail = document.getElementById('builder-customer-email').value.trim();
      currentQuote.customerPhone = document.getElementById('builder-customer-phone').value.trim();
      currentQuote.projectAddress = clientAddress;

      const saveDefaultCheckbox = document.getElementById('builder-save-default-logo');
      if (saveDefaultCheckbox && saveDefaultCheckbox.checked && currentQuote.companyLogo) {
        await saveSettings({ companyLogo: currentQuote.companyLogo });
      }

      const result = await saveQuote(currentQuote);
      if (result.success) {
        showToast(currentQuote.id ? 'Changes saved to quote.' : 'Quote created successfully.');
        await renderQuoteDetails(result.quote.id);
        navigateToView('detail-view');
      } else {
        showToast(result.error, 'danger');
      }
    });
  }

  const updateCostsBtn = document.getElementById('builder-update-costs-btn');
  if (updateCostsBtn) {
    updateCostsBtn.addEventListener('click', async () => {
      showToast('Fetching latest product catalog costs...');
      const products = await getProducts();
      let updatedCount = 0;
      
      currentQuote.sections.forEach(section => {
        section.items.forEach(item => {
          let p = null;
          // Match by ID first, fallback to case-insensitive name match
          if (item.productId) {
            p = products.find(prod => prod.id === item.productId);
          }
          if (!p && item.name) {
            p = products.find(prod => prod.name.trim().toLowerCase() === item.name.trim().toLowerCase());
          }
          
          if (p) {
            const oldPrice = item.price;
            const oldLabor = item.laborRate || 0;
            const newPrice = p.price;
            const newLabor = p.laborRate || 0;
            
            if (oldPrice !== newPrice || oldLabor !== newLabor) {
              item.price = newPrice;
              item.laborRate = newLabor;
              item.uom = p.uom || item.uom;
              item.category = p.category || item.category;
              updatedCount++;
            }
          }
        });
      });

      if (updatedCount > 0) {
        await renderBuilderSections();
        calculateTotals();
        showToast(`Successfully updated ${updatedCount} quote item(s) to current catalog costs.`, 'success');
      } else {
        showToast('All quote items are already up to date with the catalog.', 'info');
      }
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (confirm('Discard changes?')) {
        if (currentQuote.id) {
          viewQuoteDetails(currentQuote.id);
        } else {
          navigateToView('quotes-view');
        }
      }
    });
  }
}

function escapeHtml(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
