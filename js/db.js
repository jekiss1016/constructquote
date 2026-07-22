// Database management using Supabase Cloud & LocalStorage fallbacks
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { showToast } from './utils.js?v=3.0.45';
import { isOffline, updateOfflineCache, getOfflineQuotes, getOfflineCustomers, syncOfflinePhotoQueue, enqueueOfflinePhoto } from './offline-cache.js?v=3.0.45';

const KEYS = {
  SUPABASE_CONFIG: 'cq_supabase_config'
};


const DEFAULT_SETTINGS = {
  companyName: 'MyBidBook Pro Ltd.',
  companyAddress: '100 Contractor Plaza, Suite A, Seattle, WA 98101',
  companyPhone: '(206) 555-0199',
  companyEmail: 'billing@mybidbook.com',
  defaultTaxRate: 8.8,
  defaultMarkupPercent: 15,
  companyLogo: '',
  quoteEmailBodyDefault: '',
  schedulingConfig: { workdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], weekend_days: [0, 6], holidays: [], custom_workdays: [] }
};

let supabase = null;
let currentUserProfile = null; // Stores { id, company_id, role, email }

let cachedConfig = null;

export async function loadRuntimeConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    let configFile = 'config.json';
    const cb = '?v=' + new Date().getTime(); // cache buster
    
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      try {
        const devResponse = await fetch('config.dev.json' + cb);
        if (devResponse.ok) {
          configFile = 'config.dev.json';
        }
      } catch (e) {
        // Fall back to config.json
      }
    }
    const response = await fetch(configFile + cb);
    if (response.ok) {
      const config = await response.json();
      if (config.supabaseUrl && config.supabaseKey) {
        cachedConfig = { 
          url: config.supabaseUrl, 
          key: config.supabaseKey,
          lemonSqueezyStore: config.lemonSqueezyStore || 'mybidbook',
          lemonSqueezyMonthlyVariant: config.lemonSqueezyMonthlyVariant || '1909120',
          lemonSqueezyAnnualVariant: config.lemonSqueezyAnnualVariant || '1909159'
        };
        try {
          localStorage.setItem('cq_cached_runtime_config', JSON.stringify(cachedConfig));
        } catch (e) {}
        return cachedConfig;
      }
    }
  } catch (e) {
    // Ignore error if offline
  }

  // Fallback to cached runtime config for offline access
  try {
    const savedRuntime = localStorage.getItem('cq_cached_runtime_config');
    if (savedRuntime) {
      cachedConfig = JSON.parse(savedRuntime);
      return cachedConfig;
    }
  } catch (err) {}

  return null;
}

export function getSavedConfig() {
  try {
    const saved = localStorage.getItem(KEYS.SUPABASE_CONFIG);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    return null;
  }
}

export async function getSupabaseConfig() {
  const runtimeConfig = await loadRuntimeConfig();
  if (runtimeConfig) {
    return runtimeConfig;
  }
  return getSavedConfig();
}

export async function setSupabaseConfig(url, key) {
  localStorage.setItem(KEYS.SUPABASE_CONFIG, JSON.stringify({ url, key }));
  await initSupabaseClient();
}

export async function initSupabaseClient() {
  const config = await getSupabaseConfig();
  if (config && config.url && config.key) {
    supabase = createClient(config.url, config.key, {
      auth: {
        autoRefreshToken: false,
        persistSession: true,
        detectSessionInUrl: true
      }
    });
    return true;
  }
  supabase = null;
  return false;
}

export function getSupabase() {
  return supabase;
}

export function isSupabaseConnected() {
  return supabase !== null;
}

export async function getAccessToken() {
  const config = await getSupabaseConfig();
  if (!config || !config.url) return null;
  
  // Try checking cached token in localStorage first for speed
  try {
    const projectRef = config.url.split('//')[1].split('.')[0];
    const key = `sb-${projectRef}-auth-token`;
    const data = localStorage.getItem(key);
    if (data) {
      const parsed = JSON.parse(data);
      const access_token = parsed.access_token;
      const expires_at = parsed.expires_at; // unix timestamp in seconds
      
      // If token has at least 30 seconds of life remaining, return it
      if (access_token && expires_at && (expires_at * 1000 - 30000 > Date.now())) {
        return access_token;
      }
    }
  } catch (e) {
    console.error('Error reading access token from localStorage:', e);
  }

  // If expired or missing, try getting/refreshing via supabase auth client
  if (supabase) {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (data && data.session) {
        return data.session.access_token;
      }
    } catch (e) {
      console.error('Error fetching session from supabase auth:', e);
    }
    
    // If getting session failed (or session is null), token is fully expired
    console.warn('Session expired, forcing sign out.');
    await supabase.auth.signOut();
  }
  
  return null;
}

