// Application Entry Point & Coordinator Router
import { 
  initSupabaseClient, 
  isSupabaseConnected, 
  loadUserSession, 
  getCurrentUserProfile, 
  setCurrentUserProfile, 
  getSupabaseConfig, 
  setSupabaseConfig, 
  getSettings, 
  saveSettings, 
  exportDB, 
  importDB, 
  getQuoteById, 
  getSupabase,
  getAllCompanies,
  switchUserCompany,
  uploadFileToStorage,
  rawDbWrite,
  getSubscriptionLevel
} from './db.js?v=74';
import { showToast, fileToBase64 } from './utils.js';
import { initCatalogView, renderCatalogTable, populateCategoryDropdowns } from './catalog.js?v=74';
import { initQuotesListView, renderDashboardStats, renderDashboardExpirations, renderQuotesTable, renderQuoteDetails } from './quotes-list.js?v=74';
import { initQuoteBuilderView, startNewQuote, loadQuoteForEditing, loadQuoteAsTemplate } from './quote-builder.js?v=74';
import { initCustomersView, renderCustomersTable } from './customers.js?v=74';

let activeChallengeId = null;
let activeFactorId = null;

let isAppInitialized = false;
let currentUserSession = null;
let isSettingsListenersSetup = false;
let isDbUtilityListenersSetup = false;
let isSwitchingCompany = false;

// Session Expiry Timers
let sessionWarningTimeout = null;
let sessionExpiryTimeout = null;
let sessionCountdownInterval = null;
let currentSessionExpiryTime = 0;

document.addEventListener('DOMContentLoaded', async () => {
  // Bind global logout delegation immediately
  document.addEventListener('click', async (e) => {
    const logoutBtn = e.target.closest('#auth-logout-btn, .settings-logout-btn, #session-logout-btn');
    if (logoutBtn) {
      console.log('Global click listener -> Logout button clicked!');
      e.preventDefault();
      try {
        const sb = getSupabase();
        if (sb) {
          await sb.auth.signOut();
        }
      } catch (err) {
        console.error('Error during signOut:', err);
      } finally {
        // Manually clean up any local storage auth keys to ensure they are redirected
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && (key.includes('supabase.auth') || key.includes('auth-token') || key.includes('supabase-key'))) {
            localStorage.removeItem(key);
          }
        }
        showToast('Logged out.');
        window.location.reload();
      }
    }
  });

  // 1. Check for Supabase configuration keys
  await initSupabaseClient();
  if (!isSupabaseConnected()) {
    showSupabaseSetupModal();
    return;
  }

  setupSessionWarningListeners();
  setupForgotPasswordListeners();
  setupRecoveryFormListener();
  await setupAuthListener();
});

// Displays Setup dialog overlay if keys are missing
function showSupabaseSetupModal() {
  const modal = document.getElementById('supabase-setup-modal');
  if (modal) modal.classList.add('active');

  const form = document.getElementById('supabase-setup-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('setup-supabase-url').value.trim();
      const key = document.getElementById('setup-supabase-key').value.trim();

      if (url && key) {
        await setSupabaseConfig(url, key);
        modal.classList.remove('active');
        showToast('Supabase connection details saved.');
        await setupAuthListener();
      }
    });
  }
}

// Setup Auth State listener to handle login, logout, and OAuth redirects
async function setupAuthListener() {
  const sb = getSupabase();
  if (!sb) {
    showSupabaseSetupModal();
    return;
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    try {
      console.log('Auth State Event:', event, session);
      currentUserSession = session;
      
      if (event === 'PASSWORD_RECOVERY') {
        const recoveryModal = document.getElementById('recovery-modal');
        if (recoveryModal) recoveryModal.classList.add('active');
        hideAuthModal();
        return;
      }
      
      if (session) {
        startSessionMonitoring(session);
        const profile = await loadUserSession(session);
        console.log('setupAuthListener -> Loaded profile:', profile);
        if (profile) {
          hideAuthModal();
          applyUserRoleRestrictions(profile);
          if (!isAppInitialized) {
            await initAppViews();
          } else {
            // Refresh settings/branding on state update
            await loadDefaultSettingsToUI();
            updateBrandHeader();
          }
        } else {
          showToast('Failed to load user profile.', 'danger');
          showAuthModal();
        }
      } else {
        clearSessionMonitoring();
        applyUserRoleRestrictions(null);
        showAuthModal();
      }
    } catch (e) {
      console.error('Error in auth state listener:', e);
      showAuthModal();
    }
  });
}

function applyUserRoleRestrictions(profile) {
  const isViewer = profile && profile.role === 'viewer';
  const catalogTab = document.querySelector('.nav-item[data-target="catalog-view"]');
  const settingsTab = document.querySelector('.nav-item[data-target="settings-view"]');
  
  if (catalogTab) {
    catalogTab.style.display = isViewer ? 'none' : 'block';
  }
  if (settingsTab) {
    settingsTab.style.display = isViewer ? 'none' : 'block';
  }
  
  // Dashboard quick actions
  const dashActCat = document.getElementById('dash-action-manage-catalog');
  const dashActSet = document.getElementById('dash-action-settings');
  const dashActNew = document.getElementById('dash-action-new-quote');
  const dashNewBtn = document.getElementById('dashboard-new-quote-btn');
  const listNewBtn = document.getElementById('list-new-quote-btn');
  
  if (dashActCat) dashActCat.style.display = isViewer ? 'none' : 'flex';
  if (dashActSet) dashActSet.style.display = isViewer ? 'none' : 'flex';
  if (dashActNew) dashActNew.style.display = isViewer ? 'none' : 'flex';
  if (dashNewBtn) dashNewBtn.style.display = isViewer ? 'none' : 'inline-flex';
  if (listNewBtn) listNewBtn.style.display = isViewer ? 'none' : 'inline-flex';
}

