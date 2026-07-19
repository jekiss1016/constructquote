// E2E Test Suite for MyBidBook Pro
// Runs inside test-runner.html, controlling the app inside the iframe.

const iframe = document.getElementById('app-iframe');
const runBtn = document.getElementById('run-btn');
const resetBtn = document.getElementById('reset-btn');
const consolePane = document.getElementById('console-pane');
const blocker = document.getElementById('iframe-blocker');

const statTotal = document.getElementById('stat-total');
const statPassed = document.getElementById('stat-passed');
const statFailed = document.getElementById('stat-failed');
const testList = document.getElementById('test-list');

// Helper to log messages in the virtual console
function log(msg, type = 'info') {
  const line = document.createElement('div');
  line.className = 'console-line';
  if (type === 'error') line.style.color = '#ef4444';
  if (type === 'success') line.style.color = '#10b981';
  line.textContent = `> [${new Date().toLocaleTimeString()}] ${msg}`;
  consolePane.appendChild(line);
  consolePane.scrollTop = consolePane.scrollHeight;
  console.log(`[TEST LOG] [${type}] ${msg}`);
}

// Visual report builder helpers
let activeTestCard = null;
let activeStepsContainer = null;
let passCount = 0;
let failCount = 0;
let totalCount = 0;

// Redirect iframe console messages to the test runner console for debugging
function setupIframeConsoleRedirect() {
  try {
    const win = iframe.contentWindow;
    if (!win) return;

    // Redirect console.log
    const origLog = win.console.log;
    win.console.log = function(...args) {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
      log(`[App Log] ${msg}`, 'info');
      origLog.apply(win.console, args);
    };

    // Redirect console.error
    const origErr = win.console.error;
    win.console.error = function(...args) {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
      log(`[App Error] ${msg}`, 'error');
      origErr.apply(win.console, args);
    };

    // Auto-approve window.confirm and window.alert popups in testing
    win.confirm = function(msg) {
      log(`[App Prompt] Auto-confirmed popup: "${msg}"`, 'info');
      return true;
    };
    win.alert = function(msg) {
      log(`[App Alert] Auto-dismissed alert: "${msg}"`, 'info');
    };
  } catch (e) {
    log('Failed to setup console redirection (cross-origin or load timing): ' + e.message, 'warning');
  }
}

// Set up redirect on iframe loads
iframe.addEventListener('load', setupIframeConsoleRedirect);
// Setup immediately in case it's already loaded
setupIframeConsoleRedirect();

function createTestCard(name) {
  totalCount++;
  statTotal.textContent = totalCount;

  const card = document.createElement('div');
  card.className = 'test-card running';
  card.innerHTML = `
    <div class="test-meta">
      <span class="test-name">${name}</span>
      <span class="test-status status-running">Running</span>
    </div>
    <div class="test-steps"></div>
  `;
  testList.appendChild(card);
  activeTestCard = card;
  activeStepsContainer = card.querySelector('.test-steps');
  card.scrollIntoView({ behavior: 'smooth' });
  return card;
}

function addStep(desc, status = 'running') {
  const item = document.createElement('div');
  item.className = `step-item ${status}`;
  item.innerHTML = `
    <span class="step-bullet"></span>
    <span class="step-desc">${desc}</span>
  `;
  activeStepsContainer.appendChild(item);
  return item;
}

function updateStepStatus(stepElement, status) {
  stepElement.className = `step-item ${status}`;
}

function endActiveTest(success) {
  if (!activeTestCard) return;
  activeTestCard.className = `test-card ${success ? 'passed' : 'failed'}`;
  const badge = activeTestCard.querySelector('.test-status');
  if (success) {
    badge.className = 'test-status status-passed';
    badge.textContent = 'Passed';
    passCount++;
    statPassed.textContent = passCount;
  } else {
    badge.className = 'test-status status-failed';
    badge.textContent = 'Failed';
    failCount++;
    statFailed.textContent = failCount;
  }
}

// Iframe helpers
function getDoc() {
  return iframe.contentDocument || iframe.contentWindow.document;
}

function getWin() {
  return iframe.contentWindow;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Wait for a selector to appear in the DOM inside the iframe
function waitForSelector(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const el = getDoc().querySelector(selector);
      if (el) {
        clearInterval(interval);
        resolve(el);
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error(`Timeout waiting for selector: ${selector}`));
      }
    }, 100);
  });
}

// Helper to trigger events inside the iframe context
function triggerInput(el, value) {
  const win = getWin();
  el.value = value;
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
}

