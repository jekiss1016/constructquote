// Application Entry Point & Router
import { initDB, getSettings, saveSettings, exportDB, importDB, getQuoteById } from './db.js';
import { showToast, fileToBase64 } from './utils.js';
import { initCatalogView, renderCatalogTable, populateCategoryDropdowns } from './catalog.js';
import { initQuotesListView, renderDashboardStats, renderDashboardExpirations, renderQuotesTable, renderQuoteDetails } from './quotes-list.js';
import { initQuoteBuilderView, startNewQuote, loadQuoteForEditing, loadQuoteAsTemplate } from './quote-builder.js';
import { initCustomersView, renderCustomersTable } from './customers.js';

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Database
  initDB();

  // Initialize View Components
  initQuotesListView();
  initCatalogView();
  initQuoteBuilderView();
  initCustomersView();

  // Core App Handlers
  setupAppNavigation();
  setupThemeToggler();
  setupSettingsHandlers();
  setupDatabaseUtilityHandlers();

  // Initial UI draw
  loadDefaultSettingsToUI();
  updateBrandHeader();
});

/* ==================== VIEW ROUTER ==================== */

export function navigateToView(viewId) {
  const sections = document.querySelectorAll('.view-section');
  sections.forEach(s => s.classList.remove('active'));

  const targetSection = document.getElementById(viewId);
  if (targetSection) {
    targetSection.classList.add('active');
  }

  // Update sidebar active highlights
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    if (item.getAttribute('data-target') === viewId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Specific view redraw updates
  if (viewId === 'dashboard-view') {
    renderDashboardStats();
    renderDashboardExpirations();
  } else if (viewId === 'quotes-view') {
    renderQuotesTable();
  } else if (viewId === 'catalog-view') {
    renderCatalogTable();
  } else if (viewId === 'customers-view') {
    renderCustomersTable();
  } else if (viewId === 'settings-view') {
    loadDefaultSettingsToUI();
  }
}

// Router actions triggered from tables or detail pages
export function editQuote(id) {
  const quote = getQuoteById(id);
  if (quote) {
    if (quote.status !== 'Pending' || quote.isLegacy) {
      showToast('Only quotes in "Pending" status can be edited. To make changes, please reactivate this quote as a new version first.', 'danger');
      return;
    }
    loadQuoteForEditing(quote);
    navigateToView('builder-view');
  }
}

export function duplicateQuoteAsTemplate(id) {
  const quote = getQuoteById(id);
  if (quote) {
    loadQuoteAsTemplate(quote);
    navigateToView('builder-view');
  }
}

export function viewQuoteDetails(id) {
  renderQuoteDetails(id);
  navigateToView('detail-view');
}

export function updateBrandHeader() {
  const settings = getSettings();
  const nameEl = document.getElementById('brand-company-name');
  const logoContainer = document.getElementById('brand-logo-container');
  if (nameEl) {
    nameEl.textContent = settings.companyName || 'ConstructQuote';
  }
  if (logoContainer) {
    if (settings.companyLogo) {
      logoContainer.innerHTML = `<img src="${settings.companyLogo}" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit;">`;
      logoContainer.style.background = 'transparent';
    } else {
      logoContainer.innerHTML = 'CQ';
      logoContainer.style.background = '';
    }
  }
}

/* ==================== CORE EVENT BINDERS ==================== */

// Sidebar View Transitions
function setupAppNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.getAttribute('data-target');
      navigateToView(target);
    });
  });

  // Dashboard quick triggers
  const dashNewBtn = document.getElementById('dashboard-new-quote-btn');
  const dashActNew = document.getElementById('dash-action-new-quote');
  const dashActCat = document.getElementById('dash-action-manage-catalog');
  const dashActSet = document.getElementById('dash-action-settings');
  const listNewBtn = document.getElementById('list-new-quote-btn');

  const triggerNewQuote = () => {
    startNewQuote();
    navigateToView('builder-view');
  };

  if (dashNewBtn) dashNewBtn.addEventListener('click', triggerNewQuote);
  if (dashActNew) dashActNew.addEventListener('click', triggerNewQuote);
  if (listNewBtn) listNewBtn.addEventListener('click', triggerNewQuote);

  if (dashActCat) {
    dashActCat.addEventListener('click', () => navigateToView('catalog-view'));
  }
  if (dashActSet) {
    dashActSet.addEventListener('click', () => navigateToView('settings-view'));
  }
}