// Monitor session expiry for JWT warning/countdown
function startSessionMonitoring(session) {
  clearSessionMonitoring();
  
  if (!session || !session.expires_at) return;
  
  currentSessionExpiryTime = session.expires_at * 1000;
  const timeLeftMs = currentSessionExpiryTime - Date.now();
  
  if (timeLeftMs <= 0) {
    forceLogout();
    return;
  }
  
  // Warn user 60 seconds before expiration
  const warningDelayMs = timeLeftMs - 60000;
  
  if (warningDelayMs > 0) {
    sessionWarningTimeout = setTimeout(showSessionWarningModal, warningDelayMs);
  } else {
    // Session is already in the last 60 seconds, show warning immediately
    showSessionWarningModal();
  }
  
  // Set automatic hard logout when it expires
  sessionExpiryTimeout = setTimeout(forceLogout, timeLeftMs);
}

function clearSessionMonitoring() {
  if (sessionWarningTimeout) clearTimeout(sessionWarningTimeout);
  if (sessionExpiryTimeout) clearTimeout(sessionExpiryTimeout);
  if (sessionCountdownInterval) clearInterval(sessionCountdownInterval);
  
  sessionWarningTimeout = null;
  sessionExpiryTimeout = null;
  sessionCountdownInterval = null;
  
  // Hide warning modal if open
  const warningModal = document.getElementById('session-timeout-modal');
  if (warningModal) warningModal.classList.remove('active');
}

function showSessionWarningModal() {
  const warningModal = document.getElementById('session-timeout-modal');
  if (!warningModal) return;
  
  warningModal.classList.add('active');
  
  const updateCountdown = () => {
    const secLeft = Math.ceil((currentSessionExpiryTime - Date.now()) / 1000);
    const countdownEl = document.getElementById('session-countdown');
    if (countdownEl) countdownEl.textContent = Math.max(0, secLeft);
    
    if (secLeft <= 0) {
      clearInterval(sessionCountdownInterval);
    }
  };
  
  updateCountdown();
  if (sessionCountdownInterval) clearInterval(sessionCountdownInterval);
  sessionCountdownInterval = setInterval(updateCountdown, 1000);
}

async function forceLogout() {
  clearSessionMonitoring();
  const sb = getSupabase();
  if (sb) {
    await sb.auth.signOut();
  }
  showToast('Your session has expired. Please log in again.', 'warning');
}

// Setup event listeners for the session warning modal
function setupSessionWarningListeners() {
  const logoutBtn = document.getElementById('session-logout-btn');
  const extendBtn = document.getElementById('session-extend-btn');
  const warningModal = document.getElementById('session-timeout-modal');
  
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      clearSessionMonitoring();
      const sb = getSupabase();
      if (sb) {
        await sb.auth.signOut();
      }
    });
  }
  
  if (extendBtn) {
    extendBtn.addEventListener('click', async () => {
      const sb = getSupabase();
      if (sb) {
        showToast('Extending session...');
        const { data, error } = await sb.auth.refreshSession();
        if (error) {
          showToast('Failed to extend session: ' + error.message, 'danger');
          await sb.auth.signOut();
        } else {
          showToast('Session extended successfully.', 'success');
          if (warningModal) warningModal.classList.remove('active');
          if (data && data.session) {
            startSessionMonitoring(data.session);
          }
        }
      }
    });
  }
}

// Setup event listeners for Forgot Password request flow
function setupForgotPasswordListeners() {
  const backBtn = document.getElementById('auth-forgot-back-btn');
  const forgotForm = document.getElementById('auth-forgot-form');

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      document.getElementById('auth-forgot-container').style.display = 'none';
      document.getElementById('auth-main-container').style.display = 'block';
    });
  }

  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('auth-forgot-email').value.trim();
      const submitBtn = document.getElementById('auth-forgot-submit-btn');

      if (!email) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';

      try {
        const sb = getSupabase();
        if (!sb) throw new Error('Supabase client not initialized');

        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname
        });

        if (error) {
          showToast(error.message, 'danger');
        } else {
          showToast('Password reset link sent! Please check your email.');
          // Toggle back to login
          document.getElementById('auth-forgot-container').style.display = 'none';
          document.getElementById('auth-main-container').style.display = 'block';
        }
      } catch (err) {
        console.error('Forgot password error:', err);
        showToast('An error occurred. Please try again.', 'danger');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Reset Link';
      }
    });
  }
}

// Setup event listeners for the Password Recovery Form
function setupRecoveryFormListener() {
  const recoveryForm = document.getElementById('recovery-form');
  if (recoveryForm) {
    recoveryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newPassword = document.getElementById('recovery-new-password').value;
      const confirmPassword = document.getElementById('recovery-confirm-password').value;

      if (!newPassword || newPassword.length < 6) {
        showToast('Password must be at least 6 characters long.', 'danger');
        return;
      }

      if (newPassword !== confirmPassword) {
        showToast('Passwords do not match.', 'danger');
        return;
      }

      const submitBtn = document.getElementById('recovery-submit-btn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Resetting...';

      try {
        const sb = getSupabase();
        if (!sb) throw new Error('Supabase client not initialized');

        const { error } = await sb.auth.updateUser({ password: newPassword });
        if (error) {
          showToast(error.message, 'danger');
        } else {
          showToast('Password reset successfully! Logging you in...');
          const recoveryModal = document.getElementById('recovery-modal');
          if (recoveryModal) recoveryModal.classList.remove('active');
          
          if (!isAppInitialized) {
            await initAppViews();
          }
        }
      } catch (err) {
        console.error('Password recovery error:', err);
        showToast('An error occurred during password reset.', 'danger');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reset Password';
      }
    });
  }
}

