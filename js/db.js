// Database management using Supabase Cloud & LocalStorage fallbacks
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { showToast } from './utils.js';

const KEYS = {
  SUPABASE_CONFIG: 'cq_supabase_config'
};

// Default setup values
const DEFAULT_CATEGORIES = ['Labor', 'Underlay', 'Framing', 'Finishing', 'Drywall', 'Flooring'];

const DEFAULT_SETTINGS = {
  companyName: 'ConstructQuote Pro Ltd.',
  companyAddress: '100 Contractor Plaza, Suite A, Seattle, WA 98101',
  companyPhone: '(206) 555-0199',
  companyEmail: 'billing@constructquotepro.com',
  defaultTaxRate: 8.8,
  defaultMarkupPercent: 15,
  companyLogo: ''
};

let supabase = null;
let currentUserProfile = null; // Stores { id, company_id, role, email }

let cachedConfig = null;

export async function loadRuntimeConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    const response = await fetch('config.json');
    if (response.ok) {
      const config = await response.json();
      if (config.supabaseUrl && config.supabaseKey) {
        cachedConfig = { url: config.supabaseUrl, key: config.supabaseKey };
        return cachedConfig;
      }
    }
  } catch (e) {
    // Ignore error if file doesn't exist
  }
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
  try {
    const projectRef = config.url.split('//')[1].split('.')[0];
    const key = `sb-${projectRef}-auth-token`;
    const data = localStorage.getItem(key);
    if (data) {
      const parsed = JSON.parse(data);
      return parsed.access_token;
    }
  } catch (e) {
    console.error('Error reading access token:', e);
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
  const url = `${config.url}/rest/v1/profiles?id=eq.${user.id}&select=*`;
  
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
  }

  if (profile) {
    currentUserProfile = profile;
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
  if (!sb || !currentUserProfile || !currentUserProfile.company_id) return DEFAULT_CATEGORIES;

  console.log('getCategories -> Querying categories table via rawDbQuery...');
  const data = await rawDbQuery('categories', `company_id=eq.${currentUserProfile.company_id}&order=name.asc`);
  console.log('getCategories -> Categories fetched. Data length:', data ? data.length : 0);
  if (!data) return DEFAULT_CATEGORIES;

  const custom = data.map(c => c.name);
  const merged = [...DEFAULT_CATEGORIES];
  custom.forEach(c => {
    if (!merged.some(m => m.toLowerCase() === c.toLowerCase())) {
      merged.push(c);
    }
  });
  return merged;
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
  if (categoryName.toLowerCase() === 'labor') {
    return { success: false, error: 'Cannot delete the core "Labor" category.' };
  }
  
  const { error } = await rawDbWrite(
    'categories', 
    'DELETE', 
    null, 
    `company_id=eq.${currentUserProfile.company_id}&name=eq.${encodeURIComponent(categoryName)}`
  );
    
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/* ==================== CUSTOMERS CRUD ==================== */
export async function getCustomers() {
  console.log('getCustomers -> Starting...');
  const sb = getSupabase();
  if (!sb || !currentUserProfile || !currentUserProfile.company_id) return [];
  
  console.log('getCustomers -> Querying customers table via rawDbQuery...');
  const data = await rawDbQuery('customers', `company_id=eq.${currentUserProfile.company_id}&order=name.asc`);
  console.log('getCustomers -> Customers fetched. Data length:', data ? data.length : 0);
  if (!data) return [];
  return data.map(c => {
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
      documents: c.documents || []
    };
  });
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
    documents: customer.documents || []
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
  const sb = getSupabase();
  if (!sb || !currentUserProfile || !currentUserProfile.company_id) return [];
  
  console.log('getQuotes -> Querying quotes table via rawDbQuery...');
  const data = await rawDbQuery('quotes', `company_id=eq.${currentUserProfile.company_id}&order=date.desc`);
  console.log('getQuotes -> Quotes fetched. Data length:', data ? data.length : 0);
  if (!data) return [];
  return data.map(q => ({
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
    receipts: q.receipts || []
  }));
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
  
  if (!(await checkJobIdUnique(quote.jobId, quote.id))) {
    return { success: false, error: `Job ID "${quote.jobId}" is already assigned to another active quote. Job IDs must be unique.` };
  }
  
  if (quote.status === 'Won' || quote.status === 'Lost' || quote.status === 'Inactive') {
    if (!quote.dateWonLost) quote.dateWonLost = new Date().toISOString();
  } else if (quote.status === 'Completed') {
    if (!quote.dateCompleted) quote.dateCompleted = new Date().toISOString();
    if (!quote.dateWonLost) quote.dateWonLost = new Date().toISOString();
  } else if (quote.status === 'Pending') {
    quote.dateWonLost = null;
    quote.dateCompleted = null;
  }
  
  const mapped = {
    company_id: currentUserProfile.company_id,
    job_id: quote.jobId,
    customer_id: quote.customerId,
    customer_name: quote.customerName,
    project_address: quote.projectAddress,
    customer_phone: quote.customerPhone,
    customer_email: quote.customerEmail,
    date: quote.date,
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
    sections: quote.sections || [],
    photos: quote.photos || [],
    documents: quote.documents || [],
    receipts: quote.receipts || []
  };
  
  if (quote.id) {
    const existing = await getQuoteById(quote.id);
    if (existing) {
      const contentChanged = 
        JSON.stringify(existing.notes) !== JSON.stringify(quote.notes) ||
        JSON.stringify(existing.sections) !== JSON.stringify(quote.sections) ||
        existing.customerName !== quote.customerName ||
        existing.projectAddress !== quote.projectAddress ||
        existing.customerPhone !== quote.customerPhone ||
        existing.customerEmail !== quote.customerEmail ||
        existing.markupPercent !== quote.markupPercent ||
        existing.taxRate !== quote.taxRate ||
        existing.expirationDate !== quote.expirationDate ||
        existing.companyLogo !== quote.companyLogo ||
        existing.printShowDetails !== quote.printShowDetails ||
        existing.printShowDetailPricing !== quote.printShowDetailPricing ||
        existing.printShowQuantities !== quote.printShowQuantities;
        
      if (contentChanged && !existing.isLegacy) {
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
          company_logo: legacyCopy.companyLogo || '',
          print_show_details: legacyCopy.printShowDetails !== false,
          print_show_detail_pricing: legacyCopy.printShowDetailPricing !== false,
          print_show_quantities: legacyCopy.printShowQuantities !== false,
          sections: legacyCopy.sections,
          photos: legacyCopy.photos,
          documents: legacyCopy.documents,
          receipts: legacyCopy.receipts
        });
        if (legError) return { success: false, error: 'Legacy archive failed: ' + legError.message };
        
        mapped.version = (existing.version || 1) + 1;
        mapped.parent_quote_id = existing.parentQuoteId || existing.id;
      }
    }
    
    const { data, error } = await rawDbWrite(
      'quotes', 
      'PATCH', 
      mapped, 
      `id=eq.${quote.id}&company_id=eq.${currentUserProfile.company_id}`
    );
    if (error) return { success: false, error: error.message };
    const returnedObj = data && data.length > 0 ? data[0] : quote;
    return { success: true, quote: returnedObj };
  } else {
    const maxQ = await rawDbQuery('quotes', `company_id=eq.${currentUserProfile.company_id}&order=quote_number.desc&limit=1`);
    const nextNum = maxQ && maxQ.length > 0 ? (parseInt(maxQ[0].quote_number) || 1000) + 1 : 1001;
    mapped.quote_number = nextNum;
    
    const { data, error } = await rawDbWrite('quotes', 'POST', mapped);
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
    sections: q.sections || [],
    photos: q.photos,
    documents: q.documents,
    receipts: q.receipts
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

export async function deleteQuote(id) {
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
    theme: row.theme || 'light'
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

/* ==================== LOCALSTORAGE DATA MIGRATOR ==================== */
export async function migrateLocalStorageToSupabase() {
  const sb = getSupabase();
  if (!sb || !currentUserProfile) return { success: false, error: 'Not authenticated to Supabase.' };
  
  try {
    const localCats = JSON.parse(localStorage.getItem('cq_categories')) || [];
    const localCusts = JSON.parse(localStorage.getItem('cq_customers')) || [];
    const localProds = JSON.parse(localStorage.getItem('cq_products')) || [];
    const localQuotes = JSON.parse(localStorage.getItem('cq_quotes')) || [];
    
    // Migrate Categories
    for (const cat of localCats) {
      await sb.from('categories').upsert({
        company_id: currentUserProfile.company_id,
        name: cat
      }, { onConflict: 'company_id,name' });
    }
    
    // Migrate Products
    for (const p of localProds) {
      await sb.from('products').insert({
        company_id: currentUserProfile.company_id,
        name: p.name,
        category: p.category,
        uom: p.uom,
        price: p.price,
        labor_rate: p.laborRate || 0,
        status: p.status || 'Active',
        description: p.description
      });
    }
    
    // Migrate Customers
    for (const c of localCusts) {
      await sb.from('customers').insert({
        company_id: currentUserProfile.company_id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        address: c.address,
        status: c.status || 'Active',
        contacts: c.contacts || [],
        documents: c.documents || []
      });
    }
    
    // Migrate Quotes
    for (const q of localQuotes) {
      await sb.from('quotes').insert({
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
        status: q.status || 'Pending',
        version: q.version || 1,
        parent_quote_id: q.parentQuoteId,
        is_legacy: q.isLegacy === true,
        date_won_lost: q.dateWonLost,
        date_completed: q.dateCompleted,
        sections: q.sections || [],
        photos: q.photos || []
      });
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/* ==================== SYSADMIN MULTI-TENANT HELPERS ==================== */
export async function getAllCompanies() {
  console.log('getAllCompanies -> Starting raw fetch...');
  const data = await rawDbQuery('settings', 'select=company_id,company_name&order=company_name.asc');
  console.log('getAllCompanies -> Companies fetched. Data length:', data ? data.length : 0);
  if (!data) return [];
  return data.map(s => ({
    id: s.company_id,
    name: s.company_name || 'Unnamed Company'
  }));
}

export async function switchUserCompany(companyId) {
  const config = await getSupabaseConfig();
  if (!config || !currentUserProfile) return false;
  const token = await getAccessToken();
  if (!token) return false;
  
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
