// Quotes List & Dashboard management controller
import { getQuotes, getQuoteById, saveQuote, saveQuotesRaw, deleteQuote, getProducts, getSettings, getCurrentUserProfile, getSupabase, uploadFileToStorage, getSubscriptionLevel } from './db.js?v=65';
import { formatCurrency, formatDate, showToast, formatDateTime, fileToBase64, compressImage } from './utils.js';
import { navigateToView, editQuote, duplicateQuoteAsTemplate } from './app.js?v=65';

let activeStatusFilter = 'pending';
let activeSearchQuery = '';
let selectedQuoteId = null;
let detailPhotoBase64 = '';

export async function initQuotesListView() {
  console.log('initQuotesListView -> Starting...');
  await renderDashboardStats();
  await renderDashboardExpirations();
  await renderQuotesTable();
  console.log('initQuotesListView -> Rendering finished, calling setupListListeners...');
  setupListListeners();
}

/* ==================== DASHBOARD SECTION ==================== */
export async function renderDashboardStats() {
  const quotes = (await getQuotes()).filter(q => !q.isLegacy);

  const pendingQuotes = quotes.filter(q => q.status === 'Pending');
  const wonQuotes = quotes.filter(q => q.status === 'Won');
  const lostQuotes = quotes.filter(q => q.status === 'Lost');
  const completedQuotes = quotes.filter(q => q.status === 'Completed');

  const pendingValue = pendingQuotes.reduce((acc, q) => {
    const sub = q.sections.reduce((secSum, sec) => {
      const secSub = sec.items.reduce((sum, item) => sum + (item.qty * (item.price + item.laborRate)), 0);
      return secSum + secSub;
    }, 0);
    const markupVal = sub * (q.markupPercent / 100);
    const taxVal = q.taxPlusApplicable ? 0 : (sub + markupVal) * (q.taxRate / 100);
    return acc + (sub + markupVal + taxVal);
  }, 0);

  const wonCount = wonQuotes.length + completedQuotes.length;
  const lostCount = lostQuotes.length;
  const completedCount = completedQuotes.length;
  
  const totalDecided = wonCount + lostCount;
  const conversionRate = totalDecided > 0 ? Math.round((wonCount / totalDecided) * 100) : 0;

  document.getElementById('stats-pending-value').textContent = formatCurrency(pendingValue);
  document.getElementById('stats-won-count').textContent = `${wonCount} (Completed: ${completedCount})`;
  document.getElementById('stats-lost-count').textContent = String(lostCount);
  document.getElementById('stats-conversion-rate').textContent = `${conversionRate}%`;
}