// Display Login/Signup card overlay
function showAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.add('active');

  const authMainCont = document.getElementById('auth-main-container');
  const authForgotCont = document.getElementById('auth-forgot-container');
  if (authMainCont) authMainCont.style.display = 'block';
  if (authForgotCont) authForgotCont.style.display = 'none';

  const tabLogin = document.getElementById('auth-tab-login');
  const tabSignup = document.getElementById('auth-tab-signup');
  const title = document.getElementById('auth-modal-title');
  const submitBtn = document.getElementById('auth-submit-btn');
  const form = document.getElementById('auth-form');

  let mode = 'login'; // 'login' or 'signup'

  // Parse invite details from URL
  const urlParams = new URLSearchParams(window.location.search);
  const isInvite = urlParams.get('invite') === 'true';
  const inviteEmail = urlParams.get('email');

  const setTab = (newMode) => {
    mode = newMode;
    const confirmGroup = document.getElementById('auth-confirm-password-group');
    const confirmInput = document.getElementById('auth-confirm-password');
    const liveSubmitBtn = document.getElementById('auth-submit-btn');
    const forgotLink = document.getElementById('auth-forgot-password-link');

    if (mode === 'login') {
      tabLogin.classList.add('active');
      tabSignup.classList.remove('active');
      title.textContent = 'MyBidBook';
      if (liveSubmitBtn) liveSubmitBtn.textContent = 'Sign In';
      if (confirmGroup) confirmGroup.style.display = 'none';
      if (confirmInput) {
        confirmInput.removeAttribute('required');
        confirmInput.value = '';
      }
      if (forgotLink) forgotLink.style.display = 'inline';
    } else {
      tabLogin.classList.remove('active');
      tabSignup.classList.add('active');
      if (isInvite && inviteEmail) {
        title.textContent = 'Accept Invitation & Sign Up';
      } else {
        title.textContent = 'Create Contractor Tenant';
      }
      if (liveSubmitBtn) liveSubmitBtn.textContent = 'Register';
      if (confirmGroup) confirmGroup.style.display = 'block';
      if (confirmInput) confirmInput.setAttribute('required', 'required');
      if (forgotLink) forgotLink.style.display = 'none';
    }
  };

  if (tabLogin) tabLogin.addEventListener('click', () => setTab('login'));
  if (tabSignup) tabSignup.addEventListener('click', () => setTab('signup'));

  if (isInvite && inviteEmail) {
    const emailInput = document.getElementById('auth-email');
    if (emailInput) {
      emailInput.value = inviteEmail;
      emailInput.disabled = true; // Lock email field
    }
    if (tabLogin) tabLogin.style.display = 'none'; // Hide sign in tab
    setTab('signup');
  } else {
    const emailInput = document.getElementById('auth-email');
    if (emailInput) emailInput.disabled = false;
    if (tabLogin) tabLogin.style.display = 'inline-block';
    setTab('login');
  }

  if (form) {
    // Remove clone listener if already bound
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);

    // Bind Forgot Password Link inside the new form!
    const forgotLink = newForm.querySelector('#auth-forgot-password-link');
    if (forgotLink) {
      forgotLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (authMainCont) authMainCont.style.display = 'none';
        if (authForgotCont) authForgotCont.style.display = 'block';
      });
    }

    newForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;

      if (!email || !password) return;

      const sb = getSupabase();
      if (mode === 'login') {
        showToast('Authenticating...');
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
          showToast(error.message, 'danger');
        } else {
          // Check if MFA challenge is required
          await handleAuthSuccess(data);
        }
      } else {
        const confirmPassword = document.getElementById('auth-confirm-password').value;
        if (password !== confirmPassword) {
          showToast('Passwords do not match.', 'danger');
          return;
        }
        showToast('Provisioning tenant environment...');
        const redirectUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '') + '/verified.html';
        const { data, error } = await sb.auth.signUp({ 
          email, 
          password,
          options: {
            emailRedirectTo: redirectUrl
          }
        });
        if (error) {
          showToast(error.message, 'danger');
        } else {
          showToast('Signup successful! Check your email to verify and activate your account.', 'success');
          setTab('login');
        }
      }
    });
  }

  // Google OAuth flow
  const googleBtn = document.getElementById('auth-google-btn');
  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      const sb = getSupabase();
      showToast('Initiating Google sign-in...');
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + window.location.pathname
        }
      });
      if (error) showToast(error.message, 'danger');
    });
  }
}

// Processes successful auth logic, checking for TOTP challenge overrides
async function handleAuthSuccess(authData) {
  const sb = getSupabase();
  
  // Fetch authentication assurance levels (AAL)
  const { data: mfaData, error: mfaErr } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (mfaErr) {
    console.error('MFA Level fetch error:', mfaErr);
  }

  if (mfaData && mfaData.nextLevel === 'aal2' && mfaData.currentLevel !== 'aal2') {
    // MFA TOTP validation required
    const { data: factors, error: fErr } = await sb.auth.mfa.listFactors();
    if (fErr) {
      showToast(fErr.message, 'danger');
      return;
    }
    const totpFactor = factors.totp.find(f => f.status === 'verified');
    if (totpFactor) {
      const { data: challenge, error: cErr } = await sb.auth.mfa.challenge({ factorId: totpFactor.id });
      if (cErr) {
        showToast(cErr.message, 'danger');
        return;
      }
      activeChallengeId = challenge.id;
      activeFactorId = totpFactor.id;

      // Show MFA input dialog
      const authModal = document.getElementById('auth-modal');
      if (authModal) authModal.classList.remove('active');
      
      const mfaModal = document.getElementById('mfa-modal');
      if (mfaModal) mfaModal.classList.add('active');

      setupMfaCodeListener();
    } else {
      // MFA listed but not verified? Boot normally
      await proceedToApp();
    }
  } else {
    // Standard password login successful
    await proceedToApp();
  }
}

function setupMfaCodeListener() {
  const form = document.getElementById('mfa-form');
  if (form) {
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);

    newForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('mfa-code-input').value.trim();
      if (code.length !== 6) return;

      const sb = getSupabase();
      showToast('Verifying security token...');
      const { error } = await sb.auth.mfa.verify({
        factorId: activeFactorId,
        challengeId: activeChallengeId,
        code
      });

      if (error) {
        showToast('Invalid security code. Please try again.', 'danger');
      } else {
        const mfaModal = document.getElementById('mfa-modal');
        if (mfaModal) mfaModal.classList.remove('active');
        await proceedToApp();
      }
    });
  }
}