// Light & Dark theme toggle controller
function setupThemeToggler() {
  const toggleBtn = document.getElementById('theme-toggle-btn');
  const label = document.getElementById('theme-toggle-label');
  const html = document.documentElement;

  // Retrieve saved theme preference from local settings
  const settings = getSettings();
  const initialTheme = settings.theme || 'light';
  html.setAttribute('data-theme', initialTheme);
  updateThemeButtonUI(initialTheme);

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const currentTheme = html.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      
      html.setAttribute('data-theme', newTheme);
      saveSettings({ theme: newTheme });
      updateThemeButtonUI(newTheme);
      showToast(`${newTheme.charAt(0).toUpperCase() + newTheme.slice(1)} theme activated.`);
    });
  }

  function updateThemeButtonUI(theme) {
    if (!toggleBtn || !label) return;
    if (theme === 'dark') {
      label.textContent = 'Light Theme';
      toggleBtn.querySelector('svg').innerHTML = `
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-11.314l.707.707m11.314 11.314l.707.707M12 7a5 5 0 100 10 5 5 0 000-10z" />
      `;
    } else {
      label.textContent = 'Dark Theme';
      toggleBtn.querySelector('svg').innerHTML = `
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
      `;
    }
  }
}

// Load company profile settings to view inputs
function loadDefaultSettingsToUI() {
  const settings = getSettings();
  
  const nameInput = document.getElementById('settings-co-name');
  const addrInput = document.getElementById('settings-co-address');
  const phoneInput = document.getElementById('settings-co-phone');
  const emailInput = document.getElementById('settings-co-email');
  const markupInput = document.getElementById('settings-default-markup');
  const taxInput = document.getElementById('settings-default-tax');
  const logoPreview = document.getElementById('settings-logo-preview');
  const clearBtn = document.getElementById('settings-logo-clear-btn');

  if (nameInput) nameInput.value = settings.companyName || '';
  if (addrInput) addrInput.value = settings.companyAddress || '';
  if (phoneInput) phoneInput.value = settings.companyPhone || '';
  if (emailInput) emailInput.value = settings.companyEmail || '';
  if (markupInput) markupInput.value = settings.defaultMarkupPercent || 0;
  if (taxInput) taxInput.value = settings.defaultTaxRate || 0;

  if (logoPreview) {
    if (settings.companyLogo) {
      logoPreview.innerHTML = `<img src="${settings.companyLogo}" alt="Company Logo">`;
      if (clearBtn) clearBtn.style.display = 'flex';
    } else {
      logoPreview.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      `;
      if (clearBtn) clearBtn.style.display = 'none';
    }
  }
}

// Binds actions to save settings
function setupSettingsHandlers() {
  const saveBtn = document.getElementById('settings-save-btn');
  const logoUpload = document.getElementById('settings-logo-upload');
  const logoClear = document.getElementById('settings-logo-clear-btn');

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const updated = {
        companyName: document.getElementById('settings-co-name').value.trim(),
        companyAddress: document.getElementById('settings-co-address').value.trim(),
        companyPhone: document.getElementById('settings-co-phone').value.trim(),
        companyEmail: document.getElementById('settings-co-email').value.trim(),
        defaultMarkupPercent: parseFloat(document.getElementById('settings-default-markup').value) || 0,
        defaultTaxRate: parseFloat(document.getElementById('settings-default-tax').value) || 0
      };

      saveSettings(updated);
      showToast('Company settings profile saved.');
      renderDashboardStats();
      updateBrandHeader();
    });
  }

  // Handle Setting Logo Upload
  if (logoUpload) {
    logoUpload.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        try {
          const base64 = await fileToBase64(file);
          saveSettings({ companyLogo: base64 });
          
          const logoPreview = document.getElementById('settings-logo-preview');
          logoPreview.innerHTML = `<img src="${base64}" alt="Company Logo">`;
          if (logoClear) logoClear.style.display = 'flex';
          
          showToast('Default company logo saved.');
          updateBrandHeader();
        } catch (err) {
          showToast('Failed to convert image.', 'danger');
        }
      }
    });
  }

  // Handle Setting Logo Clear
  if (logoClear) {
    logoClear.addEventListener('click', () => {
      saveSettings({ companyLogo: '' });
      const logoPreview = document.getElementById('settings-logo-preview');
      logoPreview.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      `;
      logoClear.style.display = 'none';
      logoUpload.value = '';
      showToast('Default logo cleared.');
      updateBrandHeader();
    });
  }
}

// Binds export and import buttons
function setupDatabaseUtilityHandlers() {
  const backupBtn = document.getElementById('db-backup-btn');
  const restoreUpload = document.getElementById('db-restore-upload');

  // Export DB
  if (backupBtn) {
    backupBtn.addEventListener('click', () => {
      const dataStr = exportDB();
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `constructquote-db-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showToast('Database exported successfully.');
    });
  }

  // Import DB
  if (restoreUpload) {
    restoreUpload.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const reader = new FileReader();
        
        reader.onload = (event) => {
          const res = importDB(event.target.result);
          if (res.success) {
            showToast('Database restored successfully! Reloading...');
            setTimeout(() => {
              window.location.reload();
            }, 1500);
          } else {
            showToast(res.error, 'danger');
          }
        };

        reader.readAsText(file);
      }
    });
  }
}