export async function renderDashboardExpirations() {
  const tbody = document.getElementById('dashboard-expiration-list');
  const warningCountSpan = document.getElementById('dashboard-expiration-count');
  if (!tbody) return;

  const quotes = (await getQuotes()).filter(q => !q.isLegacy && q.status === 'Pending');
  const today = new Date();
  
  const warningQuotes = quotes.filter(q => {
    if (!q.expirationDate) return false;
    const expiry = new Date(q.expirationDate);
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 7;
  });

  warningQuotes.sort((a, b) => new Date(a.expirationDate) - new Date(b.expirationDate));

  warningCountSpan.textContent = `${warningQuotes.length} Warning${warningQuotes.length !== 1 ? 's' : ''}`;
  if (warningQuotes.length > 0) {
    warningCountSpan.className = 'badge badge-lost';
  } else {
    warningCountSpan.className = 'badge badge-pending';
  }

  if (warningQuotes.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">
          No quotes expiring soon. Great job!
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = warningQuotes.map(q => {
    const sub = q.sections.reduce((secSum, sec) => {
      const secSub = sec.items.reduce((sum, item) => sum + (item.qty * (item.price + item.laborRate)), 0);
      return secSum + secSub;
    }, 0);
    const markupVal = sub * (q.markupPercent / 100);
    const taxVal = q.taxPlusApplicable ? 0 : (sub + markupVal) * (q.taxRate / 100);
    const total = sub + markupVal + taxVal;
    
    const isExpired = new Date(q.expirationDate) < today;
    const expiryDisplay = isExpired 
      ? `<span style="color: var(--danger); font-weight: 700;">EXPIRED (${formatDate(q.expirationDate)})</span>`
      : `<span style="color: var(--warning-hover); font-weight: 600;">${formatDate(q.expirationDate)}</span>`;

    return `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(q.jobId)}</td>
        <td>${escapeHtml(q.customerName)}</td>
        <td>${formatDate(q.date)}</td>
        <td>${expiryDisplay}</td>
        <td style="font-weight: 600;">${formatCurrency(total)}</td>
        <td>
          <button type="button" class="btn btn-secondary dash-followup-btn" data-id="${q.id}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
            Follow Up
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

/* ==================== QUOTES LIST SECTION ==================== */
export async function renderQuotesTable() {
  const tbody = document.getElementById('quotes-table-body');
  if (!tbody) return;

  const quotes = (await getQuotes()).filter(q => !q.isLegacy);

  let filtered = quotes.filter(q => 
    (q.customerName || '').toLowerCase().includes(activeSearchQuery.toLowerCase()) ||
    (q.jobId || '').toLowerCase().includes(activeSearchQuery.toLowerCase()) ||
    (q.projectAddress || '').toLowerCase().includes(activeSearchQuery.toLowerCase())
  );

  if (activeStatusFilter === 'pending') {
    filtered = filtered.filter(q => q.status === 'Pending');
  } else if (activeStatusFilter === 'archived') {
    filtered = filtered.filter(q => q.status === 'Won' || q.status === 'Lost' || q.status === 'Completed' || q.status === 'Inactive');
  }

  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

  const profile = getCurrentUserProfile();
  const isViewer = profile && profile.role === 'viewer';

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 3rem;">
          ${activeSearchQuery ? 'No quotes match your search filters.' : 'No quotes found under this filter.'}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(q => {
    const sub = q.sections.reduce((secSum, sec) => {
      const secSub = sec.items.reduce((sum, item) => sum + (item.qty * (item.price + item.laborRate)), 0);
      return secSum + secSub;
    }, 0);
    const markupVal = sub * (q.markupPercent / 100);
    const taxVal = q.taxPlusApplicable ? 0 : (sub + markupVal) * (q.taxRate / 100);
    const total = sub + markupVal + taxVal;

    let statusBadge = '';
    if (q.status === 'Pending') statusBadge = '<span class="badge badge-pending">Pending</span>';
    else if (q.status === 'Won') statusBadge = '<span class="badge badge-won">Won</span>';
    else if (q.status === 'Lost') statusBadge = '<span class="badge badge-lost">Lost</span>';
    else if (q.status === 'Completed') statusBadge = '<span class="badge badge-completed">Completed</span>';
    else if (q.status === 'Inactive') statusBadge = '<span class="badge badge-legacy" style="background-color: rgba(148, 163, 184, 0.15); color: #475569;">Inactive</span>';

    // Viewer restriction actions hide
    const actionButtons = isViewer ? `
      <button type="button" class="btn btn-secondary btn-icon-only view-quote-btn" data-id="${q.id}" title="View Proposal">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="15" height="15">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    ` : `
      <button type="button" class="btn btn-secondary btn-icon-only view-quote-btn" data-id="${q.id}" title="View Proposal">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="15" height="15">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      ${q.status === 'Pending' ? `
        <button type="button" class="btn btn-secondary btn-icon-only edit-quote-btn" data-id="${q.id}" title="Edit Quote">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="15" height="15">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
          </svg>
        </button>
        <button type="button" class="btn btn-success btn-icon-only mark-won-btn" data-id="${q.id}" title="Mark Won">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="15" height="15">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </button>
        <button type="button" class="btn btn-danger btn-icon-only mark-lost-btn" data-id="${q.id}" title="Mark Lost">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="15" height="15">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <button type="button" class="btn btn-secondary btn-icon-only mark-inactive-btn" data-id="${q.id}" title="Mark Inactive" style="color: var(--text-secondary);">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="15" height="15">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </button>
      ` : ''}
      ${q.status === 'Won' ? `
        <button type="button" class="btn btn-secondary btn-icon-only mark-completed-btn" data-id="${q.id}" title="Mark Completed" style="color: var(--info);">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="15" height="15">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0110 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.746 3.746 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0114 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
          </svg>
        </button>
      ` : ''}
    `;

    return `
      <tr>
        <td style="font-weight: 700;">${escapeHtml(q.jobId)}</td>
        <td style="color: var(--text-secondary); font-weight: 500;">#${q.quoteNumber}</td>
        <td style="font-weight: 600;">${escapeHtml(q.customerName)}</td>
        <td style="font-size: 0.85rem; color: var(--text-secondary); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${escapeHtml(q.projectAddress)}
        </td>
        <td>${formatDate(q.date)}</td>
        <td>${formatDate(q.expirationDate)}</td>
        <td style="font-weight: 700; color: var(--primary);">${formatCurrency(total)}</td>
        <td>${statusBadge}</td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 0.4rem; justify-content: flex-end;">
            ${actionButtons}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function hasPriceMismatch(quote) {
  if (quote.isLegacy) return false;
  const catalogProducts = await getProducts();
  
  return quote.sections.some(sec => {
    return sec.items.some(item => {
      if (!item.productId) return false;
      const catProd = catalogProducts.find(p => p.id === item.productId);
      if (!catProd) return false;
      return item.price !== catProd.price || item.laborRate !== catProd.laborRate;
    });
  });
}

// Renders the details page of a quote (PDF proposal format)
export async function renderQuoteDetails(id) {
  selectedQuoteId = id;
  const quote = await getQuoteById(id);
  if (!quote) return;

  const settings = await getSettings();
  const priceWarning = document.getElementById('detail-price-warning');

  // Mismatch warning display
  if (quote.status === 'Pending' && !quote.isLegacy && (await hasPriceMismatch(quote))) {
    priceWarning.style.display = 'flex';
  } else {
    priceWarning.style.display = 'none';
  }

  // Draw action buttons bar
  const actionContainer = document.getElementById('detail-actions-bar');
  const isLegacy = quote.isLegacy === true;
  const isPending = quote.status === 'Pending';
  const isWon = quote.status === 'Won';
  const isCompleted = quote.status === 'Completed';
  const isInactive = quote.status === 'Inactive';

  const profile = getCurrentUserProfile();
  const isViewer = profile && profile.role === 'viewer';

  if (isViewer) {
    actionContainer.innerHTML = `
      <button type="button" class="btn btn-secondary" id="detail-back-btn">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Back to List
      </button>
      <button type="button" class="btn btn-primary" id="detail-print-btn">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6.72 13.82l-.24-2.28H5a3 3 0 01-3-3V5.41a3 3 0 013-3h14a3 3 0 013 3v3.13a3 3 0 01-3 3h-1.48l-.24 2.28M14 13h2a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4a2 2 0 012-2h6z" />
        </svg>
        Print / PDF
      </button>
    `;
  } else {
    actionContainer.innerHTML = `
      <button type="button" class="btn btn-secondary" id="detail-back-btn">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Back to List
      </button>
      <button type="button" class="btn btn-primary" id="detail-print-btn">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6.72 13.82l-.24-2.28H5a3 3 0 01-3-3V5.41a3 3 0 013-3h14a3 3 0 013 3v3.13a3 3 0 01-3 3h-1.48l-.24 2.28M14 13h2a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4a2 2 0 012-2h6z" />
        </svg>
        Print / PDF
      </button>
      <button type="button" class="btn btn-secondary" id="detail-duplicate-btn">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
        </svg>
        Use as Template
      </button>
      
      ${isLegacy ? `
        <div style="background-color: var(--border-color); color: var(--text-secondary); padding: 0.5rem 1rem; border-radius: var(--radius-md); font-size: 0.85rem; font-weight: 700; display: inline-flex; align-items: center; gap: 0.5rem;">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16" style="color: var(--text-muted);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          LEGACY SNAPSHOT
        </div>
        <button type="button" class="btn btn-success" id="detail-reactivate-btn">Reactivate Version</button>
      ` : `
        ${isPending ? `
          <button type="button" class="btn btn-secondary" id="detail-edit-btn">Edit Quote</button>
          <button type="button" class="btn btn-success" id="detail-won-btn">Mark Won</button>
          <button type="button" class="btn btn-danger" id="detail-lost-btn">Mark Lost</button>
          <button type="button" class="btn btn-secondary" id="detail-completed-btn" style="color: var(--text-secondary);">Mark Completed</button>
          <button type="button" class="btn btn-secondary" id="detail-inactive-btn" style="color: var(--text-secondary);">Mark Inactive</button>
        ` : `
          ${isWon ? `
            <div style="background-color: var(--success-light); color: var(--success-hover); padding: 0.5rem 1rem; border-radius: var(--radius-md); font-size: 0.85rem; font-weight: 700; display: inline-flex; align-items: center; margin-right: 0.5rem;">QUOTE WON (ACTIVE PROJECT)</div>
            <button type="button" class="btn btn-secondary" id="detail-pending-btn">Mark Pending</button>
            <button type="button" class="btn btn-danger" id="detail-lost-btn">Mark Lost</button>
            <button type="button" class="btn btn-secondary" id="detail-completed-btn" style="color: var(--text-secondary);">Mark Completed</button>
            <button type="button" class="btn btn-secondary" id="detail-inactive-btn" style="color: var(--text-secondary);">Mark Inactive</button>
          ` : `
            ${isCompleted ? `
              <div style="background-color: var(--info-light); color: var(--info-hover); padding: 0.5rem 1rem; border-radius: var(--radius-md); font-size: 0.85rem; font-weight: 700; display: inline-flex; align-items: center; gap: 0.35rem; margin-right: 0.5rem;">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0110 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.746 3.746 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0114 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" /></svg>
                PROJECT COMPLETED (ARCHIVED)
              </div>
              <button type="button" class="btn btn-secondary" id="detail-pending-btn">Mark Pending</button>
              <button type="button" class="btn btn-success" id="detail-won-btn">Mark Won</button>
              <button type="button" class="btn btn-danger" id="detail-lost-btn">Mark Lost</button>
              <button type="button" class="btn btn-secondary" id="detail-inactive-btn" style="color: var(--text-secondary);">Mark Inactive</button>
            ` : `
              ${isInactive ? `
                <div style="background-color: rgba(226, 232, 240, 0.5); color: #475569; padding: 0.5rem 1rem; border-radius: var(--radius-md); font-size: 0.85rem; font-weight: 700; display: inline-flex; align-items: center; border: 1px solid var(--border-color); margin-right: 0.5rem;">QUOTE INACTIVE (ARCHIVED)</div>
                <button type="button" class="btn btn-secondary" id="detail-pending-btn">Mark Pending</button>
                <button type="button" class="btn btn-success" id="detail-won-btn">Mark Won</button>
                <button type="button" class="btn btn-danger" id="detail-lost-btn">Mark Lost</button>
                <button type="button" class="btn btn-secondary" id="detail-completed-btn" style="color: var(--text-secondary);">Mark Completed</button>
              ` : `
                <div style="background-color: var(--danger-light); color: var(--danger-hover); padding: 0.5rem 1rem; border-radius: var(--radius-md); font-size: 0.85rem; font-weight: 700; display: inline-flex; align-items: center; margin-right: 0.5rem;">QUOTE LOST (ARCHIVED)</div>
                <button type="button" class="btn btn-secondary" id="detail-pending-btn">Mark Pending</button>
                <button type="button" class="btn btn-success" id="detail-won-btn">Mark Won</button>
                <button type="button" class="btn btn-secondary" id="detail-completed-btn" style="color: var(--text-secondary);">Mark Completed</button>
                <button type="button" class="btn btn-secondary" id="detail-inactive-btn" style="color: var(--text-secondary);">Mark Inactive</button>
              `}
            `}
          `}
        `}
      `}
    `;
  }

  // Handle watermark for Trial accounts
  const quotePaper = document.getElementById('quote-paper');
  if (quotePaper) {
    const existingWatermark = quotePaper.querySelector('.watermark-container');
    if (existingWatermark) existingWatermark.remove();

    const subLevel = getSubscriptionLevel();
    if (subLevel === 'trial') {
      const watermark = document.createElement('div');
      watermark.className = 'watermark-container';
      watermark.innerHTML = `
        <div class="watermark-text">Trial Version of MyBidBook.com Please Subscribe to Remove This</div>
        <div class="watermark-text">Trial Version of MyBidBook.com Please Subscribe to Remove This</div>
        <div class="watermark-text">Trial Version of MyBidBook.com Please Subscribe to Remove This</div>
        <div class="watermark-text">Trial Version of MyBidBook.com Please Subscribe to Remove This</div>
      `;
      quotePaper.appendChild(watermark);
    }
  }

  // Draw printable invoice company logo
  const paperLogo = document.getElementById('paper-logo');
  const paperLogoPlaceholder = document.getElementById('paper-logo-placeholder');
  
  if (quote.companyLogo) {
    paperLogo.src = quote.companyLogo;
    paperLogo.style.display = 'block';
    paperLogoPlaceholder.style.display = 'none';
  } else {
    paperLogo.style.display = 'none';
    paperLogoPlaceholder.textContent = settings.companyName ? settings.companyName.toUpperCase() : 'COMPANY LOGO';
    paperLogoPlaceholder.style.display = 'block';
  }

  document.getElementById('paper-co-name').textContent = settings.companyName || 'Construction Quoting Co.';
  document.getElementById('paper-co-address').textContent = settings.companyAddress || '100 Contractor Blvd';
  document.getElementById('paper-co-contact').textContent = `${settings.companyEmail || 'billing@company.com'} | ${settings.companyPhone || ''}`;

  document.getElementById('paper-meta-job-id').innerHTML = `
    <strong>${escapeHtml(quote.jobId)}</strong> 
    ${isLegacy ? `<span style="color: var(--text-muted); font-size:0.75rem;">(V${quote.version} Legacy)</span>` : `<span style="color: var(--primary); font-size:0.75rem;">(V${quote.version} Active)</span>`}
  `;
  document.getElementById('paper-meta-date').textContent = formatDate(quote.date);
  document.getElementById('paper-meta-expiry').textContent = formatDate(quote.expirationDate);

  document.getElementById('paper-client-name').textContent = quote.customerName;
  document.getElementById('paper-client-address').textContent = quote.projectAddress;
  document.getElementById('paper-client-phone').textContent = quote.customerPhone || 'N/A';
  document.getElementById('paper-client-email').textContent = quote.customerEmail || 'N/A';

  const paperTable = document.querySelector('.paper-table');
  if (paperTable) {
    const showDetails = quote.printShowDetails !== false;
    const showDetailPricing = quote.printShowDetailPricing !== false;
    const showQuantities = quote.printShowQuantities !== false;

    let theadHtml = '';
    if (!showDetails || !showQuantities) {
      theadHtml = `
        <tr>
          <th style="text-align: left; width: 75%;">Description & Scope Details</th>
          <th style="text-align: right; width: 25%;">Total Price</th>
        </tr>
      `;
    } else {
      theadHtml = `
        <tr>
          <th style="text-align: left; width: 45%;">Item / Description</th>
          <th style="text-align: center; width: 10%;">Qty</th>
          <th style="text-align: center; width: 10%;">UOM</th>
          <th style="text-align: right; width: 15%;">Unit Price</th>
          <th style="text-align: right; width: 20%;">Total Price</th>
        </tr>
      `;
    }
    paperTable.querySelector('thead').innerHTML = theadHtml;

    const paperTbody = document.getElementById('paper-items-tbody');
    let tbodyHtml = '';

    if (!showDetails) {
      tbodyHtml = quote.sections.map(sec => {
        const secSub = sec.items.reduce((sum, item) => sum + (item.qty * (item.price + item.laborRate)), 0);
        
        if (!showQuantities) {
          return `
            <tr style="font-weight: 500;">
              <td>
                <div style="font-weight: 700; color: #0f172a; font-size: 0.95rem;">${escapeHtml(sec.title)}</div>
                <div style="font-size: 0.75rem; color: #64748b; margin-top: 0.2rem; font-weight: 400; line-height: 1.4;">${escapeHtml(sec.description || '')}</div>
              </td>
              <td style="text-align: right; font-weight: 700; color: #0f172a; vertical-align: middle;">${formatCurrency(secSub)}</td>
            </tr>
          `;
        } else {
          return `
            <tr style="font-weight: 500;">
              <td colspan="4">
                <div style="font-weight: 700; color: #0f172a; font-size: 0.95rem;">${escapeHtml(sec.title)}</div>
                <div style="font-size: 0.75rem; color: #64748b; margin-top: 0.2rem; font-weight: 400; line-height: 1.4;">${escapeHtml(sec.description || '')}</div>
              </td>
              <td style="text-align: right; font-weight: 700; color: #0f172a; vertical-align: middle;">${formatCurrency(secSub)}</td>
            </tr>
          `;
        }
      }).join('');
    } else {
      const rows = [];
      
      quote.sections.forEach(sec => {
        const secSub = sec.items.reduce((sum, item) => sum + (item.qty * (item.price + item.laborRate) * (1 + (quote.markupPercent || 0) / 100)), 0);

        if (!showQuantities) {
          rows.push(`
            <tr style="background-color: #f8fafc; font-weight: 700;">
              <td colspan="2" style="border-bottom: 2px solid #e2e8f0; padding-top: 0.85rem; padding-bottom: 0.4rem;">
                <div style="font-size: 0.95rem; color: #0f172a;">${escapeHtml(sec.title)}</div>
                <div style="font-size: 0.75rem; color: #64748b; font-weight: 400; margin-top: 0.15rem; line-height: 1.4;">${escapeHtml(sec.description || 'No scope details specified.')}</div>
              </td>
            </tr>
          `);
        } else {
          rows.push(`
            <tr style="background-color: #f8fafc; font-weight: 700;">
              <td colspan="5" style="border-bottom: 2px solid #e2e8f0; padding-top: 0.85rem; padding-bottom: 0.4rem;">
                <div style="font-size: 0.95rem; color: #0f172a;">${escapeHtml(sec.title)}</div>
                <div style="font-size: 0.75rem; color: #64748b; font-weight: 400; margin-top: 0.15rem; line-height: 1.4;">${escapeHtml(sec.description || 'No scope details specified.')}</div>
              </td>
            </tr>
          `);
        }

        sec.items.forEach(item => {
          const itemUnitPrice = (item.price + item.laborRate) * (1 + (quote.markupPercent || 0) / 100);
          const itemTotal = item.qty * itemUnitPrice;
          
          let descLines = '';
          if (item.productId && item.description) {
            descLines = `<div class="paper-item-desc">${escapeHtml(item.description)}</div>`;
          } else if (item.isLaborOnly) {
            descLines = `<div class="paper-item-desc" style="font-style: italic;">Custom labor task</div>`;
          }

          if (!showQuantities) {
            const costCol = showDetailPricing 
              ? `<td style="text-align: right; font-weight: 600; color: #334155; vertical-align: middle;">${formatCurrency(itemTotal)}</td>` 
              : `<td style="text-align: right; color: #94a3b8; font-style: italic; vertical-align: middle;">Included</td>`;
            
            rows.push(`
              <tr>
                <td>
                  <div style="font-weight: 600; color: #334155;">${escapeHtml(item.name)}</div>
                  ${descLines}
                </td>
                ${costCol}
              </tr>
            `);
          } else {
            if (showDetailPricing) {
              rows.push(`
                <tr>
                  <td>
                    <div style="font-weight: 600; color: #334155;">${escapeHtml(item.name)}</div>
                    ${descLines}
                  </td>
                  <td style="text-align: center; font-weight: 500;">${item.qty}</td>
                  <td style="text-align: center; font-weight: 500;">${item.uom}</td>
                  <td style="text-align: right; color: #334155; vertical-align: middle;">
                    <div style="font-size: 0.8rem; font-weight: 700; color: #334155;">${formatCurrency(itemUnitPrice)}</div>
                  </td>
                  <td style="text-align: right; font-weight: 600; color: #334155; vertical-align: middle;">${formatCurrency(itemTotal)}</td>
                </tr>
              `);
            } else {
              rows.push(`
                <tr>
                  <td>
                    <div style="font-weight: 600; color: #334155;">${escapeHtml(item.name)}</div>
                    ${descLines}
                  </td>
                  <td style="text-align: center; font-weight: 500;">${item.qty}</td>
                  <td style="text-align: center; font-weight: 500;">${item.uom}</td>
                  <td style="text-align: right; color: #94a3b8; font-style: italic;">Included</td>
                  <td style="text-align: right; color: #94a3b8; font-style: italic;">Included</td>
                </tr>
              `);
            }
          }
        });

        if (!showQuantities) {
          rows.push(`
            <tr style="font-weight: 700; background-color: #fafbfc;">
              <td style="text-align: right; border-top: 1px solid #cbd5e1; font-size: 0.8rem; text-transform: uppercase; color: #475569;">Subtotal: ${escapeHtml(sec.title)}</td>
              <td style="text-align: right; border-top: 1px solid #cbd5e1; color: #0f172a; font-size: 0.9rem;">${formatCurrency(secSub)}</td>
            </tr>
          `);
        } else {
          rows.push(`
            <tr style="font-weight: 700; background-color: #fafbfc;">
              <td colspan="4" style="text-align: right; border-top: 1px solid #cbd5e1; font-size: 0.8rem; text-transform: uppercase; color: #475569;">Subtotal: ${escapeHtml(sec.title)}</td>
              <td style="text-align: right; border-top: 1px solid #cbd5e1; color: #0f172a; font-size: 0.9rem;">${formatCurrency(secSub)}</td>
            </tr>
          `);
        }
      });

      tbodyHtml = rows.join('');
    }

    paperTbody.innerHTML = tbodyHtml;
  }

  const subtotal = quote.sections.reduce((sum, sec) => {
    const secSub = sec.items.reduce((sum, item) => sum + (item.qty * (item.price + item.laborRate) * (1 + (quote.markupPercent || 0) / 100)), 0);
    return sum + secSub;
  }, 0);
  const taxVal = quote.taxPlusApplicable ? 0 : subtotal * (quote.taxRate / 100);
  const total = subtotal + taxVal;

  document.getElementById('paper-subtotal').textContent = formatCurrency(subtotal);
  
  const paperMarkupRow = document.getElementById('paper-markup-row');
  if (paperMarkupRow) {
    paperMarkupRow.style.display = 'none';
  }

  const paperTaxRow = document.getElementById('paper-tax-row');
  const paperTaxLabelWrapper = document.getElementById('paper-tax-label-wrapper');
  const paperTaxAmount = document.getElementById('paper-tax-amount');
  
  if (paperTaxRow && paperTaxLabelWrapper && paperTaxAmount) {
    if (quote.taxPlusApplicable) {
      paperTaxRow.style.display = 'table-row';
      paperTaxLabelWrapper.innerHTML = 'Sales Tax:';
      paperTaxAmount.textContent = 'Plus Any Applicable Taxes';
      paperTaxAmount.style.fontStyle = 'italic';
      paperTaxAmount.style.fontWeight = '500';
    } else if (quote.taxRate > 0) {
      paperTaxRow.style.display = 'table-row';
      paperTaxLabelWrapper.innerHTML = 'Sales Tax (<span id="paper-tax-label">0</span>%):';
      document.getElementById('paper-tax-label').textContent = quote.taxRate;
      paperTaxAmount.textContent = formatCurrency(taxVal);
      paperTaxAmount.style.fontStyle = 'normal';
      paperTaxAmount.style.fontWeight = 'normal';
    } else {
      paperTaxRow.style.display = 'none';
    }
  }

  document.getElementById('paper-total').textContent = formatCurrency(total);
  
  const paperSigCoName = document.getElementById('paper-sig-co-name');
  if (paperSigCoName) {
    paperSigCoName.textContent = settings.companyName || 'Company';
  }

  document.getElementById('paper-notes').textContent = quote.notes || 'No extra terms specified.';

  /* ==================== PRINT PHOTO GALLERY DRAW ==================== */
  // Excluded from print view paper by request. Gallery photos are internal documentation only.

  // Draw Sidebar Project Gallery Manager
  const detailGalleryList = document.getElementById('detail-gallery-list');
  if (detailGalleryList) {
    const photos = quote.photos || [];
    if (photos.length === 0) {
      detailGalleryList.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 0.75rem; border: 1px dashed var(--border-color); border-radius: var(--radius-sm);">
          No project photos attached.
        </div>
      `;
    } else {
      detailGalleryList.innerHTML = photos.map(p => {
        const deleteBtn = isViewer ? '' : `
          <button type="button" class="item-delete-btn detail-photo-delete-btn" data-photo-id="${p.id}" title="Delete Photo" style="padding: 0.2rem; flex-shrink: 0;">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="13" height="13">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        `;
        return `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; background: var(--bg-secondary); padding: 0.35rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
            <div style="display: flex; align-items: center; gap: 0.35rem; overflow: hidden; width: 100%;">
              <img src="${p.url}" style="width: 28px; height: 28px; object-fit: cover; border-radius: 2px; flex-shrink: 0;">
              <div style="font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%;">
                <div style="font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(p.label)}">${escapeHtml(p.label)}</div>
                <div style="font-size: 0.62rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 600;">${p.category}</div>
              </div>
            </div>
            ${deleteBtn}
          </div>
        `;
      }).join('');
    }
  }

  // Viewers can upload files but cannot delete them

  // Reset add photo panel state
  const detailPhotoAddFields = document.getElementById('detail-photo-add-fields');
  if (detailPhotoAddFields) {
    detailPhotoAddFields.style.display = 'none';
  }
  const detailGalleryUpload = document.getElementById('detail-gallery-upload');
  if (detailGalleryUpload) {
    detailGalleryUpload.value = '';
  }
  detailPhotoBase64 = '';

  // Render PDFs and Receipts list inside sidebar widgets
  renderDetailDocuments(quote);
  renderDetailReceipts(quote);

  await renderVersionHistoryList(quote);
}

// Render PDF Contracts list inside Quote preview sidebar
function renderDetailDocuments(quote) {
  const list = document.getElementById('detail-docs-list');
  if (!list) return;

  const docs = quote.documents || [];
  const profile = getCurrentUserProfile();
  const isViewer = profile && profile.role === 'viewer';

  if (docs.length === 0) {
    list.innerHTML = `<span style="font-size: 0.75rem; color: var(--text-muted); padding: 0.25rem 0;">No documents attached.</span>`;
    return;
  }

  list.innerHTML = docs.map(d => {
    const deleteBtn = isViewer ? '' : `
      <button type="button" class="item-delete-btn detail-doc-delete-btn" data-doc-id="${d.id}" title="Remove Document" style="padding: 0.2rem; flex-shrink: 0;">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="13" height="13">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    `;
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; background: var(--bg-secondary); padding: 0.35rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); width: 100%;">
        <a href="${d.url}" target="_blank" style="font-size: 0.72rem; font-weight: 600; color: var(--primary); text-decoration: none; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 80%;">
          📄 ${escapeHtml(d.name)}
        </a>
        ${deleteBtn}
      </div>
    `;
  }).join('');
}

// Render Receipts list inside Quote preview sidebar
function renderDetailReceipts(quote) {
  const list = document.getElementById('detail-receipts-list');
  if (!list) return;

  const receipts = quote.receipts || [];
  const profile = getCurrentUserProfile();
  const isViewer = profile && profile.role === 'viewer';

  if (receipts.length === 0) {
    list.innerHTML = `<span style="font-size: 0.75rem; color: var(--text-muted); padding: 0.25rem 0;">No receipts uploaded.</span>`;
    return;
  }

  list.innerHTML = receipts.map(r => {
    const deleteBtn = isViewer ? '' : `
      <button type="button" class="item-delete-btn detail-receipt-delete-btn" data-receipt-id="${r.id}" title="Remove Receipt" style="padding: 0.2rem; flex-shrink: 0;">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="13" height="13">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    `;
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; background: var(--bg-secondary); padding: 0.35rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); width: 100%;">
        <div style="display: flex; align-items: center; gap: 0.35rem; overflow: hidden; width: 80%;">
          <a href="${r.url}" target="_blank" style="display: flex; align-items: center; gap: 0.35rem; text-decoration: none; width: 100%;">
            <img src="${r.url}" style="width: 28px; height: 28px; object-fit: cover; border-radius: 2px; flex-shrink: 0;">
            <span style="font-size: 0.72rem; font-weight: 600; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
              ${escapeHtml(r.name)}
            </span>
          </a>
        </div>
        ${deleteBtn}
      </div>
    `;
  }).join('');
}

// Draw the history version chains for the selected quote
async function renderVersionHistoryList(activeQuote) {
  const versionListContainer = document.getElementById('detail-version-list');
  if (!versionListContainer) return;

  const quotes = await getQuotes();
  const coreId = activeQuote.parentQuoteId || activeQuote.id;
  const versionChain = quotes.filter(q => q.id === coreId || q.parentQuoteId === coreId);
  
  versionChain.sort((a, b) => b.version - a.version);

  versionListContainer.innerHTML = versionChain.map(q => {
    const isActive = q.id === activeQuote.id;
    const isLegacy = q.isLegacy === true;
    
    let label = `Version ${q.version}`;
    if (isActive) {
      label += ' (Active View)';
    } else if (isLegacy) {
      label += ' (Legacy Archived)';
    } else {
      label += ` (${q.status})`;
    }

    const sub = q.sections.reduce((secSum, sec) => {
      const secSub = sec.items.reduce((sum, item) => sum + (item.qty * (item.price + item.laborRate)), 0);
      return secSum + secSub;
    }, 0);
    const markupVal = sub * (q.markupPercent / 100);
    const taxVal = q.taxPlusApplicable ? 0 : (sub + markupVal) * (q.taxRate / 100);
    const total = sub + markupVal + taxVal;

    return `
      <div class="version-history-item ${isActive ? 'active' : ''}" data-id="${q.id}">
        <div class="version-title">
          <span>${label}</span>
          <span style="font-weight: 700;">${formatCurrency(total)}</span>
        </div>
        <div class="version-date">Created on ${formatDateTime(q.createdDateTime || q.date)}</div>
        <div class="version-date" style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 0.1rem;">
          Exp: ${formatDate(q.expirationDate)} | Status: <span style="font-weight: 600;">${q.status}</span>
        </div>
      </div>
    `;
  }).join('');
}

// Executes price mismatch archiving and updates active quote prices to catalog
async function handleUpdateQuotePrices() {
  if (!selectedQuoteId) return;
  const activeQuote = await getQuoteById(selectedQuoteId);
  if (!activeQuote) return;

  const catalogProducts = await getProducts();

  const updatedSections = activeQuote.sections.map(sec => {
    const updatedItems = sec.items.map(item => {
      if (!item.productId) return item;
      const catProd = catalogProducts.find(p => p.id === item.productId);
      if (!catProd) return item;

      return {
        ...item,
        price: catProd.price,
        laborRate: catProd.laborRate || 0,
        description: catProd.description || ''
      };
    });
    return { ...sec, items: updatedItems };
  });

  activeQuote.sections = updatedSections;

  const res = await saveQuote(activeQuote);
  if (res.success) {
    showToast(`Prices updated to current catalog. New version archived.`);
    await renderQuoteDetails(activeQuote.id);
    await renderDashboardStats();
  } else {
    showToast(res.error, 'danger');
  }
}

// Change status of active quote (Won / Lost / Pending / Completed)
async function handleUpdateQuoteStatus(status) {
  if (!selectedQuoteId) return;
  const quote = await getQuoteById(selectedQuoteId);
  if (!quote) return;

  quote.status = status;
  const res = await saveQuote(quote);
  if (res.success) {
    showToast(`Quote status updated to "${status}".`);
    await renderQuotesTable();
    await renderDashboardStats();
    navigateToView('quotes-view');
  } else {
    showToast(res.error, 'danger');
  }
}

async function promptStatusChange(targetStatus) {
  if (!selectedQuoteId) return;
  const quote = await getQuoteById(selectedQuoteId);
  if (!quote) return;

  const currentStatus = quote.status;
  if (currentStatus === 'Won' || currentStatus === 'Lost' || currentStatus === 'Completed') {
    // Show confirmation modal
    document.getElementById('status-confirm-target-status').value = targetStatus;
    document.getElementById('status-confirm-message').innerHTML = `
      Are you sure you want to change the status of this quote from <strong>${currentStatus}</strong> to <strong>${targetStatus}</strong>?
    `;
    document.getElementById('status-confirm-modal').classList.add('active');
  } else {
    // Immediate update
    await handleUpdateQuoteStatus(targetStatus);
  }
}

// Binds actions for Reactivating a legacy snapshot
async function handleOpenReactivateModal() {
  if (!selectedQuoteId) return;
  const quote = await getQuoteById(selectedQuoteId);
  if (!quote) return;

  document.getElementById('reactivate-modal-quote-id').value = quote.id;
  
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 30);
  document.getElementById('reactivate-expiry-date').value = futureDate.toISOString().split('T')[0];
  
  document.getElementById('reactivate-modal').classList.add('active');
}

async function handleReactivateSubmit() {
  const modal = document.getElementById('reactivate-modal');
  const quoteId = document.getElementById('reactivate-modal-quote-id').value;
  const newExpiry = document.getElementById('reactivate-expiry-date').value;

  if (!newExpiry) {
    showToast('An Expiration Date is required to reactivate.', 'danger');
    return;
  }

  const legacyQuote = await getQuoteById(quoteId);
  if (!legacyQuote) return;

  const allQuotes = await getQuotes();

  const coreId = legacyQuote.parentQuoteId || legacyQuote.id;
  const currentActiveQuote = allQuotes.find(q => !q.isLegacy && (q.id === coreId || q.parentQuoteId === coreId));

  if (currentActiveQuote) {
    currentActiveQuote.isLegacy = true;
    currentActiveQuote.status = 'Legacy';
  }

  const nextVersionNum = Math.max(...allQuotes.filter(q => q.id === coreId || q.parentQuoteId === coreId).map(q => q.version)) + 1;
  
  if (currentActiveQuote) {
    currentActiveQuote.isLegacy = true;
    currentActiveQuote.status = 'Legacy';
  }

  legacyQuote.isLegacy = false;
  legacyQuote.status = 'Pending';
  legacyQuote.expirationDate = newExpiry;
  legacyQuote.date = new Date().toISOString().split('T')[0];
  legacyQuote.version = nextVersionNum;

  await saveQuotesRaw(allQuotes);
  modal.classList.remove('active');
  showToast(`Version ${legacyQuote.version} reactivated! Now active.`);
  await renderQuoteDetails(legacyQuote.id);
  await renderDashboardStats();
}

let isListListenersSetup = false;

// Setup Event listeners for dashboard and quote list view
function setupListListeners() {
  if (isListListenersSetup) return;
  isListListenersSetup = true;
  console.log('setupListListeners -> Starting...');
  const searchInput = document.getElementById('quotes-search-input');
  const tabs = document.getElementById('quotes-status-tabs');
  const tableBody = document.getElementById('quotes-table-body');
  console.log('setupListListeners -> searchInput:', !!searchInput, 'tabs:', !!tabs, 'tableBody:', !!tableBody);
  const expTbody = document.getElementById('dashboard-expiration-list');
  const detailActions = document.getElementById('detail-actions-bar');
  const updatePricesBtn = document.getElementById('detail-update-prices-btn');
  const versionsList = document.getElementById('detail-version-list');
  
  const reactivateCancel = document.getElementById('reactivate-modal-cancel-btn');
  const reactivateClose = document.getElementById('reactivate-modal-close-btn');
  const reactivateSubmit = document.getElementById('reactivate-modal-submit-btn');

  const profile = getCurrentUserProfile();
  const isViewer = profile && profile.role === 'viewer';

  if (searchInput) {
    searchInput.addEventListener('input', async (e) => {
      activeSearchQuery = e.target.value;
      await renderQuotesTable();
    });
  }

  if (tabs) {
    tabs.addEventListener('click', async (e) => {
      const tab = e.target.closest('.filter-tab');
      if (tab) {
        tabs.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        activeStatusFilter = tab.getAttribute('data-status');
        await renderQuotesTable();
      }
    });
  }

  if (tableBody) {
    console.log('setupListListeners -> Binding click event listener to tableBody');
    tableBody.addEventListener('click', async (e) => {
      console.log('tableBody click event detected. Target:', e.target);
      const viewBtn = e.target.closest('.view-quote-btn');
      const editBtn = e.target.closest('.edit-quote-btn');
      console.log('tableBody click -> viewBtn:', viewBtn, 'editBtn:', editBtn);
      const wonBtn = e.target.closest('.mark-won-btn');
      const lostBtn = e.target.closest('.mark-lost-btn');
      const inactiveBtn = e.target.closest('.mark-inactive-btn');
      const compBtn = e.target.closest('.mark-completed-btn');

      if (viewBtn) {
        const id = viewBtn.getAttribute('data-id');
        await renderQuoteDetails(id);
        navigateToView('detail-view');
      }
      if (editBtn && !isViewer) {
        const id = editBtn.getAttribute('data-id');
        editQuote(id);
      }
      if (wonBtn && !isViewer) {
        const id = wonBtn.getAttribute('data-id');
        selectedQuoteId = id;
        await handleUpdateQuoteStatus('Won');
        await renderQuotesTable();
      }
      if (lostBtn && !isViewer) {
        const id = lostBtn.getAttribute('data-id');
        selectedQuoteId = id;
        await handleUpdateQuoteStatus('Lost');
        await renderQuotesTable();
      }
      if (inactiveBtn && !isViewer) {
        const id = inactiveBtn.getAttribute('data-id');
        selectedQuoteId = id;
        await handleUpdateQuoteStatus('Inactive');
        await renderQuotesTable();
      }
      if (compBtn && !isViewer) {
        const id = compBtn.getAttribute('data-id');
        selectedQuoteId = id;
        await handleUpdateQuoteStatus('Completed');
        await renderQuotesTable();
      }
    });
  }

  if (expTbody) {
    expTbody.addEventListener('click', async (e) => {
      const btn = e.target.closest('.dash-followup-btn');
      if (btn) {
        const id = btn.getAttribute('data-id');
        await renderQuoteDetails(id);
        navigateToView('detail-view');
      }
    });
  }

  if (detailActions) {
    detailActions.addEventListener('click', async (e) => {
      const backBtn = e.target.closest('#detail-back-btn');
      const printBtn = e.target.closest('#detail-print-btn');
      const dupBtn = e.target.closest('#detail-duplicate-btn');
      const editBtn = e.target.closest('#detail-edit-btn');
      const pendingBtn = e.target.closest('#detail-pending-btn');
      const wonBtn = e.target.closest('#detail-won-btn');
      const lostBtn = e.target.closest('#detail-lost-btn');
      const inactiveBtn = e.target.closest('#detail-inactive-btn');
      const compBtn = e.target.closest('#detail-completed-btn');
      const reactivateBtn = e.target.closest('#detail-reactivate-btn');

      if (backBtn) navigateToView('quotes-view');
      if (printBtn) window.print();
      if (dupBtn && !isViewer) duplicateQuoteAsTemplate(selectedQuoteId);
      if (editBtn && !isViewer) editQuote(selectedQuoteId);
      if (pendingBtn && !isViewer) await promptStatusChange('Pending');
      if (wonBtn && !isViewer) await promptStatusChange('Won');
      if (lostBtn && !isViewer) await promptStatusChange('Lost');
      if (inactiveBtn && !isViewer) await promptStatusChange('Inactive');
      if (compBtn && !isViewer) await promptStatusChange('Completed');
      if (reactivateBtn && !isViewer) await handleOpenReactivateModal();
    });
  }

  if (updatePricesBtn) {
    updatePricesBtn.addEventListener('click', handleUpdateQuotePrices);
  }

  if (versionsList) {
    versionsList.addEventListener('click', async (e) => {
      const item = e.target.closest('.version-history-item');
      if (item) {
        const id = item.getAttribute('data-id');
        await renderQuoteDetails(id);
      }
    });
  }

  const closeReactivateModal = () => {
    document.getElementById('reactivate-modal').classList.remove('active');
  };
  if (reactivateCancel) reactivateCancel.addEventListener('click', closeReactivateModal);
  if (reactivateClose) reactivateClose.addEventListener('click', closeReactivateModal);
  if (reactivateSubmit) reactivateSubmit.addEventListener('click', handleReactivateSubmit);

  // Status Change Confirmation Modal Listeners
  const statusConfirmCancel = document.getElementById('status-confirm-cancel-btn');
  const statusConfirmClose = document.getElementById('status-confirm-close-btn');
  const statusConfirmSubmit = document.getElementById('status-confirm-submit-btn');

  const closeStatusConfirmModal = () => {
    document.getElementById('status-confirm-modal').classList.remove('active');
  };
  if (statusConfirmCancel) statusConfirmCancel.addEventListener('click', closeStatusConfirmModal);
  if (statusConfirmClose) statusConfirmClose.addEventListener('click', closeStatusConfirmModal);
  if (statusConfirmSubmit) {
    statusConfirmSubmit.addEventListener('click', async () => {
      const targetStatus = document.getElementById('status-confirm-target-status').value;
      closeStatusConfirmModal();
      await handleUpdateQuoteStatus(targetStatus);
    });
  }



  // Project gallery manager event listeners (uploads to storage)
  const detailGalleryUpload = document.getElementById('detail-gallery-upload');
  const detailPhotoAddFields = document.getElementById('detail-photo-add-fields');
  const detailPhotoTempPreview = document.getElementById('detail-photo-temp-preview');
  const detailPhotoLabel = document.getElementById('detail-photo-label');
  const detailPhotoCategory = document.getElementById('detail-photo-category');
  const detailPhotoSave = document.getElementById('detail-photo-save');
  const detailPhotoCancel = document.getElementById('detail-photo-cancel');
  const detailGalleryList = document.getElementById('detail-gallery-list');

  if (detailGalleryUpload) {
    detailGalleryUpload.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const sb = getSupabase();
        if (sb && profile && selectedQuoteId) {
          showToast('Uploading project gallery photo...');
          const filePath = `${profile.company_id}/quotes/${selectedQuoteId}/gallery_${Math.random().toString(36).substr(2, 9)}_${file.name}`;
          const { error } = await uploadFileToStorage('project-photos', filePath, file);
          
          if (error) {
            showToast('Upload failed: ' + error.message, 'danger');
            detailGalleryUpload.value = '';
            return;
          }
          
          const { data: { publicUrl } } = sb.storage.from('project-photos').getPublicUrl(filePath);
          detailPhotoBase64 = publicUrl; // Use base64 variable name but store url

          if (detailPhotoTempPreview && detailPhotoAddFields) {
            detailPhotoTempPreview.src = publicUrl;
            if (detailPhotoLabel) detailPhotoLabel.value = '';
            if (detailPhotoCategory) detailPhotoCategory.value = 'before';
            detailPhotoAddFields.style.display = 'flex';
          }
        }
      }
    });
  }

  if (detailPhotoCancel) {
    detailPhotoCancel.addEventListener('click', () => {
      detailPhotoBase64 = '';
      if (detailPhotoAddFields) detailPhotoAddFields.style.display = 'none';
      if (detailGalleryUpload) detailGalleryUpload.value = '';
      showToast('Attachment discarded.');
    });
  }

  if (detailPhotoSave) {
    detailPhotoSave.addEventListener('click', async () => {
      const label = detailPhotoLabel.value.trim() || 'Project Gallery Photo';
      const category = detailPhotoCategory.value;

      if (!detailPhotoBase64) {
        showToast('No active photo to attach.', 'danger');
        return;
      }

      const quote = await getQuoteById(selectedQuoteId);
      if (quote) {
        if (!quote.photos) quote.photos = [];
        quote.photos.push({
          id: 'img_' + Math.random().toString(36).substr(2, 9),
          url: detailPhotoBase64,
          label,
          category
        });

        const res = await saveQuote(quote);
        if (res.success) {
          showToast('Photo attached. (Purely informational - Version locked)');
          detailPhotoBase64 = '';
          await renderQuoteDetails(quote.id);
        } else {
          showToast(res.error, 'danger');
        }
      }
    });
  }

  if (detailGalleryList) {
    detailGalleryList.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('.detail-photo-delete-btn');
      if (delBtn && !isViewer) {
        const photoId = delBtn.getAttribute('data-photo-id');
        const quote = await getQuoteById(selectedQuoteId);
        if (quote && confirm('Are you sure you want to remove this photo from the project gallery?')) {
          quote.photos = quote.photos.filter(p => p.id !== photoId);
          const res = await saveQuote(quote);
          if (res.success) {
            showToast('Photo removed.');
            await renderQuoteDetails(quote.id);
          } else {
            showToast(res.error, 'danger');
          }
        }
      }
    });
  }

  // Quote contracts upload handler
  const docUpload = document.getElementById('detail-doc-upload');
  const docsListContainer = document.getElementById('detail-docs-list');
  if (docUpload) {
    docUpload.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        if (file.type !== 'application/pdf') {
          showToast('Only PDF files are supported.', 'danger');
          docUpload.value = '';
          return;
        }

        const sb = getSupabase();
        if (sb && profile && selectedQuoteId) {
          showToast('Uploading PDF document...');
          const filePath = `${profile.company_id}/quotes/${selectedQuoteId}/doc_${Math.random().toString(36).substr(2, 9)}_${file.name}`;
          const { error } = await uploadFileToStorage('pdf-contracts', filePath, file);
          
          if (error) {
            showToast('Upload failed: ' + error.message, 'danger');
            docUpload.value = '';
            return;
          }
          
          const { data: { publicUrl } } = sb.storage.from('pdf-contracts').getPublicUrl(filePath);
          const quote = await getQuoteById(selectedQuoteId);
          if (quote) {
            if (!quote.documents) quote.documents = [];
            quote.documents.push({
              id: 'doc_' + Math.random().toString(36).substr(2, 9),
              name: file.name,
              url: publicUrl,
              path: filePath
            });
            const res = await saveQuote(quote);
            if (res.success) {
              showToast('Document attached successfully.');
              renderDetailDocuments(quote);
            }
          }
          docUpload.value = '';
        }
      }
    });
  }

  if (docsListContainer) {
    docsListContainer.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('.detail-doc-delete-btn');
      if (delBtn && !isViewer) {
        const docId = delBtn.getAttribute('data-doc-id');
        const quote = await getQuoteById(selectedQuoteId);
        if (quote && confirm('Are you sure you want to remove this document attachment?')) {
          const doc = quote.documents.find(d => d.id === docId);
          if (doc && doc.path) {
            const sb = getSupabase();
            if (sb) {
              await sb.storage.from('pdf-contracts').remove([doc.path]);
            }
          }
          quote.documents = quote.documents.filter(d => d.id !== docId);
          const res = await saveQuote(quote);
          if (res.success) {
            showToast('Document removed.');
            renderDetailDocuments(quote);
          }
        }
      }
    });
  }

  // Quote receipts upload handler
  const receiptUpload = document.getElementById('detail-receipt-upload');
  const receiptsListContainer = document.getElementById('detail-receipts-list');
  if (receiptUpload) {
    receiptUpload.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const sb = getSupabase();
        if (sb && profile && selectedQuoteId) {
          showToast('Uploading receipt photo...');
          const filePath = `${profile.company_id}/quotes/${selectedQuoteId}/receipt_${Math.random().toString(36).substr(2, 9)}_${file.name}`;
          const { error } = await uploadFileToStorage('job-receipts', filePath, file);
          
          if (error) {
            showToast('Upload failed: ' + error.message, 'danger');
            receiptUpload.value = '';
            return;
          }
          
          const { data: { publicUrl } } = sb.storage.from('job-receipts').getPublicUrl(filePath);
          const quote = await getQuoteById(selectedQuoteId);
          if (quote) {
            if (!quote.receipts) quote.receipts = [];
            quote.receipts.push({
              id: 'rcpt_' + Math.random().toString(36).substr(2, 9),
              name: file.name,
              url: publicUrl,
              path: filePath
            });
            const res = await saveQuote(quote);
            if (res.success) {
              showToast('Receipt attached successfully.');
              renderDetailReceipts(quote);
            }
          }
          receiptUpload.value = '';
        }
      }
    });
  }

  if (receiptsListContainer) {
    receiptsListContainer.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('.detail-receipt-delete-btn');
      if (delBtn && !isViewer) {
        const rcptId = delBtn.getAttribute('data-receipt-id');
        const quote = await getQuoteById(selectedQuoteId);
        if (quote && confirm('Are you sure you want to remove this receipt image?')) {
          const rcpt = quote.receipts.find(r => r.id === rcptId);
          if (rcpt && rcpt.path) {
            const sb = getSupabase();
            if (sb) {
              await sb.storage.from('job-receipts').remove([rcpt.path]);
            }
          }
          quote.receipts = quote.receipts.filter(r => r.id !== rcptId);
          const res = await saveQuote(quote);
          if (res.success) {
            showToast('Receipt removed.');
            renderDetailReceipts(quote);
          }
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