async function proceedToApp() {
  const profile = await loadUserSession();
  if (profile) {
    hideAuthModal();
    showToast(`Logged in as ${profile.email}`);
    await initAppViews();
  } else {
    showToast('Failed to load user company profile.', 'danger');
    showAuthModal();
  }
}

function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.remove('active');
  const setupModal = document.getElementById('supabase-setup-modal');
  if (setupModal) setupModal.classList.remove('active');
  const logoutBtn = document.getElementById('auth-logout-btn');
  if (logoutBtn) logoutBtn.style.display = 'inline-flex';
}

// Boots application views and listeners
async function initAppViews() {
  if (isAppInitialized) {
    console.log('initAppViews -> Already initialized. Skipping duplicate initialization.');
    return;
  }
  isAppInitialized = true;
  console.log('initAppViews -> Starting components initialization...');
  // Initialize View Components
  try {
    console.log('initAppViews -> Initializing Quotes list view...');
    await initQuotesListView();
    console.log('initAppViews -> Initializing Catalog view...');
    await initCatalogView();
    console.log('initAppViews -> Initializing Quote Builder view...');
    initQuoteBuilderView();
    console.log('initAppViews -> Initializing Customers view...');
    await initCustomersView();
    console.log('initAppViews -> All views initialized.');
  } catch (e) {
    console.error('Failed to initialize views:', e);
  }

  // Core App Navigation & Setup
  try {
    setupAppNavigation();
    setupThemeToggler();
    setupSettingsHandlers();
    setupDatabaseUtilityHandlers();
  } catch (e) {
    console.error('Failed to setup navigation and handlers:', e);
  }

  // Initial UI draw
  try {
    await loadDefaultSettingsToUI();
    updateBrandHeader();
  } catch (e) {
    console.error('Failed to draw initial settings UI:', e);
  }
  
  // Logout buttons handled globally in DOMContentLoaded

  // Load team users and MFA status panels in settings
  try {
    await loadTeamManagementUI();
  } catch (e) {
    console.error('Failed to load team management:', e);
  }

  try {
    await loadMfaSettingsUI();
  } catch (e) {
    console.error('Failed to load MFA settings:', e);
  }
}