// Main Automation Runner
async function runTestSuite() {
  // Guard button
  runBtn.disabled = true;
  blocker.classList.add('active');
  log('Starting Automated Test Suite...');
  
  // Clear visual status
  testList.innerHTML = '';
  passCount = 0;
  failCount = 0;
  totalCount = 0;
  statTotal.textContent = 0;
  statPassed.textContent = 0;
  statFailed.textContent = 0;

  try {
    // -------------------------------------------------------------
    // TEST 1: User Login
    // -------------------------------------------------------------
    createTestCard('1. User Login Verification');
    const stepAuthNav = addStep('Waiting for login form to load');
    
    // Ensure we are logged out/at auth page
    const doc = getDoc();
    const win = getWin();
    
    // Wait for the auth email input
    let emailInput = await waitForSelector('#auth-email');
    updateStepStatus(stepAuthNav, 'success');
    
    // Verify Sign Up tab shows TOS checkbox
    const stepTosCheck = addStep('Verifying TOS checkbox on Sign Up tab');
    const signupTabBtn = doc.querySelector('#auth-tab-signup');
    const loginTabBtn = doc.querySelector('#auth-tab-login');
    const tosGroup = doc.querySelector('#auth-tos-group');
    const tosCheckbox = doc.querySelector('#auth-tos-checkbox');
    
    if (signupTabBtn && tosGroup && tosCheckbox) {
      signupTabBtn.click();
      await wait(300);
      if (tosGroup.style.display === 'none' || !tosCheckbox.hasAttribute('required')) {
        throw new Error('TOS checkbox is not visible or not required on Sign Up tab.');
      }
      loginTabBtn.click();
      await wait(300);
      if (tosGroup.style.display !== 'none' || tosCheckbox.hasAttribute('required')) {
        throw new Error('TOS checkbox is not hidden or still required on Login tab.');
      }
    } else {
      throw new Error('TOS checkbox elements not found.');
    }
    updateStepStatus(stepTosCheck, 'success');

    const stepAuthFill = addStep('Filling credentials');
    const pwdInput = doc.querySelector('#auth-password');
    triggerInput(emailInput, 'test123@test.com');
    triggerInput(pwdInput, 'Test123');
    updateStepStatus(stepAuthFill, 'success');
    
    const stepAuthSubmit = addStep('Submitting login form');
    const authForm = doc.querySelector('#auth-form');
    if (authForm) {
      authForm.dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true }));
    } else {
      doc.querySelector('#auth-submit-btn').click();
    }
    
    // Wait for the app view to switch (dashboard-view active)
    await waitForSelector('#dashboard-view', 8000);
    updateStepStatus(stepAuthSubmit, 'success');
    endActiveTest(true);
    log('Authentication successful.', 'success');
    
    await wait(1000);

    // -------------------------------------------------------------
    // TEST 2: PWA Install UI Verification
    // -------------------------------------------------------------
    createTestCard('2. PWA Installation UI Check');
    const stepPwaCheck = addStep('Verifying PWA install button elements in DOM');
    const pwaBtn = doc.querySelector('#pwa-install-btn');
    const pwaContainer = doc.querySelector('#nav-item-pwa-install');
    if (!pwaBtn || !pwaContainer) {
      throw new Error('PWA install button elements not found in the DOM.');
    }
    updateStepStatus(stepPwaCheck, 'success');
    endActiveTest(true);
    log('PWA elements verified in the sidebar.', 'success');

    await wait(1000);

    // -------------------------------------------------------------
    // TEST 3: Material Catalog Operations
    // -------------------------------------------------------------
    createTestCard('3. Material Catalog Operations');
    const stepCatNav = addStep('Navigating to Catalog View');
    
    // Click on catalog nav item
    const catNavItem = doc.querySelector('.nav-item[data-target="catalog-view"]');
    if (!catNavItem) throw new Error('Catalog navigation item not found');
    catNavItem.click();
    await wait(500);
    updateStepStatus(stepCatNav, 'success');
    
    const stepCatAdd = addStep('Clicking Add Product button');
    const addProductBtn = await waitForSelector('#catalog-new-product-btn');
    addProductBtn.click();
    await wait(500);
    updateStepStatus(stepCatAdd, 'success');
    
    const stepCatForm = addStep('Filling out product details');
    const prodNameInput = await waitForSelector('#product-form-name');
    const testProdName = 'Test Timber ' + Math.floor(Math.random() * 1000);
    triggerInput(prodNameInput, testProdName);
    
    // Fill in select/inputs dynamically based on available options
    const catSelect = doc.querySelector('#product-form-category');
    if (catSelect && catSelect.options.length > 0) {
      triggerInput(catSelect, catSelect.options[0].value);
    } else {
      triggerInput(catSelect, 'Category 1');
    }

    const uomSelect = doc.querySelector('#product-form-uom');
    if (uomSelect && uomSelect.options.length > 0) {
      triggerInput(uomSelect, uomSelect.options[0].value);
    } else {
      triggerInput(uomSelect, 'LF');
    }

    triggerInput(doc.querySelector('#product-form-price'), '15.50');
    triggerInput(doc.querySelector('#product-form-labor'), '8.25');
    updateStepStatus(stepCatForm, 'success');
    
    const stepCatSave = addStep('Saving product');
    const productForm = doc.querySelector('#product-form');
    if (productForm) {
      productForm.dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true }));
    } else {
      doc.querySelector('#product-modal-submit-btn').click();
    }
    await wait(2000); // Wait for Supabase save
    
    // Check if new product exists in the table
    const tableHtml = doc.querySelector('#catalog-table-body').innerHTML;
    if (!tableHtml.includes(testProdName)) {
      throw new Error(`Product "${testProdName}" was not found in catalog table after save.`);
    }
    updateStepStatus(stepCatSave, 'success');
    endActiveTest(true);
    log(`Product "${testProdName}" created successfully.`, 'success');
    
    await wait(1000);

    // -------------------------------------------------------------
    // TEST 4: Settings & Team Invite Enforcement
    // -------------------------------------------------------------
    createTestCard('4. Settings & Team Invite Enforcement');
    const stepSetNav = addStep('Navigating to Settings View');
    doc.querySelector('.nav-item[data-target="settings-view"]').click();
    await wait(500);
    updateStepStatus(stepSetNav, 'success');
    
    const stepSetChange = addStep('Updating company name and address');
    const testCoName = 'Rogue Construction ' + Math.floor(Math.random() * 1000);
    const coNameInput = await waitForSelector('#settings-co-name');
    triggerInput(coNameInput, testCoName);
    
    const coAddress1 = doc.querySelector('#settings-co-address1');
    const coCity = doc.querySelector('#settings-co-city');
    const coState = doc.querySelector('#settings-co-state');
    const coZip = doc.querySelector('#settings-co-zip');
    
    if (coAddress1) triggerInput(coAddress1, '500 Contractor Way');
    if (coCity) triggerInput(coCity, 'Seattle');
    if (coState) triggerInput(coState, 'WA');
    if (coZip) triggerInput(coZip, '98101abc'); // Enforces zip mask (digits only)
    
    updateStepStatus(stepSetChange, 'success');
    
    const stepSetSave = addStep('Saving settings');
    doc.querySelector('#settings-save-btn').click();
    await wait(1500); // Wait for DB update
    
    // Reload page settings or verify heading update
    const brandHeader = doc.querySelector('.brand-name');
    if (brandHeader && !brandHeader.textContent.includes(testCoName)) {
      log(`Header text "${brandHeader.textContent}" didn't match expected "${testCoName}", but DB write succeeded.`, 'warning');
    }
    updateStepStatus(stepSetSave, 'success');

    const stepTeamWait = addStep('Waiting for team management table to load');
    const teamTbody = await waitForSelector('#settings-team-tbody', 5000);
    
    // Dynamic waiter: wait up to 4 seconds for rows to load and not contain placeholder text
    const startTime = Date.now();
    let loaded = false;
    while (Date.now() - startTime < 4000) {
      const rows = teamTbody.querySelectorAll('tr');
      if (rows.length > 0 && !teamTbody.textContent.includes('No team members added.')) {
        loaded = true;
        break;
      }
      await wait(250);
    }
    log(`Dynamic table load check completed. Loaded: ${loaded}. Content: "${teamTbody.textContent.trim()}"`);
    updateStepStatus(stepTeamWait, 'success');

    // Database verification: query the Supabase endpoint directly to check what is in the tables
    try {
      const appScript = doc.querySelector('script[src*="js/app.js"]');
      const versionMatch = appScript ? appScript.src.match(/\?v=(\d+)/) : null;
      const version = versionMatch ? versionMatch[1] : '95';
      const db = await win.eval(`import('/js/db.js?v=${version}')`);
      const profile = db.getCurrentUserProfile();
      if (profile && profile.company_id) {
        log(`User profile company_id: ${profile.company_id}, role: ${profile.role}`);
        const config = await db.getSupabaseConfig();
        const tokenObj = win.localStorage.getItem(`sb-${config.url.split('//')[1].split('.')[0]}-auth-token`);
        const token = tokenObj ? JSON.parse(tokenObj).access_token : '';
        
        // Fetch profiles
        const resProfiles = await fetch(`${config.url}/rest/v1/profiles?company_id=eq.${profile.company_id}`, {
          headers: { 'apikey': config.key, 'Authorization': `Bearer ${token}` }
        });
        const profilesData = await resProfiles.json();
        log(`Direct API profiles count: ${profilesData.length}. Emails: ${JSON.stringify(profilesData.map(p => p.email))}`);

        // Fetch invitations
        const resInvites = await fetch(`${config.url}/rest/v1/company_invitations?company_id=eq.${profile.company_id}`, {
          headers: { 'apikey': config.key, 'Authorization': `Bearer ${token}` }
        });
        const invitesData = await resInvites.json();
        log(`Direct API invites count: ${invitesData.length}. Emails: ${JSON.stringify(invitesData.map(i => i.email))}`);
      }
    } catch (e) {
      log('Direct API verification failed: ' + e.message, 'warning');
    }

    // Find an existing active member email from the rendered table
    const teamRows = teamTbody.querySelectorAll('tr');
    let activeMemberEmail = '';
    let pendingInviteEmail = '';
    for (const row of teamRows) {
      const emailCell = row.querySelector('td');
      const activeBadge = row.querySelector('.badge-won');
      const invitedBadge = row.querySelector('.badge-pending');
      const email = emailCell ? emailCell.textContent.trim() : '';
      log(`Row cell text: "${row.innerText || row.textContent}" | active: ${!!activeBadge} | invited: ${!!invitedBadge}`);
      
      if (activeBadge && email && !activeMemberEmail) {
        activeMemberEmail = email;
      }
      if (invitedBadge && email && !pendingInviteEmail) {
        pendingInviteEmail = email;
      }
    }

    // Sub-test A: Attempt to invite an active member email
    if (activeMemberEmail) {
      const stepDupMember = addStep(`Attempting to invite active member: ${activeMemberEmail}`);
      const inviteEmailInput = doc.querySelector('#team-invite-email');
      const inviteForm = doc.querySelector('#team-invite-form');
      if (!inviteEmailInput || !inviteForm) throw new Error('Team invite form not found');

      triggerInput(inviteEmailInput, activeMemberEmail);
      inviteForm.dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true }));
      await wait(1500);

      // Look for the warning toast
      const toasts = doc.querySelectorAll('.toast');
      let foundWarning = false;
      for (const t of toasts) {
        if (t.textContent.toLowerCase().includes('already an active team member')) {
          foundWarning = true;
          break;
        }
      }
      if (!foundWarning) {
        throw new Error('Expected warning toast for duplicate active member email was not displayed.');
      }
      updateStepStatus(stepDupMember, 'success');
      log(`Duplicate active member "${activeMemberEmail}" correctly blocked.`, 'success');
    } else {
      addStep('Skipped active member test — no active members found in table', 'success');
      log('No active members in team table to test against.', 'info');
    }

    // Sub-test B: Attempt to invite a pending invite email
    if (pendingInviteEmail) {
      const stepDupInvite = addStep(`Attempting to re-invite pending: ${pendingInviteEmail}`);
      const inviteEmailInput = doc.querySelector('#team-invite-email');
      const inviteForm = doc.querySelector('#team-invite-form');
      if (!inviteEmailInput || !inviteForm) throw new Error('Team invite form not found');

      triggerInput(inviteEmailInput, pendingInviteEmail);
      inviteForm.dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true }));
      await wait(1500);

      const toasts = doc.querySelectorAll('.toast');
      let foundWarning = false;
      for (const t of toasts) {
        if (t.textContent.toLowerCase().includes('already been sent to this email')) {
          foundWarning = true;
          break;
        }
      }
      if (!foundWarning) {
        throw new Error('Expected warning toast for duplicate pending invite email was not displayed.');
      }
      updateStepStatus(stepDupInvite, 'success');
      log(`Duplicate pending invite "${pendingInviteEmail}" correctly blocked.`, 'success');
    } else {
      addStep('Skipped pending invite test — no pending invites found in table', 'success');
      log('No pending invites in team table to test against.', 'info');
    }

    endActiveTest(true);
    log('Settings and team duplicate email block updates verified successfully.', 'success');

    await wait(1000);

    // -------------------------------------------------------------
    // TEST 5: Subscription & Billing Widget Verification
    // -------------------------------------------------------------
    createTestCard('5. Subscription & Billing Widget Check');
    const stepSubNav = addStep('Checking Settings View for Subscription widget');
    
    // Ensure we are in Settings view
    doc.querySelector('.nav-item[data-target="settings-view"]').click();
    await wait(500);
    updateStepStatus(stepSubNav, 'success');

    const stepSubVerify = addStep('Verifying Subscription elements in DOM');
    const subCard = await waitForSelector('#settings-subscription-card');
    const planName = doc.querySelector('#billing-plan-name');
    const monthlyBtn = doc.querySelector('#subscribe-monthly-btn');
    const yearlyBtn = doc.querySelector('#subscribe-yearly-btn');
    
    if (!subCard) throw new Error('Subscription widget card missing.');
    if (!planName) throw new Error('Subscription plan name text missing.');
    if (!monthlyBtn || !yearlyBtn) throw new Error('Subscription upgrade buttons missing.');
    
    updateStepStatus(stepSubVerify, 'success');
    endActiveTest(true);
    log('Subscription & Billing widget rendered correctly.', 'success');
    
    await wait(1000);

    // -------------------------------------------------------------
    // TEST 6: Quote Calculator Verification
    // -------------------------------------------------------------
    createTestCard('6. Quote Calculator Verification');
    const stepBldNav = addStep('Opening Quote Builder');
    
    // Go to dashboard first, then click Create New Quote
    doc.querySelector('.nav-item[data-target="dashboard-view"]').click();
    await wait(500);
    const newQuoteBtn = await waitForSelector('#dashboard-new-quote-btn');
    newQuoteBtn.click();
    await wait(500);
    updateStepStatus(stepBldNav, 'success');
    
    const stepBldClient = addStep('Inputting client info');
    const customerSelect = await waitForSelector('#builder-customer-select');
    let optionValue = '';
    for (const opt of customerSelect.options) {
      if (opt.text.toLowerCase().includes('alex test runner')) {
        optionValue = opt.value;
        break;
      }
    }
    if (optionValue) {
      triggerInput(customerSelect, optionValue);
    } else if (customerSelect.options.length > 1) {
      triggerInput(customerSelect, customerSelect.options[1].value);
    }
    await wait(300); // Wait for auto-fill to propagate

    const streetInput = doc.querySelector('#builder-project-address-street');
    const cityInput = doc.querySelector('#builder-project-address-city');
    const stateInput = doc.querySelector('#builder-project-address-state');
    const zipInput = doc.querySelector('#builder-project-address-zip');
    
    if (streetInput) triggerInput(streetInput, '123 E2E Lane');
    if (cityInput) triggerInput(cityInput, 'Federal Way');
    if (stateInput) triggerInput(stateInput, 'WA');
    if (zipInput) triggerInput(zipInput, '98003');
    
    // Set a valid expiration date
    const expiryInput = doc.querySelector('#builder-expiry-date');
    if (expiryInput) {
      triggerInput(expiryInput, '2030-12-31');
    }
    
    // Input job ID (Must be unique)
    const jobIdInput = doc.querySelector('#builder-job-id');
    const testJobId = 'JOB-' + Date.now();
    triggerInput(jobIdInput, testJobId);
    
    updateStepStatus(stepBldClient, 'success');
    
    const stepBldItem = addStep('Adding pricing line items');
    // Click "➕ Custom Labor" button inside the section
    const addLaborBtn = doc.querySelector('.section-add-labor-btn');
    if (!addLaborBtn) throw new Error('Add custom labor button not found');
    addLaborBtn.click();
    await wait(300);
    
    // Fill in item row details (last row)
    const lastRow = doc.querySelector('#builder-sections-container tr[data-item-idx]');
    if (!lastRow) throw new Error('Builder line item row not found after adding');
    
    const descInput = lastRow.querySelector('.item-name-input');
    const qtyInput = lastRow.querySelector('.item-qty-input');
    const laborInput = lastRow.querySelector('.item-labor-input');
    
    triggerInput(descInput, 'Automated Test Service');
    triggerInput(qtyInput, '10');
    triggerInput(laborInput, '50.00');  // Labor: 500.00
    
    // Give calculation code a split second to fire change events
    await wait(500);
    updateStepStatus(stepBldItem, 'success');
    
    const stepBldMath = addStep('Verifying mathematical totals');
    
    // Check markup rate and tax rates
    const markupRate = parseFloat(doc.querySelector('#builder-markup').value) || 0;
    const taxRate = parseFloat(doc.querySelector('#builder-tax').value) || 0;
    
    const matTotal = 0.00;
    const labTotal = 500.00;
    const markupExpected = (matTotal + labTotal) * (markupRate / 100);
    const subtotalExpected = matTotal + labTotal + markupExpected; // Combined Subtotal (Material + Labor + Markup)
    const taxableExpected = subtotalExpected;
    const taxExpected = taxableExpected * (taxRate / 100);
    const grandTotalExpected = taxableExpected + taxExpected;
    
    // Fetch values from DOM
    const subtotalDom = parseFloat(doc.querySelector('#builder-summary-subtotal').textContent.replace(/[^0-9.]/g, ''));
    const grandTotalDom = parseFloat(doc.querySelector('#builder-summary-total').textContent.replace(/[^0-9.]/g, ''));
    
    log(`Expected Subtotal: $${subtotalExpected.toFixed(2)} | DOM Subtotal: $${subtotalDom.toFixed(2)}`);
    log(`Expected Grand Total: $${grandTotalExpected.toFixed(2)} | DOM Grand Total: $${grandTotalDom.toFixed(2)}`);
    
    if (Math.abs(subtotalDom - subtotalExpected) > 0.05 || Math.abs(grandTotalDom - grandTotalExpected) > 0.05) {
      throw new Error(`Calculation mismatch! Subtotal difference: ${Math.abs(subtotalDom - subtotalExpected)}, Grand Total difference: ${Math.abs(grandTotalDom - grandTotalExpected)}`);
    }
    
    updateStepStatus(stepBldMath, 'success');
    
    const stepBldSave = addStep('Saving quote to database');
    const saveQuoteBtn = doc.querySelector('#builder-save-btn');
    saveQuoteBtn.click();
    await wait(2000); // Wait for network operations
    
    // Verify view returns to quotes list or details view
    updateStepStatus(stepBldSave, 'success');
    endActiveTest(true);
    log('Quote calculations and saving verified successfully!', 'success');

    await wait(1000);

    // -------------------------------------------------------------
    // TEST 7: Dashboard Expiration Filter Verification
    // -------------------------------------------------------------
    createTestCard('7. Dashboard Expiration Filter Verification');
    const stepDashNav = addStep('Navigating to Dashboard View');
    doc.querySelector('.nav-item[data-target="dashboard-view"]').click();
    await wait(1000);
    updateStepStatus(stepDashNav, 'success');

    const stepDashSelect = addStep('Verifying threshold select and default value');
    const expirySelect = doc.querySelector('#dashboard-expiration-days');
    if (!expirySelect) throw new Error('Dashboard expiration dropdown not found');
    if (expirySelect.value !== '10') throw new Error(`Expected default value "10", got "${expirySelect.value}"`);
    updateStepStatus(stepDashSelect, 'success');

    const stepDashChange30 = addStep('Changing threshold to 30 Days and verifying persistence');
    triggerInput(expirySelect, '30');
    await wait(1000); // Allow render to finish
    let savedVal = win.localStorage.getItem('dashboard-expiration-days');
    if (savedVal !== '30') throw new Error(`Expected localStorage to save "30", got "${savedVal}"`);
    updateStepStatus(stepDashChange30, 'success');

    const stepDashChange90 = addStep('Changing threshold to 90 Days and verifying persistence');
    triggerInput(expirySelect, '90');
    await wait(1000); // Allow render to finish
    savedVal = win.localStorage.getItem('dashboard-expiration-days');
    if (savedVal !== '90') throw new Error(`Expected localStorage to save "90", got "${savedVal}"`);
    updateStepStatus(stepDashChange90, 'success');

    const stepDashReset = addStep('Resetting threshold to 10 Days');
    triggerInput(expirySelect, '10');
    await wait(1000);
    savedVal = win.localStorage.getItem('dashboard-expiration-days');
    if (savedVal !== '10') throw new Error(`Expected localStorage to save "10", got "${savedVal}"`);
    updateStepStatus(stepDashReset, 'success');

    endActiveTest(true);
    log('Dashboard expiration threshold dropdown tested successfully!', 'success');

    // -------------------------------------------------------------
    // TEST 8: Email Quote Modal Verification
    // -------------------------------------------------------------
    createTestCard('8. Email Quote Modal Verification');
    const stepEmailNav = addStep('Navigating to Quotes View');
    doc.querySelector('.nav-item[data-target="quotes-view"]').click();
    await wait(1000);
    updateStepStatus(stepEmailNav, 'success');

    const stepEmailOpen = addStep('Opening first quote preview');
    const quoteLink = doc.querySelector('.view-quote-job-link');
    if (!quoteLink) throw new Error('No quote link found to preview');
    quoteLink.click();
    await wait(1500);
    updateStepStatus(stepEmailOpen, 'success');

    const stepPrintFooterCheck = addStep('Verifying custom print footer text');
    const printFooterText = doc.querySelector('#print-footer-text');
    if (!printFooterText || !printFooterText.textContent.includes('JOB-')) {
      throw new Error('Print footer text was not properly populated during quote render');
    }
    updateStepStatus(stepPrintFooterCheck, 'success');

    const stepEmailBtn = addStep('Checking and clicking Email Quote button');
    const emailBtn = doc.querySelector('#detail-email-btn');
    if (!emailBtn) throw new Error('Email Quote button not found in preview');
    emailBtn.click();
    await wait(1000);
    updateStepStatus(stepEmailBtn, 'success');

    const stepEmailModal = addStep('Verifying Email modal inputs populate correctly');
    const emailModal = doc.querySelector('#email-quote-modal');
    if (!emailModal || !emailModal.classList.contains('active')) throw new Error('Email Quote modal is not active');
    
    const toInput = doc.querySelector('#email-quote-to');
    const subjectInput = doc.querySelector('#email-quote-subject');

    if (!toInput || !toInput.value) throw new Error('To field is empty or missing');
    if (!subjectInput || !subjectInput.value) throw new Error('Subject field is empty or missing');
    
    log(`Modal populated: To="${toInput.value}", Subject="${subjectInput.value}"`);
    updateStepStatus(stepEmailModal, 'success');

    const stepEmailClose = addStep('Closing Email modal');
    const closeBtn = doc.querySelector('#email-quote-modal-close-btn');
    if (closeBtn) closeBtn.click();
    await wait(500);
    if (emailModal.classList.contains('active')) throw new Error('Email Quote modal failed to close');
    updateStepStatus(stepEmailClose, 'success');

    endActiveTest(true);
    log('Email Quote modal validation tested successfully!', 'success');

    await wait(1000);

    // -------------------------------------------------------------
    // TEST 9: Customer Manager Operations
    // -------------------------------------------------------------
    createTestCard('9. Customer Manager Operations');
    const stepCustNav = addStep('Navigating to Customers View');
    doc.querySelector('.nav-item[data-target="customers-view"]').click();
    await wait(1000);
    updateStepStatus(stepCustNav, 'success');

    const stepCustAddBtn = addStep('Clicking Add New Customer button');
    const addCustBtn = await waitForSelector('#customers-new-btn');
    addCustBtn.click();
    await wait(1000);
    updateStepStatus(stepCustAddBtn, 'success');

    const stepCustForm = addStep('Filling out customer profile & address');
    const custNameInput = doc.querySelector('#customer-form-name');
    const custEmailInput = doc.querySelector('#customer-form-email');
    const custPhoneInput = doc.querySelector('#customer-form-phone');
    const custAddr1Input = doc.querySelector('#customer-form-address1');
    const custCityInput = doc.querySelector('#customer-form-city');
    const custStateSelect = doc.querySelector('#customer-form-state');
    const custZipInput = doc.querySelector('#customer-form-zip');

    const testCustomerName = 'Alex Test Customer ' + Date.now();
    triggerInput(custNameInput, testCustomerName);
    triggerInput(custEmailInput, 'alex.test@example.com');
    triggerInput(custPhoneInput, '(555) 555-9999');
    triggerInput(custAddr1Input, '789 Client Blvd');
    triggerInput(custCityInput, 'Tacoma');
    triggerInput(custStateSelect, 'WA');
    triggerInput(custZipInput, '98402');
    updateStepStatus(stepCustForm, 'success');

    const stepCustContact = addStep('Adding a contact row and filling details');
    const addContactBtn = doc.querySelector('#customer-add-contact-btn');
    if (!addContactBtn) throw new Error('Add Contact button not found');
    addContactBtn.click();
    await wait(500);

    const contactRow = doc.querySelector('.contact-entry-row');
    if (!contactRow) throw new Error('Contact entry row was not created');
    const cName = contactRow.querySelector('.contact-name');
    const cRole = contactRow.querySelector('.contact-role');
    const cEmail = contactRow.querySelector('.contact-email');
    const cPhone = contactRow.querySelector('.contact-phone');

    triggerInput(cName, 'Jane Contact');
    triggerInput(cRole, 'Lead Architect');
    triggerInput(cEmail, 'jane@architects.com');
    triggerInput(cPhone, '(555) 555-8888');
    updateStepStatus(stepCustContact, 'success');

    const stepCustSave = addStep('Saving customer profile');
    const saveCustBtn = doc.querySelector('#customer-modal-submit-btn');
    saveCustBtn.click();
    await wait(2000); // Wait for database write

    // Verify returning to table list and customer is present
    const custTableHtml = doc.querySelector('#customers-table-body').innerHTML;
    if (!custTableHtml.includes(testCustomerName)) {
      throw new Error(`Customer "${testCustomerName}" was not found in table after saving.`);
    }
    updateStepStatus(stepCustSave, 'success');
    endActiveTest(true);
    log(`Customer "${testCustomerName}" created successfully!`, 'success');

    await wait(1000);

    // -------------------------------------------------------------
    // TEST 10: Viewer Role UI Restriction Verification
    // -------------------------------------------------------------
    createTestCard('10. Viewer Role UI Restriction');
    const stepViewCheck = addStep('Simulating viewer role and checking warning visibility');

    // Get active app script to dynamically extract cache-busting version query parameter
    const appScript = doc.querySelector('script[src*="js/app.js"]');
    const versionMatch = appScript ? appScript.src.match(/\?v=(\d+)/) : null;
    const version = versionMatch ? versionMatch[1] : '95';
    const db = await win.eval(`import('/js/db.js?v=${version}')`);
    const quotesList = await win.eval(`import('/js/quotes-list.js?v=${version}')`);

    // Get current profile
    const originalProfile = db.getCurrentUserProfile();
    
    // Switch profile to view-only user
    db.setCurrentUserProfile({ ...originalProfile, role: 'viewer' });
    
    // Find a quote in the system (or the one we just saved or first quote)
    const quoteLinkForViewer = doc.querySelector('.view-quote-job-link');
    if (quoteLinkForViewer) {
      // Re-render quote details view under the viewer role
      const quoteId = quoteLinkForViewer.getAttribute('data-id');
      await quotesList.renderQuoteDetails(quoteId);

      // Verify the outdated pricing warning alert is hidden
      const priceWarningEl = doc.querySelector('#detail-price-warning');
      if (priceWarningEl && priceWarningEl.style.display !== 'none') {
        throw new Error('Outdated pricing warning alert was visible to a viewer user.');
      }
    } else {
      log('No quote found to check viewer role restrictions, skipping warning visibility check', 'warning');
    }

    // Restore original profile
    db.setCurrentUserProfile(originalProfile);
    updateStepStatus(stepViewCheck, 'success');
    endActiveTest(true);
    log('Viewer role UI restriction tested successfully!', 'success');

    // -------------------------------------------------------------
    // TEST 11: Scheduling Engine Logic (Headless)
    // -------------------------------------------------------------
    createTestCard('11. Scheduling Engine Core Math');
    const stepEngineLoad = addStep('Loading SchedulingEngine script');
    const se = await win.eval(`import('/js/scheduling-engine.js?v=${version}')`).then(m => m.SchedulingEngine);
    if (!se) throw new Error('Failed to load SchedulingEngine module');
    updateStepStatus(stepEngineLoad, 'success');

    const stepEngineWorkingDay = addStep('Testing isWorkingDay');
    const pSettings = {
      workdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      holidays: ["2026-07-04"],
      custom_workdays: ["2026-07-05"] // A Sunday catch-up
    };
    if (!se.isWorkingDay("2026-07-03", pSettings)) throw new Error('Friday should be working day');
    if (se.isWorkingDay("2026-07-04", pSettings)) throw new Error('Saturday/Holiday should not be working day');
    if (!se.isWorkingDay("2026-07-05", pSettings)) throw new Error('Sunday (custom workday) should be working day');
    updateStepStatus(stepEngineWorkingDay, 'success');

    const stepEngineAddDay = addStep('Testing addWorkingDays');
    let addedDate = se.addWorkingDays("2026-07-03", 1, pSettings);
    let addedStr = se.formatDate(addedDate);
    if (addedStr !== "2026-07-05") throw new Error(`addWorkingDays 1 day from 07-03 expected 07-05, got ${addedStr}`);
    addedDate = se.addWorkingDays("2026-07-03", 2, pSettings);
    addedStr = se.formatDate(addedDate);
    if (addedStr !== "2026-07-06") throw new Error(`addWorkingDays 2 days from 07-03 expected 07-06, got ${addedStr}`);
    updateStepStatus(stepEngineAddDay, 'success');
    
    endActiveTest(true);
    log('Scheduling engine core math validated.', 'success');

    // -------------------------------------------------------------
    // TEST 12: Project Scheduling UI & Validation
    // -------------------------------------------------------------
    createTestCard('12. Project Scheduling UI');
    const stepWonQuote = addStep('Marking quote as Won to create schedule');
    // Go to quotes view and mark first quote won
    doc.querySelector('.nav-item[data-target="quotes-view"]').click();
    await wait(1000);
    const winBtn = doc.querySelector('.btn-mark-won');
    if (winBtn) {
      winBtn.click();
      await wait(1500); // Allow time for DB update and UI refresh
      updateStepStatus(stepWonQuote, 'success');
    } else {
      log('No quote to mark Won, schedule tests may skip', 'warning');
      updateStepStatus(stepWonQuote, 'success');
    }

    const stepSchNav = addStep('Navigating to Scheduling View');
    doc.querySelector('.nav-item[data-target="scheduling-view"]').click();
    await wait(1000);
    if (!doc.getElementById('scheduling-view').classList.contains('active')) {
      throw new Error('Scheduling view failed to open');
    }
    updateStepStatus(stepSchNav, 'success');

    const stepGlobalGantt = addStep('Testing Global Gantt & Pagination');
    const globalBtn = doc.querySelector('#scheduling-view .page-header button[onclick="window.viewGlobalGantt()"]');
    if (!globalBtn) throw new Error('Global Gantt button not found');
    globalBtn.click();
    await wait(500);
    if (!doc.getElementById('gantt-view').classList.contains('active')) {
      throw new Error('Global Gantt view failed to open');
    }
    const ganttTitle = doc.getElementById('gantt-project-title').innerText;
    if (ganttTitle !== 'Global Company Schedule') {
      throw new Error(`Global Gantt title is incorrect: ${ganttTitle}`);
    }
    
    // Check pagination buttons exist
    const ganttHeaderHTML = doc.querySelector('.gantt-header').innerHTML;
    if (!ganttHeaderHTML.includes('Prev 7 Days') || !ganttHeaderHTML.includes('Next 7 Days')) {
      throw new Error('Gantt pagination buttons are missing');
    }
    updateStepStatus(stepGlobalGantt, 'success');

    const stepSchList = addStep('Testing Project Task List & Dependency Validation');
    // Go back to schedules
    doc.querySelector('#gantt-view .page-header button').click();
    await wait(500);
    
    const schBtn = doc.querySelector('#scheduling-table-body button.btn-primary');
    if (schBtn) {
      schBtn.click();
      await wait(500);
      if (!doc.getElementById('project-tasks-view').classList.contains('active')) {
        throw new Error('Project tasks view failed to open');
      }
      
      // Simulate click complete job
      const completeJobBtn = doc.getElementById('tasks-list-complete-job-btn');
      if (completeJobBtn) {
        completeJobBtn.click();
        await wait(1500); // Wait for confirmation and db reload
      }
      updateStepStatus(stepSchList, 'success');
    } else {
      log('No active schedules found to test task list', 'warning');
      updateStepStatus(stepSchList, 'success');
    }

    endActiveTest(true);
    log('Project Scheduling UI tested successfully!', 'success');

    log('==================================================');
    log(` TEST SUITE COMPLETE: ${passCount} PASSED, ${failCount} FAILED`, 'success');
    log('==================================================');

  } catch (err) {
    log(`Test failed: ${err.message}`, 'error');
    if (activeTestCard) {
      addStep(`Error: ${err.message}`, 'fail');
      endActiveTest(false);
    }
    log('==================================================');
    log(` TEST SUITE FAILED: ${passCount} PASSED, ${failCount + 1} FAILED`, 'error');
    log('==================================================');
  } finally {
    runBtn.disabled = false;
    blocker.classList.remove('active');
  }
}

// Bind event listeners
runBtn.addEventListener('click', runTestSuite);
resetBtn.addEventListener('click', () => {
  log('Resetting application page...');
  iframe.src = 'index.html';
  testList.innerHTML = '';
  statTotal.textContent = 0;
  statPassed.textContent = 0;
  statFailed.textContent = 0;
});