export async function rawDbQuery(table, params = '') {
  const config = await getSupabaseConfig();
  if (!config) return null;
  const token = await getAccessToken();
  if (!token) return null;
  
  const url = `${config.url}/rest/v1/${table}?${params}`;
  try {
    const res = await fetch(url, {
      headers: {
        'apikey': config.key,
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    if (res.ok) {
      return await res.json();
    } else {
      const errText = await res.text();
      console.error(`rawDbQuery failed for ${url}: status=${res.status}, body=${errText}`);
      if (res.status === 401 && supabase) {
        console.warn('API returned 401 Unauthorized, signing out.');
        await supabase.auth.signOut();
      }
    }
  } catch (err) {
    console.error(`rawDbQuery error for table ${table}:`, err);
  }
  return null;
}

export async function rawDbWrite(table, method, body, params = '') {
  const config = await getSupabaseConfig();
  if (!config) return { data: null, error: { message: 'Supabase configuration missing' } };
  const token = await getAccessToken();
  if (!token) return { data: null, error: { message: 'Authentication session not found' } };

  let url = `${config.url}/rest/v1/${table}`;
  if (params) {
    url += `?${params}`;
  }
  
  const headers = {
    'apikey': config.key,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  
  if (method === 'POST' || method === 'PATCH') {
    headers['Prefer'] = 'return=representation';
  }

  try {
    const res = await fetch(url, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    });
    
    if (res.status === 204) {
      return { data: null, error: null };
    }
    
    const data = await res.json();
    if (res.ok) {
      return { data, error: null };
    } else {
      console.error(`rawDbWrite failed for table ${table}:`, data);
      if (res.status === 401 && supabase) {
        console.warn('API returned 401 Unauthorized, signing out.');
        await supabase.auth.signOut();
      }
      return { data: null, error: { message: data.message || data.details || `HTTP error ${res.status}` } };
    }
  } catch (err) {
    console.error(`rawDbWrite error for table ${table}:`, err);
    return { data: null, error: err };
  }
}


export function getCurrentUserProfile() {
  return currentUserProfile;
}

export function setCurrentUserProfile(profile) {
  currentUserProfile = profile;
}

// Loads session and corresponding company profile
export async function loadUserSession(passedSession = null) {
  // Ensure the Supabase client is ready before any request
  if (!supabase) {
    const ok = await initSupabaseClient();
    if (!ok) {
      console.error('Supabase client not configured');
      return null;
    }
  }
  const sb = getSupabase();
  if (!sb) return null;

  // Retrieve the current session (use passedSession if provided, to bypass any getSession stalls)
  let session = passedSession;
  if (!session) {
    const { data: { session: currentSession }, error: sessErr } = await sb.auth.getSession();
    if (!sessErr && currentSession) {
      session = currentSession;
    }
  }

  let user = session ? session.user : null;
  if (!user) {
    // Fallback to getUser (older SDK versions)
    const { data: { user: fallbackUser }, error: userErr } = await sb.auth.getUser();
    if (!userErr && fallbackUser) {
      user = fallbackUser;
    }
  }

  if (!user) {
    currentUserProfile = null;
    return null;
  }

  console.log('loadUserSession -> Initiating raw fetch to profiles endpoint for user ID:', user.id);
  const config = await getSupabaseConfig();
  const url = `${config.url}/rest/v1/profiles?id=eq.${user.id}&select=*,companies(subscription_level,subscription_status,is_active)`;
  
  let profile = null;
  let pError = null;
  try {
    const res = await fetch(url, {
      headers: {
        'apikey': config.key,
        'Authorization': `Bearer ${session.access_token}`,
        'Accept': 'application/vnd.pgrst.object+json' // behaves like maybeSingle()
      }
    });
    console.log('loadUserSession -> Raw fetch response status:', res.status);
    if (res.status === 200) {
      profile = await res.json();
    } else if (res.status === 406 || res.status === 404) {
      profile = null;
    } else {
      pError = { message: `HTTP error ${res.status}: ${await res.text()}` };
    }
  } catch (err) {
    console.error('loadUserSession -> Raw fetch catch block error:', err);
    pError = err;
  }
  
  console.log('loadUserSession -> Fetched profile:', profile, 'Error:', pError);

  if (pError) {
    console.error('Error fetching user profile:', pError);
    try {
      const cachedProfile = localStorage.getItem('cq_cached_user_profile');
      if (cachedProfile) {
        currentUserProfile = JSON.parse(cachedProfile);
        return currentUserProfile;
      }
    } catch (e) {}
  }

  if (profile) {
    currentUserProfile = profile;
    try {
      localStorage.setItem('cq_cached_user_profile', JSON.stringify(profile));
    } catch (e) {}
    return profile;
  }

  // Profile not found. Attempt to provision the environment server-side (bypass RLS insert limits)
  console.log('Profile missing. Attempting server-side provisioning...');
  try {
    const { data: rpcData, error: rpcError } = await sb.rpc('create_profile_if_missing');
    if (rpcError) throw rpcError;

    if (rpcData && rpcData.success && rpcData.profile) {
      console.log('Profile successfully provisioned server-side:', rpcData.profile);
      currentUserProfile = rpcData.profile;
      return rpcData.profile;
    } else {
      throw new Error(rpcData ? rpcData.error : 'Unknown RPC error');
    }
  } catch (e) {
    console.error('Failed server-side profile provisioning, using fallback:', e);
    // Fallback to an in-memory profile so the UI can continue operating
    const fallback = {
      id: user.id,
      email: user.email,
      role: 'owner',
      company_id: crypto.randomUUID ? crypto.randomUUID() : 'temp-' + Math.random().toString(36).substr(2, 9)
    };
    currentUserProfile = fallback;
    return fallback;
  }
}


/* ==================== CATEGORIES CRUD ==================== */
export async function getCategories() {
  console.log('getCategories -> Starting...');
  // Ensure Supabase is ready – this guard also works if the user is not logged in
  if (!supabase) await initSupabaseClient();
  const sb = getSupabase();
  if (!sb || !currentUserProfile || !currentUserProfile.company_id) return [];

  console.log('getCategories -> Querying categories table via rawDbQuery...');
  const data = await rawDbQuery('categories', `company_id=eq.${currentUserProfile.company_id}&order=name.asc`);
  console.log('getCategories -> Categories fetched. Data length:', data ? data.length : 0);
  if (!data) return [];

  return data.map(c => c.name);
}

export async function saveCategory(categoryName) {
  if (!currentUserProfile) return { success: false, error: 'Not authenticated' };
  const trimmed = categoryName.trim();
  if (!trimmed) return { success: false, error: 'Category name cannot be empty.' };
  
  const { error } = await rawDbWrite('categories', 'POST', {
    company_id: currentUserProfile.company_id,
    name: trimmed
  });
    
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function deleteCategory(categoryName) {
  if (!currentUserProfile) return { success: false, error: 'Not authenticated' };
  
  const { error } = await rawDbWrite(
    'categories', 
    'DELETE', 
    null, 
    `company_id=eq.${currentUserProfile.company_id}&name=eq.${encodeURIComponent(categoryName)}`
  );
    
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function renameCategory(oldName, newName) {
  if (!currentUserProfile) return { success: false, error: 'Not authenticated' };
  
  const oldTrimmed = oldName.trim();
  const newTrimmed = newName.trim();
  if (!oldTrimmed || !newTrimmed) {
    return { success: false, error: 'Category names cannot be empty.' };
  }
  
  // 1. Update the categories table name first
  const { error: catErr } = await rawDbWrite(
    'categories',
    'PATCH',
    { name: newTrimmed },
    `company_id=eq.${currentUserProfile.company_id}&name=eq.${encodeURIComponent(oldTrimmed)}`
  );
  if (catErr) return { success: false, error: catErr.message };

  // 2. Query and update all products referencing this category to match the new name
  try {
    const productsToUpdate = await rawDbQuery(
      'products',
      `company_id=eq.${currentUserProfile.company_id}&category=eq.${encodeURIComponent(oldTrimmed)}`
    );
    if (productsToUpdate && productsToUpdate.length > 0) {
      for (const prod of productsToUpdate) {
        await rawDbWrite(
          'products',
          'PATCH',
          { category: newTrimmed },
          `id=eq.${prod.id}&company_id=eq.${currentUserProfile.company_id}`
        );
      }
    }
  } catch (prodErr) {
    console.error('Error updating products category references:', prodErr);
  }
  
  return { success: true };
}

/* ==================== CUSTOMERS CRUD ==================== */
export async function getCustomers() {
  console.log('getCustomers -> Starting...');
  if (isOffline()) {
    console.log('getCustomers -> Offline mode active. Returning cached customers.');
    return getOfflineCustomers();
  }
  const sb = getSupabase();
  if (!sb || !currentUserProfile || !currentUserProfile.company_id) {
    return getOfflineCustomers();
  }
  
  console.log('getCustomers -> Querying customers table via rawDbQuery...');
  const data = await rawDbQuery('customers', `company_id=eq.${currentUserProfile.company_id}&order=name.asc`);
  console.log('getCustomers -> Customers fetched. Data length:', data ? data.length : 0);
  if (!data) return getOfflineCustomers();
  const customers = data.map(c => {
    let combinedAddress = c.address1 || '';
    if (c.address2) {
      combinedAddress += '\n' + c.address2;
    }
    if (c.city || c.state || c.zip) {
      combinedAddress += '\n' + (c.city || '') + ', ' + (c.state || '') + ' ' + (c.zip || '');
    }
    
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      address1: c.address1 || '',
      address2: c.address2 || '',
      city: c.city || '',
      state: c.state || '',
      zip: c.zip || '',
      address: combinedAddress.trim(),
      status: c.status || 'Active',
      contacts: c.contacts || [],
      documents: c.documents || [],
      defaultTermsNotes: c.default_terms_notes || '',
      defaultMarkupPercent: parseFloat(c.default_markup_percent) || 0,
      defaultTaxRate: parseFloat(c.default_tax_rate) || 0,
      defaultTaxPlusApplicable: c.default_tax_plus_applicable || false,
      quoteEmailBodyDefault: c.quote_email_body_default || ''
    };
  });

  // Update offline cache with fresh customers
  const currentCachedQuotes = getOfflineQuotes();
  updateOfflineCache(currentCachedQuotes, customers);

  return customers;
}

export async function getCustomerById(id) {
  const customers = await getCustomers();
  return customers.find(c => c.id === id);
}

export async function saveCustomer(customer) {
  if (!currentUserProfile) return { success: false, error: 'Not authenticated' };
  
  const mapped = {
    company_id: currentUserProfile.company_id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    address1: customer.address1 || '',
    address2: customer.address2 || '',
    city: customer.city || '',
    state: customer.state || '',
    zip: customer.zip || '',
    status: customer.status || 'Active',
    contacts: customer.contacts || [],
    documents: customer.documents || [],
    default_terms_notes: customer.defaultTermsNotes || '',
    default_markup_percent: parseFloat(customer.defaultMarkupPercent) || 0,
    default_tax_rate: parseFloat(customer.defaultTaxRate) || 0,
    default_tax_plus_applicable: customer.defaultTaxPlusApplicable || false,
    quote_email_body_default: customer.quoteEmailBodyDefault || ''
  };
  
  if (customer.id) {
    const { data, error } = await rawDbWrite(
      'customers', 
      'PATCH', 
      mapped, 
      `id=eq.${customer.id}&company_id=eq.${currentUserProfile.company_id}`
    );
    if (error) return { success: false, error: error.message };
    const returnedObj = data && data.length > 0 ? data[0] : customer;
    return { success: true, customer: returnedObj };
  } else {
    const { data, error } = await rawDbWrite('customers', 'POST', mapped);
    if (error) return { success: false, error: error.message };
    const returnedObj = data && data.length > 0 ? data[0] : null;
    return { success: true, customer: returnedObj };
  }
}

export async function isCustomerLinked(customerId) {
  if (!currentUserProfile) return false;
  const data = await rawDbQuery('quotes', `company_id=eq.${currentUserProfile.company_id}&customer_id=eq.${customerId}&limit=1`);
  return data && data.length > 0;
}

export async function deleteCustomer(id) {
  if (!currentUserProfile) return { success: false, error: 'Not authenticated' };
  
  if (await isCustomerLinked(id)) {
    return { success: false, error: 'This customer has historical quotes linked and cannot be deleted. Please set their status to Inactive instead.' };
  }
  
  const { error } = await rawDbWrite(
    'customers', 
    'DELETE', 
    null, 
    `id=eq.${id}&company_id=eq.${currentUserProfile.company_id}`
  );
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/* ==================== PRODUCTS CRUD ==================== */
export async function getProducts() {
  console.log('getProducts -> Starting...');
  if (isOffline()) return [];
  const sb = getSupabase();
  if (!sb || !currentUserProfile || !currentUserProfile.company_id) return [];
  
  console.log('getProducts -> Querying products table via rawDbQuery...');
  const data = await rawDbQuery('products', `company_id=eq.${currentUserProfile.company_id}&order=name.asc`);
  console.log('getProducts -> Products fetched. Data length:', data ? data.length : 0);
  if (!data) return [];
  return data.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    uom: p.uom,
    price: parseFloat(p.price) || 0,
    laborRate: parseFloat(p.labor_rate) || 0,
    status: p.status || 'Active',
    description: p.description
  }));
}

export async function getProductById(id) {
  const products = await getProducts();
  return products.find(p => p.id === id);
}

export async function saveProduct(product) {
  console.log('db: saveProduct starting (native)...', product);
  if (!currentUserProfile) {
    console.error('db: saveProduct -> Authentication failure. profile:', currentUserProfile);
    return { success: false, error: 'Not authenticated' };
  }
  
  const mapped = {
    company_id: currentUserProfile.company_id,
    name: product.name,
    category: product.category,
    uom: product.uom,
    price: product.price,
    labor_rate: product.laborRate || 0,
    status: product.status || 'Active',
    description: product.description
  };
  console.log('db: saveProduct -> Mapped database payload:', mapped);
  
  if (product.id) {
    console.log('db: saveProduct -> Performing UPDATE on products for ID:', product.id);
    const { data, error } = await rawDbWrite(
      'products', 
      'PATCH', 
      mapped, 
      `id=eq.${product.id}&company_id=eq.${currentUserProfile.company_id}`
    );
    if (error) {
      console.error('db: saveProduct UPDATE error:', error);
      return { success: false, error: error.message };
    }
    console.log('db: saveProduct UPDATE success');
    const returnedObj = data && data.length > 0 ? data[0] : product;
    return { success: true, product: returnedObj };
  } else {
    console.log('db: saveProduct -> Performing INSERT on products');
    const { data, error } = await rawDbWrite('products', 'POST', mapped);
    if (error) {
      console.error('db: saveProduct INSERT error:', error);
      return { success: false, error: error.message };
    }
    console.log('db: saveProduct INSERT success. Data:', data);
    const returnedObj = data && data.length > 0 ? data[0] : null;
    return { success: true, product: returnedObj };
  }
}

export async function isProductUsed(productId) {
  if (!currentUserProfile) return false;
  const data = await rawDbQuery('quotes', `company_id=eq.${currentUserProfile.company_id}&sections=cs.[{"items": [{"productId": "${productId}"}]}]&limit=1`);
  return data && data.length > 0;
}

export async function deleteProduct(id) {
  if (!currentUserProfile) return { success: false, error: 'Not authenticated' };
  
  if (await isProductUsed(id)) {
    const product = await getProductById(id);
    if (product) {
      product.status = 'Inactive';
      await saveProduct(product);
      return { success: false, error: 'This catalog product is used on historical quotes and cannot be physically deleted. It has been automatically set to Inactive to prevent future use.' };
    }
  }
  
  const { error } = await rawDbWrite(
    'products', 
    'DELETE', 
    null, 
    `id=eq.${id}&company_id=eq.${currentUserProfile.company_id}`
  );
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/* ==================== QUOTES CRUD ==================== */
export async function getQuotes() {
  console.log('getQuotes -> Starting...');
  if (isOffline()) {
    console.log('getQuotes -> Offline mode active. Returning cached quotes.');
    return getOfflineQuotes();
  }
  const sb = getSupabase();
  if (!sb || !currentUserProfile || !currentUserProfile.company_id) {
    return getOfflineQuotes();
  }
  
  console.log('getQuotes -> Querying quotes table via rawDbQuery...');
  const data = await rawDbQuery('quotes', `company_id=eq.${currentUserProfile.company_id}&order=date.desc`);
  console.log('getQuotes -> Quotes fetched. Data length:', data ? data.length : 0);
  if (!data) return getOfflineQuotes();
  const quotes = data.map(q => ({
    id: q.id,
    jobId: q.job_id,
    quoteNumber: String(q.quote_number),
    customerId: q.customer_id,
    customerName: q.customer_name,
    projectAddress: q.project_address,
    customerPhone: q.customer_phone,
    customerEmail: q.customer_email,
    date: q.date,
    expirationDate: q.expiration_date,
    markupPercent: parseFloat(q.markup_percent) || 0,
    taxRate: parseFloat(q.tax_rate) || 0,
    notes: q.notes,
    status: q.status || 'Pending',
    version: q.version || 1,
    parentQuoteId: q.parent_quote_id,
    isLegacy: q.is_legacy === true,
    createdDateTime: q.created_date_time,
    dateWonLost: q.date_won_lost,
    dateCompleted: q.date_completed,
    companyLogo: q.company_logo || '',
    printShowDetails: q.print_show_details !== false,
    printShowDetailPricing: q.print_show_detail_pricing !== false,
    printShowQuantities: q.print_show_quantities !== false,
    sections: q.sections || [],
    photos: q.photos || [],
    documents: q.documents || [],
    receipts: q.receipts || [],
    taxPlusApplicable: q.tax_plus_applicable === true,
    scheduleTasks: q.schedule_tasks || [],
    scheduleSettings: q.schedule_settings || {}
  }));

  // Update offline cache with fresh quotes
  const currentCachedCustomers = getOfflineCustomers();
  updateOfflineCache(quotes, currentCachedCustomers);

  return quotes;
}

export async function getQuoteById(id) {
  const quotes = await getQuotes();
  return quotes.find(q => q.id === id) || null;
}

export async function checkJobIdUnique(jobId, ignoreQuoteId = null) {
  if (!currentUserProfile) return true;
  let params = `company_id=eq.${currentUserProfile.company_id}&job_id=ilike.${encodeURIComponent(jobId.trim())}&is_legacy=eq.false`;
  if (ignoreQuoteId) {
    params += `&id=neq.${ignoreQuoteId}`;
  }
  const data = await rawDbQuery('quotes', params);
  return !data || data.length === 0;
}

export async function saveQuote(quote) {
  if (!currentUserProfile) return { success: false, error: 'Not authenticated' };

  // Viewer role bypass for photos and receipts
  if (currentUserProfile.role === 'viewer') {
    if (!quote.id) {
      return { success: false, error: 'Viewer accounts are not allowed to create new quotes.' };
    }
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Database client not initialized.' };

    const { error } = await sb.rpc('update_quote_gallery_and_receipts', {
      q_id: quote.id,
      new_photos: quote.photos || [],
      new_receipts: quote.receipts || []
    });

    if (error) {
      console.error('Viewer quote save RPC error:', error);
      return { success: false, error: error.message };
    }
    return { success: true };
  }
  
  // Enforce Trial account limits (max 10 quotes)
  if (!quote.id && getSubscriptionLevel() === 'trial') {
    const existingQuotes = await getQuotes();
    if (existingQuotes && existingQuotes.length >= 10) {
      return {
        success: false,
        error: 'Trial limit reached: You can have a maximum of 10 quotes on the Contractor Trial plan. Please upgrade to Contractor Pro to create more.'
      };
    }
  }
  
  const todayStr = new Date().toISOString().split('T')[0];
  const payload = {
    company_id: currentUserProfile.company_id,
    job_id: quote.jobId,
    customer_id: quote.customerId,
    customer_name: quote.customerName,
    project_address: quote.projectAddress,
    customer_phone: quote.customerPhone,
    customer_email: quote.customerEmail,
    date: quote.date || todayStr,
    expiration_date: quote.expirationDate,
    markup_percent: quote.markupPercent,
    tax_rate: quote.taxRate,
    notes: quote.notes,
    status: quote.status || 'Pending',
    version: quote.version || 1,
    parent_quote_id: quote.parentQuoteId,
    is_legacy: quote.isLegacy === true,
    date_won_lost: quote.dateWonLost,
    date_completed: quote.dateCompleted,
    company_logo: quote.companyLogo || '',
    print_show_details: quote.printShowDetails !== false,
    print_show_detail_pricing: quote.printShowDetailPricing !== false,
    print_show_quantities: quote.printShowQuantities !== false,
    tax_plus_applicable: quote.taxPlusApplicable === true,
    sections: quote.sections || [],
    photos: quote.photos || [],
    documents: quote.documents || [],
    receipts: quote.receipts || [],
    schedule_tasks: quote.scheduleTasks || [],
    schedule_settings: quote.scheduleSettings || {}
  };
  
  if (!(await checkJobIdUnique(payload.job_id, quote.id))) {
    return { success: false, error: `Job ID "${payload.job_id}" is already assigned to another active quote. Job IDs must be unique.` };
  }
  
  if (payload.status === 'Won' || payload.status === 'Lost' || payload.status === 'Inactive') {
    if (!quote.dateWonLost) payload.date_won_lost = new Date().toISOString();
  } else if (payload.status === 'Completed') {
    if (!quote.dateCompleted) payload.date_completed = new Date().toISOString();
    if (!quote.dateWonLost) payload.date_won_lost = new Date().toISOString();
  } else if (payload.status === 'Pending') {
    payload.date_won_lost = null;
    payload.date_completed = null;
  }
  
  if (quote.id) {
    const existing = await getQuoteById(quote.id);
    if (existing) {
      const contentChanged = 
        JSON.stringify(existing.notes) !== JSON.stringify(payload.notes) ||
        JSON.stringify(existing.sections) !== JSON.stringify(payload.sections) ||
        existing.customerName !== payload.customer_name ||
        existing.projectAddress !== payload.project_address ||
        existing.customerPhone !== payload.customer_phone ||
        existing.customerEmail !== payload.customer_email ||
        existing.markupPercent !== payload.markup_percent ||
        existing.taxRate !== payload.tax_rate ||
        existing.expirationDate !== payload.expiration_date ||
        ((existing.status === 'Won' || existing.status === 'Lost') && payload.status === 'Pending');
        
      if ((contentChanged || quote._forceNewVersion) && !existing.isLegacy) {
        const legacyCopy = { ...existing };
        legacyCopy.isLegacy = true;
        legacyCopy.status = 'Legacy';
        legacyCopy.parentQuoteId = existing.parentQuoteId || existing.id;
        
        const { error: legError } = await rawDbWrite('quotes', 'POST', {
          company_id: currentUserProfile.company_id,
          job_id: legacyCopy.jobId,
          quote_number: parseInt(legacyCopy.quoteNumber),
          customer_id: legacyCopy.customerId,
          customer_name: legacyCopy.customerName,
          project_address: legacyCopy.projectAddress,
          customer_phone: legacyCopy.customerPhone,
          customer_email: legacyCopy.customerEmail,
          date: legacyCopy.date,
          expiration_date: legacyCopy.expirationDate,
          markup_percent: legacyCopy.markupPercent,
          tax_rate: legacyCopy.taxRate,
          notes: legacyCopy.notes,
          status: 'Legacy',
          version: legacyCopy.version,
          parent_quote_id: legacyCopy.parentQuoteId,
          is_legacy: true,
          date_won_lost: legacyCopy.dateWonLost,
          date_completed: legacyCopy.dateCompleted,
          sections: legacyCopy.sections,
          photos: legacyCopy.photos,
          documents: legacyCopy.documents,
          receipts: legacyCopy.receipts,
          schedule_tasks: legacyCopy.scheduleTasks,
          created_date_time: legacyCopy.createdDateTime
        });
        if (legError) return { success: false, error: 'Legacy archive failed: ' + legError.message };
        
        payload.version = (existing.version || 1) + 1;
        payload.parent_quote_id = existing.parentQuoteId || existing.id;
        payload.created_date_time = new Date().toISOString();
      }
    }
    
    const { data, error } = await rawDbWrite(
      'quotes', 
      'PATCH', 
      payload, 
      `id=eq.${quote.id}&company_id=eq.${currentUserProfile.company_id}`
    );
    if (error) return { success: false, error: error.message };
    const returnedObj = data && data.length > 0 ? data[0] : quote;
    return { success: true, quote: returnedObj };
  } else {
    const maxQ = await rawDbQuery('quotes', `company_id=eq.${currentUserProfile.company_id}&order=quote_number.desc&limit=1`);
    const nextNum = maxQ && maxQ.length > 0 ? (parseInt(maxQ[0].quote_number) || 1000) + 1 : 1001;
    payload.quote_number = nextNum;
    
    const { data, error } = await rawDbWrite('quotes', 'POST', payload);
    if (error) return { success: false, error: error.message };
    const returnedObj = data && data.length > 0 ? data[0] : null;
    return { success: true, quote: returnedObj };
  }
}

export async function saveQuotesRaw(quotesList) {
  if (!currentUserProfile) return;
  const mappedList = quotesList.map(q => ({
    id: q.id,
    company_id: currentUserProfile.company_id,
    job_id: q.jobId,
    customer_id: q.customerId,
    customer_name: q.customerName,
    project_address: q.projectAddress,
    customer_phone: q.customerPhone,
    customer_email: q.customerEmail,
    date: q.date,
    expiration_date: q.expirationDate,
    markup_percent: q.markupPercent,
    tax_rate: q.taxRate,
    notes: q.notes,
    status: q.status,
    version: q.version,
    parent_quote_id: q.parentQuoteId,
    is_legacy: q.isLegacy === true,
    date_won_lost: q.dateWonLost,
    date_completed: q.dateCompleted,
    company_logo: q.companyLogo || '',
    print_show_details: q.printShowDetails !== false,
    print_show_detail_pricing: q.printShowDetailPricing !== false,
    print_show_quantities: q.printShowQuantities !== false,
    tax_plus_applicable: q.taxPlusApplicable === true,
    sections: q.sections || [],
    photos: q.photos,
    documents: q.documents,
    receipts: q.receipts,
    schedule_tasks: q.scheduleTasks || [],
    schedule_settings: q.scheduleSettings || {}
  }));
  const config = await getSupabaseConfig();
  if (!config) return;
  const token = await getAccessToken();
  if (!token) return;
  
  await fetch(`${config.url}/rest/v1/quotes`, {
    method: 'POST',
    headers: {
      'apikey': config.key,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(mappedList)
  });
}

export async function updateQuoteSchedule(quoteId, tasksArray) {
  if (!currentUserProfile) return { success: false, error: 'Not authenticated' };
  const res = await rawDbWrite('quotes', 'PATCH', { schedule_tasks: tasksArray }, `id=eq.${quoteId}`);
  if (res.error) return { success: false, error: res.error.message };
  return { success: true };
}

export async function updateQuoteScheduleSettings(quoteId, settingsObj) {
  if (!currentUserProfile) return { success: false, error: 'Not authenticated' };
  const res = await rawDbWrite('quotes', 'PATCH', { schedule_settings: settingsObj }, `id=eq.${quoteId}`);
  if (res.error) return { success: false, error: res.error.message };
  return { success: true };
}

export async function deleteQuote(quoteId) {
  return { success: false, error: 'Quotes cannot be deleted. You can mark them as Lost or Inactive to archive them instead.' };
}

/* ==================== SETTINGS CRUD ==================== */
export async function getSettings() {
  console.log('getSettings -> Starting...');
  const sb = getSupabase();
  if (!sb || !currentUserProfile || !currentUserProfile.company_id) return DEFAULT_SETTINGS;
  
  console.log('getSettings -> Querying settings table via rawDbQuery...');
  const data = await rawDbQuery('settings', `company_id=eq.${currentUserProfile.company_id}`);
  console.log('getSettings -> Settings fetched. Data length:', data ? data.length : 0);
  if (!data || data.length === 0) {
    return DEFAULT_SETTINGS;
  }
  const row = data[0];
  
  return {
    companyName: row.company_name,
    companyAddress: row.company_address,
    companyPhone: row.company_phone,
    companyEmail: row.company_email,
    defaultTaxRate: parseFloat(row.default_tax_rate) || 0,
    defaultMarkupPercent: parseFloat(row.default_markup_percent) || 0,
    companyLogo: row.company_logo,
    theme: row.theme || 'light',
    defaultTermsNotes: row.default_terms_notes || '',
    defaultTaxPlusApplicable: row.default_tax_plus_applicable || false,
    quoteEmailBodyDefault: row.quote_email_body_default || '',
    schedulingConfig: row.scheduling_config || DEFAULT_SETTINGS.schedulingConfig
  };
}

export async function saveSettings(settingsObj) {
  if (!currentUserProfile) return { success: false, error: 'Not authenticated' };
  
  const mapped = {};
  if (settingsObj.companyName !== undefined) mapped.company_name = settingsObj.companyName;
  if (settingsObj.companyAddress !== undefined) mapped.company_address = settingsObj.companyAddress;
  if (settingsObj.companyPhone !== undefined) mapped.company_phone = settingsObj.companyPhone;
  if (settingsObj.companyEmail !== undefined) mapped.company_email = settingsObj.companyEmail;
  if (settingsObj.defaultTaxRate !== undefined) mapped.default_tax_rate = settingsObj.defaultTaxRate;
  if (settingsObj.defaultMarkupPercent !== undefined) mapped.default_markup_percent = settingsObj.defaultMarkupPercent;
  if (settingsObj.companyLogo !== undefined) mapped.company_logo = settingsObj.companyLogo;
  if (settingsObj.theme !== undefined) mapped.theme = settingsObj.theme;
  if (settingsObj.defaultTermsNotes !== undefined) mapped.default_terms_notes = settingsObj.defaultTermsNotes;
  if (settingsObj.defaultTaxPlusApplicable !== undefined) mapped.default_tax_plus_applicable = settingsObj.defaultTaxPlusApplicable;
  if (settingsObj.quoteEmailBodyDefault !== undefined) mapped.quote_email_body_default = settingsObj.quoteEmailBodyDefault;
  
  mapped.company_id = currentUserProfile.company_id;
  
  const config = await getSupabaseConfig();
  if (!config) return { success: false, error: 'Supabase configuration missing.' };
  const token = await getAccessToken();
  if (!token) return { success: false, error: 'Authentication session not found.' };

  try {
    const res = await fetch(`${config.url}/rest/v1/settings`, {
      method: 'POST',
      headers: {
        'apikey': config.key,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(mapped)
    });
    
    if (res.ok) {
      return { success: true };
    } else {
      const data = await res.json();
      return { success: false, error: data.message || `HTTP error ${res.status}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function sendSupportEmail(userEmail, subject, message) {
  const config = await getSupabaseConfig();
  if (!config) return { success: false, error: 'Supabase configuration missing.' };
  const token = await getAccessToken();
  if (!token) return { success: false, error: 'Authentication session not found.' };

  try {
    const res = await fetch(`${config.url}/rest/v1/rpc/send_support_email`, {
      method: 'POST',
      headers: {
        'apikey': config.key,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user_email: userEmail,
        subject: subject,
        msg: message
      })
    });

    if (res.ok) {
      const data = await res.json();
      return data;
    } else {
      const data = await res.json();
      return { success: false, error: data.message || `HTTP error ${res.status}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/* ==================== DATABASE BACKUP & RESTORE ==================== */
export async function exportDB() {
  const db = {
    categories: await getCategories(),
    products: await getProducts(),
    customers: await getCustomers(),
    quotes: await getQuotes(),
    settings: await getSettings()
  };
  return JSON.stringify(db, null, 2);
}

export async function importDB(jsonStr) {
  const sb = getSupabase();
  if (!sb || !currentUserProfile) return { success: false, error: 'Not authenticated' };
  try {
    const db = JSON.parse(jsonStr);
    if (!db.categories || !db.products || !db.quotes || !db.settings) {
      return { success: false, error: 'Invalid backup file structure.' };
    }
    
    // Import categories
    for (const cat of db.categories) {
      await saveCategory(cat);
    }
    // Import products
    for (const prod of db.products) {
      await saveProduct(prod);
    }
    // Import customers
    if (db.customers) {
      for (const cust of db.customers) {
        await saveCustomer(cust);
      }
    }
    // Import quotes
    for (const q of db.quotes) {
      await saveQuote(q);
    }
    // Import settings
    await saveSettings(db.settings);
    
    return { success: true };
  } catch (err) {
    return { success: false, error: 'Failed to parse JSON backup file.' };
  }
}



/* ==================== SYSADMIN MULTI-TENANT HELPERS ==================== */
export async function getAllCompanies() {
  console.log('getAllCompanies -> Starting raw fetch...');
  const data = await rawDbQuery('companies', 'select=id,name,is_active,settings(company_name)&order=id.asc');
  console.log('getAllCompanies -> Companies fetched. Data length:', data ? data.length : 0);
  if (!data) return [];
  return data
    .filter(s => s.is_active !== false) // hide deactivated
    .map(s => {
      let displayName = s.name || 'Unnamed Company';
      if (s.settings) {
        if (Array.isArray(s.settings) && s.settings.length > 0 && s.settings[0].company_name) {
          displayName = s.settings[0].company_name;
        } else if (!Array.isArray(s.settings) && s.settings.company_name) {
          displayName = s.settings.company_name;
        }
      }
      return {
        id: s.id,
        name: displayName
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function switchUserCompany(companyId) {
  console.log('switchUserCompany -> Entering with companyId:', companyId);
  const config = await getSupabaseConfig();
  if (!config) {
    console.error('switchUserCompany -> Supabase config is missing.');
    return false;
  }
  if (!currentUserProfile) {
    console.error('switchUserCompany -> currentUserProfile is null/missing.');
    return false;
  }
  console.log('switchUserCompany -> Current User Profile ID:', currentUserProfile.id);
  const token = await getAccessToken();
  if (!token) {
    console.error('switchUserCompany -> Access token is missing.');
    return false;
  }
  
  console.log('switchUserCompany -> Triggering raw PATCH update for profiles table. Company ID:', companyId, 'User ID:', currentUserProfile.id);
  const url = `${config.url}/rest/v1/profiles?id=eq.${currentUserProfile.id}`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': config.key,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ company_id: companyId })
    });
    
    console.log('switchUserCompany -> profiles table update finished. Status:', res.status);
    if (res.status === 200 || res.status === 204) {
      currentUserProfile.company_id = companyId;
      return true;
    }
  } catch (err) {
    console.error('Error switching company (raw):', err);
  }
  return false;
}

/* ==================== NATIVE FILE UPLOADER ==================== */
export async function uploadFileToStorage(bucket, filePath, file) {
  console.log('db: uploadFileToStorage starting...', { bucket, filePath, fileName: file.name, fileSize: file.size });
  const config = await getSupabaseConfig();
  if (!config) {
    console.error('db: uploadFileToStorage -> Config missing');
    return { data: null, error: { message: 'Supabase configuration missing.' } };
  }
  const token = await getAccessToken();
  if (!token) {
    console.error('db: uploadFileToStorage -> Access token missing');
    return { data: null, error: { message: 'Authentication session not found.' } };
  }

  const url = `${config.url}/storage/v1/object/${bucket}/${filePath}`;
  console.log('db: uploadFileToStorage -> Fetching REST URL:', url);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': config.key,
        'Authorization': `Bearer ${token}`,
        'Content-Type': file.type || 'application/octet-stream'
      },
      body: file
    });
    
    console.log('db: uploadFileToStorage -> Response status:', res.status);
    const data = await res.json();
    console.log('db: uploadFileToStorage -> Response payload:', data);
    
    if (res.ok) {
      return { data, error: null };
    } else {
      return { data: null, error: { message: data.message || `HTTP error ${res.status}` } };
    }
  } catch (err) {
    console.error('db: uploadFileToStorage -> Catch error:', err);
    return { data: null, error: { message: err.message } };
  }
}

export function getSubscriptionLevel() {
  if (currentUserProfile && currentUserProfile.companies) {
    return currentUserProfile.companies.subscription_level || 'trial';
  }
  return 'trial';
}

export function getSubscriptionStatus() {
  if (currentUserProfile && currentUserProfile.companies) {
    return currentUserProfile.companies.subscription_status || 'active';
  }
  return 'active';
}

/* ==================== QUOTE EMAIL LOGS & DISPATCH ==================== */
export async function getQuoteEmailLogs(quoteIds) {
  if (!quoteIds || quoteIds.length === 0) return [];
  const sb = getSupabase();
  if (!sb || !currentUserProfile) return [];
  console.log('getQuoteEmailLogs -> Querying logs for quoteIds:', quoteIds);
  // PostgREST IN syntax: quote_id=in.(uuid1,uuid2,...)
  const data = await rawDbQuery('quote_email_logs', `quote_id=in.(${quoteIds.join(',')})&order=sent_at.desc`);
  return data || [];
}

export async function saveQuoteEmailLog(logObj) {
  if (!currentUserProfile) return { success: false, error: 'Not authenticated' };
  const mapped = {
    company_id: currentUserProfile.company_id,
    quote_id: logObj.quoteId,
    to_email: logObj.toEmail,
    cc_emails: logObj.ccEmails,
    quote_version: logObj.quoteVersion
  };
  const { data, error } = await rawDbWrite('quote_email_logs', 'POST', mapped);
  if (error) return { success: false, error: error.message };
  return { success: true, log: data ? data[0] : null };
}

export async function sendQuoteEmail(emailData) {
  const config = await getSupabaseConfig();
  if (!config) return { success: false, error: 'Supabase configuration missing.' };
  const token = await getAccessToken();
  if (!token) return { success: false, error: 'Authentication session not found.' };

  try {
    const res = await fetch(`${config.url}/rest/v1/rpc/send_quote_email`, {
      method: 'POST',
      headers: {
        'apikey': config.key,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_company_name: emailData.companyName,
        p_company_email: emailData.companyEmail,
        p_to_email: emailData.toEmail,
        p_cc_emails: emailData.ccEmails,
        p_subject: emailData.subject,
        p_msg: emailData.message,
        p_pdf_base64: emailData.pdfBase64 || null,
        p_pdf_filename: emailData.pdfFilename || null
      })
    });

    if (res.ok) {
      const data = await res.json();
      return data;
    } else {
      const data = await res.json();
      return { success: false, error: data.message || `HTTP error ${res.status}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function getCheckoutUrl(variantId, companyId, email) {
  const config = await getSupabaseConfig();
  if (!config) return null;
  const store = config.lemonSqueezyStore || 'mybidbook';
  return `https://${store}.lemonsqueezy.com/checkout/buy/${variantId}?checkout[custom][company_id]=${companyId}&checkout[email]=${encodeURIComponent(email)}`;
}

export async function getBillingPortalUrl() {
  const config = await getSupabaseConfig();
  if (!config) return null;
  const store = config.lemonSqueezyStore || 'mybidbook';
  return `https://${store}.lemonsqueezy.com/billing`;
}

// ==========================================
// SCHEDULE TEMPLATES
// ==========================================

export async function updateQuoteStatus(quoteId, status) {
  if (!currentUserProfile) return { error: 'Not authenticated' };
  const { data, error } = await rawDbWrite('quotes', 'PATCH', { status: status }, `id=eq.${quoteId}`);
  if (error) {
    return { error: error.message || 'Failed to update quote status' };
  }
  return { success: true };
}

export async function getScheduleTemplates() {
  const sb = getSupabase();
  if (!sb || !currentUserProfile || !currentUserProfile.company_id) return [];
  
  const data = await rawDbQuery('schedule_templates', `company_id=eq.${currentUserProfile.company_id}&order=name.asc`);
  if (!data) return [];
  
  return data.map(t => ({
    id: t.id,
    name: t.name,
    tasks: t.tasks || []
  }));
}

export async function saveScheduleTemplate(template) {
  if (!currentUserProfile) return { success: false, error: 'Not authenticated' };
  
  const payload = {
    company_id: currentUserProfile.company_id,
    name: template.name,
    tasks: template.tasks
  };

  const method = template.id ? 'PATCH' : 'POST';
  const params = template.id ? `id=eq.${template.id}` : '';

  const { data, error } = await rawDbWrite('schedule_templates', method, payload, params);
  if (error) {
    return { success: false, error: error.message || 'Database request failed. Make sure you have run the scheduling sql setup file.' };
  }
  return { success: true };
}