/* ==================== VIEW ROUTER ==================== */
export async function navigateToView(viewId) {
  const profile = getCurrentUserProfile();
  if (profile && profile.role === 'viewer') {
    if (viewId === 'catalog-view' || viewId === 'settings-view' || viewId === 'builder-view') {
      showToast('Viewers do not have access to this page.', 'danger');
      return navigateToView('dashboard-view');
    }
  }

  const sections = document.querySelectorAll('.view-section');
  sections.forEach(s => s.classList.remove('active'));

  const targetSection = document.getElementById(viewId);
  if (targetSection) {
    targetSection.classList.add('active');
  }

  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    if (item.getAttribute('data-target') === viewId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  if (viewId === 'dashboard-view') {
    await renderDashboardStats();
    await renderDashboardExpirations();
  } else if (viewId === 'quotes-view') {
    await renderQuotesTable();
  } else if (viewId === 'catalog-view') {
    await renderCatalogTable();
  } else if (viewId === 'customers-view') {
    await renderCustomersTable();
  } else if (viewId === 'settings-view') {
    await loadDefaultSettingsToUI();
    await loadTeamManagementUI();
    await loadMfaSettingsUI();
  }
}

export async function editQuote(id) {
  const quote = await getQuoteById(id);
  if (quote) {
    const profile = getCurrentUserProfile();
    if (profile && profile.role === 'viewer') {
      showToast('Read-only accounts cannot modify quotes.', 'danger');
      return;
    }
    if (quote.status !== 'Pending' || quote.isLegacy) {
      showToast('Only quotes in "Pending" status can be edited. To make changes, please reactivate this quote as a new version first.', 'danger');
      return;
    }
    await loadQuoteForEditing(quote);
    await navigateToView('builder-view');
  }
}

export async function duplicateQuoteAsTemplate(id) {
  const quote = await getQuoteById(id);
  if (quote) {
    const profile = getCurrentUserProfile();
    if (profile && profile.role === 'viewer') {
      showToast('Read-only accounts cannot create templates.', 'danger');
      return;
    }
    await loadQuoteAsTemplate(quote);
    await navigateToView('builder-view');
  }
}

export async function viewQuoteDetails(id) {
  await renderQuoteDetails(id);
  await navigateToView('detail-view');
}

export async function updateBrandHeader() {
  console.log('updateBrandHeader -> Starting...');
  const settings = await getSettings();
  const nameEl = document.getElementById('brand-company-name');
  const logoContainer = document.getElementById('brand-logo-container');
  const profile = getCurrentUserProfile();
  console.log('updateBrandHeader -> Profile:', profile, 'nameEl:', !!nameEl);

  if (nameEl) {
    if (profile && profile.role === 'sysadmin') {
      const companies = await getAllCompanies();
      const hasSelected = companies.some(c => c.id === profile.company_id);
      let selectHtml = `<select id="brand-company-select" style="
        background: var(--bg-secondary);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        padding: 0.35rem 0.5rem;
        font-size: 0.9rem;
        font-weight: 700;
        max-width: 100%;
        width: 180px;
        cursor: pointer;
        outline: none;
        box-sizing: border-box;
        margin-top: 0.25rem;
      ">`;
      if (!hasSelected) {
        selectHtml += `<option value="" disabled selected>-- Select Company --</option>`;
      }
      companies.forEach(company => {
        const isSelected = company.id === profile.company_id ? 'selected' : '';
        selectHtml += `<option value="${company.id}" ${isSelected}>${company.name}</option>`;
      });
      selectHtml += `</select>`;
      nameEl.innerHTML = selectHtml;

      const selectEl = document.getElementById('brand-company-select');
      if (selectEl) {
        console.log('updateBrandHeader -> Successfully bound change listener to brand-company-select');
        selectEl.addEventListener('change', async (e) => {
          const newCompanyId = e.target.value;
          const companyName = e.target.options[e.target.selectedIndex].text;
          console.log('brand-company-select -> change event fired. Selected company:', companyName, 'ID:', newCompanyId, 'isSwitchingCompany:', isSwitchingCompany);
          if (isSwitchingCompany) {
            console.warn('brand-company-select -> switch already in progress, aborting.');
            return;
          }
          isSwitchingCompany = true;
          
          try {
            console.log('brand-company-select -> Triggering switchUserCompany...');
            const success = await switchUserCompany(newCompanyId);
            console.log('brand-company-select -> switchUserCompany success result:', success);
            if (success) {
              showToast(`Switched to ${companyName}!`, 'success');
              
              // Retrigger same initialization pipeline as login, using the active session
              const profile = await loadUserSession(currentUserSession);
              if (profile) {
                applyUserRoleRestrictions(profile);
                await loadDefaultSettingsToUI();
                updateBrandHeader();
                await loadTeamManagementUI();
                
                // Refresh and re-render current view dynamically
                const activeViewEl = document.querySelector('.view-section.active');
                const activeViewId = activeViewEl ? activeViewEl.id : 'dashboard-view';
                await navigateToView(activeViewId);
              }
            } else {
              showToast('Failed to switch company.', 'danger');
            }
          } catch (err) {
            console.error('Error during company switch event:', err);
          } finally {
            isSwitchingCompany = false;
          }
        });
      }
    } else {
      nameEl.textContent = settings.companyName || 'MyBidBook';
    }
  }

  const subLabelEl = document.getElementById('brand-subscription-label');
  if (subLabelEl) {
    const subLevel = getSubscriptionLevel();
    if (subLevel === 'pro_perpetual') {
      subLabelEl.textContent = 'Pro Perpetual';
    } else if (subLevel === 'pro') {
      subLabelEl.textContent = 'Pro';
    } else {
      subLabelEl.textContent = 'Trial';
    }
  }

  if (logoContainer) {
    if (settings.companyLogo) {
      logoContainer.innerHTML = `<img src="${settings.companyLogo}" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit;">`;
      logoContainer.style.background = 'transparent';
    } else {
      logoContainer.innerHTML = `<img src="logo.jpg" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit;">`;
      logoContainer.style.background = 'transparent';
    }
  }
}

/* ==================== CORE EVENT BINDERS ==================== */
function setupAppNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.getAttribute('data-target');
      if (target) navigateToView(target);
    });
  });

  // Contact Support handler - immediately opens mail client
  const supportOpenBtn = document.getElementById('support-open-btn');
  if (supportOpenBtn) {
    supportOpenBtn.addEventListener('click', () => {
      window.location.href = 'mailto:contact@mybidbook.com?subject=MyBidBook App Support';
    });
  }

  const dashNewBtn = document.getElementById('dashboard-new-quote-btn');
  const dashActNew = document.getElementById('dash-action-new-quote');
  const dashActCat = document.getElementById('dash-action-manage-catalog');
  const dashActSet = document.getElementById('dash-action-settings');
  const listNewBtn = document.getElementById('list-new-quote-btn');

  const triggerNewQuote = async () => {
    const profile = getCurrentUserProfile();
    if (profile && profile.role === 'viewer') {
      showToast('Read-only accounts cannot create proposals.', 'danger');
      return;
    }
    await startNewQuote();
    await navigateToView('builder-view');
  };

  if (dashNewBtn) {
    dashNewBtn.addEventListener('click', triggerNewQuote);
  }
  if (dashActNew) {
    dashActNew.addEventListener('click', triggerNewQuote);
  }
  if (listNewBtn) {
    listNewBtn.addEventListener('click', triggerNewQuote);
  }

  if (dashActCat) {
    dashActCat.addEventListener('click', () => navigateToView('catalog-view'));
  }
  if (dashActSet) {
    dashActSet.addEventListener('click', () => navigateToView('settings-view'));
  }
}

function setupThemeToggler() {
  const toggleBtn = document.getElementById('theme-toggle-btn');
  const label = document.getElementById('theme-toggle-label');
  const html = document.documentElement;

  const initTheme = async () => {
    const settings = await getSettings();
    const initialTheme = settings.theme || 'light';
    html.setAttribute('data-theme', initialTheme);
    updateThemeButtonUI(initialTheme);
  };
  initTheme();

  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      const currentTheme = html.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      
      html.setAttribute('data-theme', newTheme);
      await saveSettings({ theme: newTheme });
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

async function loadDefaultSettingsToUI() {
  console.log('loadDefaultSettingsToUI -> Starting...');
  const settings = await getSettings();
  console.log('loadDefaultSettingsToUI -> Settings loaded:', settings);
  
  const nameInput = document.getElementById('settings-co-name');
  const addrInput = document.getElementById('settings-co-address');
  const phoneInput = document.getElementById('settings-co-phone');
  const emailInput = document.getElementById('settings-co-email');
  const markupInput = document.getElementById('settings-default-markup');
  const taxInput = document.getElementById('settings-default-tax');
  const logoPreview = document.getElementById('settings-logo-preview');
  const clearBtn = document.getElementById('settings-logo-clear-btn');

  const profile = getCurrentUserProfile();
  const isViewer = profile && profile.role === 'viewer';
  console.log('loadDefaultSettingsToUI -> Profile:', profile);

  const profileEmailInput = document.getElementById('profile-email');
  if (profileEmailInput && profile) {
    profileEmailInput.value = profile.email || '';
  }

  let isGoogleUser = false;
  if (currentUserSession && currentUserSession.user) {
    const user = currentUserSession.user;
    console.log('loadDefaultSettingsToUI -> Synchronously checking user object:', user);
    console.log('loadDefaultSettingsToUI -> app_metadata:', user.app_metadata);
    console.log('loadDefaultSettingsToUI -> identities:', user.identities);
    
    isGoogleUser = user.app_metadata?.provider === 'google' || 
                   (user.app_metadata?.providers && user.app_metadata.providers.includes('google')) ||
                   (user.identities && user.identities.some(i => i.provider === 'google'));
    console.log('loadDefaultSettingsToUI -> Calculated isGoogleUser:', isGoogleUser);
  } else {
    console.log('loadDefaultSettingsToUI -> No currentUserSession or user found!');
  }

  const profileLocalForm = document.getElementById('profile-local-form');
  const profileOauthNotice = document.getElementById('profile-oauth-notice');

  if (isGoogleUser) {
    if (profileLocalForm) profileLocalForm.style.display = 'none';
    if (profileOauthNotice) profileOauthNotice.style.display = 'block';
  } else {
    if (profileLocalForm) profileLocalForm.style.display = 'flex';
    if (profileOauthNotice) profileOauthNotice.style.display = 'none';
  }

  if (nameInput) {
    nameInput.value = settings.companyName || '';
    nameInput.disabled = isViewer;
  }
  if (addrInput) {
    addrInput.value = settings.companyAddress || '';
    addrInput.disabled = isViewer;
  }
  if (phoneInput) {
    phoneInput.value = settings.companyPhone || '';
    phoneInput.disabled = isViewer;
  }
  if (emailInput) {
    emailInput.value = settings.companyEmail || '';
    emailInput.disabled = isViewer;
  }
  if (markupInput) {
    markupInput.value = settings.defaultMarkupPercent || 0;
    markupInput.disabled = isViewer;
  }
  if (taxInput) {
    taxInput.value = settings.defaultTaxRate || 0;
    taxInput.disabled = isViewer;
  }

  const plusTaxCheck = document.getElementById('settings-default-tax-plus-applicable');
  if (plusTaxCheck) {
    plusTaxCheck.checked = settings.defaultTaxPlusApplicable || false;
    plusTaxCheck.disabled = isViewer;
  }

  const termsTextarea = document.getElementById('settings-default-terms-notes');
  if (termsTextarea) {
    termsTextarea.value = settings.defaultTermsNotes || '';
    termsTextarea.disabled = isViewer;
  }

  const saveBtn = document.getElementById('settings-save-btn');
  if (saveBtn) saveBtn.style.display = isViewer ? 'none' : 'inline-flex';

  const uploadLogoLabel = document.querySelector('label[for="settings-logo-upload"]');
  if (uploadLogoLabel) uploadLogoLabel.style.display = isViewer ? 'none' : 'inline-flex';

  if (logoPreview) {
    if (settings.companyLogo) {
      logoPreview.innerHTML = `<img src="${settings.companyLogo}" alt="Company Logo">`;
      if (clearBtn) clearBtn.style.display = isViewer ? 'none' : 'flex';
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

function setupSettingsHandlers() {
  if (isSettingsListenersSetup) return;
  isSettingsListenersSetup = true;
  const saveBtn = document.getElementById('settings-save-btn');
  const logoUpload = document.getElementById('settings-logo-upload');
  const logoClear = document.getElementById('settings-logo-clear-btn');
  
  const profile = getCurrentUserProfile();
  const isViewer = profile && profile.role === 'viewer';

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      if (isViewer) return;
      const updated = {
        companyName: document.getElementById('settings-co-name').value.trim(),
        companyAddress: document.getElementById('settings-co-address').value.trim(),
        companyPhone: document.getElementById('settings-co-phone').value.trim(),
        companyEmail: document.getElementById('settings-co-email').value.trim(),
        defaultMarkupPercent: parseFloat(document.getElementById('settings-default-markup').value) || 0,
        defaultTaxRate: parseFloat(document.getElementById('settings-default-tax').value) || 0,
        defaultTaxPlusApplicable: document.getElementById('settings-default-tax-plus-applicable').checked,
        defaultTermsNotes: document.getElementById('settings-default-terms-notes').value.trim()
      };

      const res = await saveSettings(updated);
      if (res.success) {
        showToast('Company settings profile saved.');
        await renderDashboardStats();
        await updateBrandHeader();
      } else {
        showToast(res.error, 'danger');
      }
    });
  }

  // Settings Company Logo upload to Supabase Storage
  if (logoUpload) {
    logoUpload.addEventListener('change', async (e) => {
      console.log('App: settings-logo-upload change event triggered. Files count:', e.target.files.length);
      if (e.target.files.length > 0 && !isViewer) {
        const file = e.target.files[0];
        const sb = getSupabase();
        console.log('App: settings-logo-upload -> file:', file.name, 'sb connected:', !!sb, 'profile:', profile);
        if (sb && profile) {
          showToast('Uploading brand logo...');
          const filePath = `${profile.company_id}/settings_logo_${Math.random().toString(36).substr(2, 9)}_${file.name}`;
          console.log('App: settings-logo-upload -> Uploading to path:', filePath);
          const { error } = await uploadFileToStorage('company-logos', filePath, file);
          
          if (error) {
            console.error('App: settings-logo-upload -> Storage upload error:', error);
            showToast('Logo upload failed: ' + error.message, 'danger');
            return;
          }
          
          console.log('App: settings-logo-upload -> Storage upload success. Fetching public URL...');
          const { data: { publicUrl } } = sb.storage.from('company-logos').getPublicUrl(filePath);
          console.log('App: settings-logo-upload -> Public URL:', publicUrl, 'Saving settings...');
          const res = await saveSettings({ companyLogo: publicUrl });
          if (res.success) {
            console.log('App: settings-logo-upload -> Settings updated successfully');
            const logoPreview = document.getElementById('settings-logo-preview');
            logoPreview.innerHTML = `<img src="${publicUrl}" alt="Company Logo">`;
            if (logoClear) logoClear.style.display = 'flex';
            
            showToast('Default company logo saved.');
            await updateBrandHeader();
          } else {
            console.error('App: settings-logo-upload -> Save settings error:', res.error);
            showToast(res.error, 'danger');
          }
        } else {
          console.error('App: settings-logo-upload aborted: sb or profile is missing. sb:', !!sb, 'profile:', profile);
        }
      } else {
        console.log('App: settings-logo-upload aborted: no files or user is viewer. isViewer:', isViewer);
      }
    });
  }

  if (logoClear) {
    logoClear.addEventListener('click', async () => {
      if (isViewer) return;
      const res = await saveSettings({ companyLogo: '' });
      if (res.success) {
        const logoPreview = document.getElementById('settings-logo-preview');
        logoPreview.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        `;
        logoClear.style.display = 'none';
        logoUpload.value = '';
        showToast('Default logo cleared.');
        await updateBrandHeader();
      } else {
        showToast(res.error, 'danger');
      }
    });
  }



  // Profile Change Password Handler
  const updatePasswordBtn = document.getElementById('profile-change-password-btn');
  if (updatePasswordBtn) {
    updatePasswordBtn.addEventListener('click', async () => {
      const newPassword = document.getElementById('profile-new-password').value;
      const confirmPassword = document.getElementById('profile-confirm-password').value;

      if (!newPassword || newPassword.length < 6) {
        showToast('Password must be at least 6 characters long.', 'danger');
        return;
      }

      if (newPassword !== confirmPassword) {
        showToast('Passwords do not match.', 'danger');
        return;
      }

      updatePasswordBtn.disabled = true;
      updatePasswordBtn.textContent = 'Updating...';

      try {
        const sb = getSupabase();
        if (!sb) throw new Error('Supabase client not initialized');

        const { error } = await sb.auth.updateUser({ password: newPassword });
        if (error) {
          showToast(error.message, 'danger');
        } else {
          showToast('Password updated successfully!');
          document.getElementById('profile-new-password').value = '';
          document.getElementById('profile-confirm-password').value = '';
        }
      } catch (err) {
        console.error('Password update error:', err);
        showToast('An error occurred during password update.', 'danger');
      } finally {
        updatePasswordBtn.disabled = false;
        updatePasswordBtn.textContent = 'Update Password';
      }
    });
  }
}

function setupDatabaseUtilityHandlers() {
  if (isDbUtilityListenersSetup) return;
  isDbUtilityListenersSetup = true;
  const backupBtn = document.getElementById('db-backup-btn');
  const restoreUpload = document.getElementById('db-restore-upload');

  const profile = getCurrentUserProfile();
  const isViewer = profile && profile.role === 'viewer';

  if (isViewer) {
    if (backupBtn) backupBtn.style.display = 'none';
    const restoreLabel = document.querySelector('label[for="db-restore-upload"]');
    if (restoreLabel) restoreLabel.style.display = 'none';
    return;
  }

  if (backupBtn) {
    backupBtn.addEventListener('click', async () => {
      const dataStr = await exportDB();
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

  if (restoreUpload) {
    restoreUpload.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const reader = new FileReader();
        
        reader.onload = async (event) => {
          showToast('Importing backup records...');
          const res = await importDB(event.target.result);
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

/* ==================== TEAM USER INVITATION SYSTEM ==================== */
async function loadTeamManagementUI() {
  const card = document.getElementById('settings-team-card');
  const tbody = document.getElementById('settings-team-tbody');
  const inviteForm = document.getElementById('team-invite-form');
  if (!card || !tbody) return;

  const profile = getCurrentUserProfile();
  if (!profile || (profile.role !== 'owner' && profile.role !== 'editor' && profile.role !== 'sysadmin')) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'flex';
  const sb = getSupabase();
  if (!sb) return;

  // Retrieve active company users and pending invitations via secure RPC functions to bypass RLS mapping issues
  const { data: members, error: mErr } = await sb.rpc('get_company_users', { co_id: profile.company_id });
  const { data: invites, error: iErr } = await sb.rpc('get_company_invitations', { co_id: profile.company_id });

  if (mErr) console.error('loadTeamManagementUI -> Error fetching members:', mErr);
  if (iErr) console.error('loadTeamManagementUI -> Error fetching invites:', iErr);

  let rowsHtml = '';

  if (members) {
    const activeMembers = members.filter(m => m.role !== 'sysadmin');
    rowsHtml += activeMembers.map(m => `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(m.email)}</td>
        <td><span class="badge badge-legacy" style="text-transform: uppercase;">${m.role}</span></td>
        <td><span class="badge badge-won">Active</span></td>
        <td style="text-align: right;">
          ${m.id === profile.id ? '<span style="font-size:0.75rem; color:var(--text-muted);">You</span>' : `
            <button type="button" class="btn btn-danger btn-icon-only remove-team-member-btn" data-id="${m.id}" title="Remove Team Member">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          `}
        </td>
      </tr>
    `).join('');
  }

  if (invites) {
    const activeInvites = invites.filter(i => i.role !== 'sysadmin');
    rowsHtml += activeInvites.map(i => `
      <tr>
        <td style="font-weight: 600; color: var(--text-secondary);">${escapeHtml(i.email)}</td>
        <td><span class="badge badge-legacy" style="text-transform: uppercase;">${i.role}</span></td>
        <td><span class="badge badge-pending">Invited</span></td>
        <td style="text-align: right;">
          <button type="button" class="btn btn-danger btn-icon-only cancel-invite-btn" data-email="${escapeHtml(i.email)}" title="Cancel Invitation">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </td>
      </tr>
    `).join('');
  }

  // Retrieve a fresh reference to tbody to avoid async DOM race conditions
  const freshTbody = document.getElementById('settings-team-tbody');
  if (!freshTbody || !freshTbody.parentNode) return;

  freshTbody.innerHTML = rowsHtml || `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No team members added.</td></tr>`;

  // Bind member/invite actions
  const newTbody = freshTbody.cloneNode(true);
  freshTbody.parentNode.replaceChild(newTbody, freshTbody);

  newTbody.addEventListener('click', async (e) => {
    const removeBtn = e.target.closest('.remove-team-member-btn');
    const cancelBtn = e.target.closest('.cancel-invite-btn');

    if (removeBtn) {
      const memberId = removeBtn.getAttribute('data-id');
      if (confirm('Are you sure you want to remove this member? they will lose access to company data.')) {
        showToast('Removing user...');
        const { error } = await sb.rpc('delete_user_by_id', { user_id: memberId });
        if (error) {
          showToast(error.message, 'danger');
        } else {
          showToast('User removed.');
          await loadTeamManagementUI();
        }
      }
    }

    if (cancelBtn) {
      const email = cancelBtn.getAttribute('data-email');
      if (confirm(`Cancel pending invitation to "${email}"?`)) {
        showToast('Canceling invite...');
        const { error } = await rawDbWrite(
          'company_invitations', 
          'DELETE', 
          null, 
          `company_id=eq.${profile.company_id}&email=eq.${encodeURIComponent(email)}`
        );
        if (error) {
          showToast(error.message, 'danger');
        } else {
          showToast('Invitation canceled.');
          await loadTeamManagementUI();
        }
      }
    }
  });

  const freshInviteForm = document.getElementById('team-invite-form');
  if (freshInviteForm && freshInviteForm.parentNode) {
    const newForm = freshInviteForm.cloneNode(true);
    freshInviteForm.parentNode.replaceChild(newForm, freshInviteForm);

    newForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('team-invite-email').value.trim();
      const role = document.getElementById('team-invite-role').value;

      if (!email) return;

      if (profile.role === 'sysadmin' && !profile.company_id) {
        showToast('Please select a company in the header before inviting team members.', 'warning');
        return;
      }

      showToast('Sending invitation...');
      const { error } = await rawDbWrite('company_invitations', 'POST', {
        company_id: profile.company_id,
        email,
        role,
        invited_by: profile.email
      });

      if (error) {
        showToast('Invitation failed: ' + error.message, 'danger');
      } else {
        showToast(`Invitation sent to ${email}`);
        document.getElementById('team-invite-email').value = '';
        await loadTeamManagementUI();
      }
    });
  }
}

/* ==================== TOTP MFA SECURITY MANAGEMENT ==================== */
async function loadMfaSettingsUI() {
  const card = document.getElementById('settings-mfa-card');
  const statusSpan = document.getElementById('settings-mfa-status')?.querySelector('span');
  const enrollBtn = document.getElementById('settings-mfa-enroll-btn');
  const disableBtn = document.getElementById('settings-mfa-disable-btn');
  
  if (!card) return;
  card.style.display = 'block';

  const sb = getSupabase();
  const { data: factors, error } = await sb.auth.mfa.listFactors();
  if (error || !factors) {
    console.error('Factors list error:', error);
    return;
  }

  const totpVerified = factors.totp ? factors.totp.find(f => f.status === 'verified') : null;
  
  if (totpVerified) {
    statusSpan.textContent = 'Enabled';
    statusSpan.style.color = 'var(--success)';
    enrollBtn.style.display = 'none';
    disableBtn.style.display = 'inline-flex';
    
    // Bind unenroll
    disableBtn.onclick = async () => {
      if (confirm('Are you sure you want to disable Multi-Factor Authenticator security?')) {
        showToast('Disabling MFA...');
        const { error: unerr } = await sb.auth.mfa.unenroll({ factorId: totpVerified.id });
        if (unerr) {
          showToast(unerr.message, 'danger');
        } else {
          showToast('Multi-factor security disabled.');
          await loadMfaSettingsUI();
        }
      }
    };
  } else {
    statusSpan.textContent = 'Disabled';
    statusSpan.style.color = 'var(--danger)';
    enrollBtn.style.display = 'inline-flex';
    disableBtn.style.display = 'none';

    enrollBtn.onclick = async () => {
      showToast('Generating security keys...');
      const { data, error: enrollErr } = await sb.auth.mfa.enroll({ factorType: 'totp', issuer: 'MyBidBook' });
      if (enrollErr) {
        showToast(enrollErr.message, 'danger');
        return;
      }

      // Display MFA Setup Modal with QR Code
      const setupModal = document.getElementById('mfa-setup-modal');
      const qrContainer = document.getElementById('mfa-qrcode-container');
      const secretKey = document.getElementById('mfa-secret-key');

      secretKey.textContent = data.totp.secret;
      
      // Load Google Chart QR Server SVG
      const totpUri = data.totp.uri;
      qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(totpUri)}" style="width:100%; height:100%; object-fit:contain;">`;
      
      setupModal.classList.add('active');

      const setupClose = document.getElementById('mfa-setup-close-btn');
      setupClose.onclick = () => setupModal.classList.remove('active');

      // Handle setup form submit code verification
      const setupForm = document.getElementById('mfa-setup-form');
      setupForm.onsubmit = async (evt) => {
        evt.preventDefault();
        const code = document.getElementById('mfa-setup-code-input').value.trim();
        if (code.length !== 6) return;

        showToast('Verifying code token...');
        const { data: challenge, error: chErr } = await sb.auth.mfa.challenge({ factorId: data.id });
        if (chErr) {
          showToast(chErr.message, 'danger');
          return;
        }

        const { error: verifyErr } = await sb.auth.mfa.verify({
          factorId: data.id,
          challengeId: challenge.id,
          code
        });

        if (verifyErr) {
          showToast('Verification failed. Check your authenticator app code.', 'danger');
        } else {
          showToast('Authenticator MFA enabled successfully!', 'success');
          setupModal.classList.remove('active');
          document.getElementById('mfa-setup-code-input').value = '';
          await loadMfaSettingsUI();
        }
      };
    };
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
