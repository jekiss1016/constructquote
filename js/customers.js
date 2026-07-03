// Customer management controller
import { getCustomers, saveCustomer, deleteCustomer, getQuotes, getSupabase, getCurrentUserProfile, uploadFileToStorage, getCustomerById } from './db.js';
import { formatCurrency, formatDateTime, showToast, formatPhoneNumber } from './utils.js';
import { navigateToView, viewQuoteDetails } from './app.js';

let activeSearchQuery = '';
let inlineSaveCallback = null;
let activeCustomerDocs = []; // Temporary store for documents during edit session

export async function initCustomersView() {
  await renderCustomersTable();
  setupCustomerListeners();
}

// Render the customer table rows
export async function renderCustomersTable() {
  const tbody = document.getElementById('customers-table-body');
  if (!tbody) return;

  const customers = await getCustomers();
  const quotes = await getQuotes();
  const linkedCustomerIds = new Set(quotes.map(q => q.customerId).filter(id => id));

  const filtered = customers.filter(c => 
    c.name.toLowerCase().includes(activeSearchQuery.toLowerCase()) ||
    c.address.toLowerCase().includes(activeSearchQuery.toLowerCase()) ||
    (c.email && c.email.toLowerCase().includes(activeSearchQuery.toLowerCase())) ||
    (c.phone && c.phone.includes(activeSearchQuery))
  );

  const profile = getCurrentUserProfile();
  const isViewer = profile && profile.role === 'viewer';

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">
          ${activeSearchQuery ? 'No customers match your search.' : 'Customer database is empty.'}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const isInactive = c.status === 'Inactive';
    const statusBadge = `<span class="badge" style="background-color: ${isInactive ? 'rgba(100, 116, 139, 0.15)' : 'rgba(16, 185, 129, 0.15)'}; color: ${isInactive ? '#64748b' : '#10b981'}; font-weight: 600;">${c.status || 'Active'}</span>`;
    const isLinked = linkedCustomerIds.has(c.id);

    // Disable action buttons if role is read-only viewer
    const toggleBtn = isViewer ? '' : (isInactive ? `
      <button type="button" class="btn btn-secondary btn-icon-only toggle-customer-status-btn" data-id="${c.id}" title="Reactivate Customer" style="color: var(--success);">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
    ` : `
      <button type="button" class="btn btn-secondary btn-icon-only toggle-customer-status-btn" data-id="${c.id}" title="Deactivate Customer" style="color: var(--warning);">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      </button>
    `);

    const deleteBtnHtml = isViewer ? '' : (isLinked ? `
      <div style="width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; color: var(--text-muted); opacity: 0.35;" title="Customer is attached to quotes and cannot be deleted">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
    ` : `
      <button type="button" class="btn btn-danger btn-icon-only delete-customer-btn" data-id="${c.id}" title="Delete Customer">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    `);

    return `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.email || '-')}</td>
        <td>${escapeHtml(c.phone || '-')}</td>
        <td style="font-size: 0.85rem; color: var(--text-secondary); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(c.address)}">
          ${escapeHtml(c.address)}
        </td>
        <td style="text-align: center;"><span class="badge badge-legacy">${c.contacts ? c.contacts.length : 0} Contacts</span></td>
        <td>${statusBadge}</td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 0.5rem; justify-content: flex-end; align-items: center;">
            ${toggleBtn}
            <button type="button" class="btn btn-secondary btn-icon-only edit-customer-btn" data-id="${c.id}" title="${isViewer ? 'View Customer' : 'Edit Customer'}">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            ${deleteBtnHtml}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Render Related Quotes Timeline History
async function renderCustomerQuoteHistory(customerId) {
  const section = document.getElementById('customer-quotes-history-section');
  const tbody = document.getElementById('customer-quotes-history-tbody');
  if (!section || !tbody) return;

  const quotes = (await getQuotes()).filter(q => q.customerId === customerId && !q.isLegacy);

  if (quotes.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  tbody.innerHTML = quotes.map(q => {
    const subtotal = q.sections.reduce((secSum, sec) => {
      const secSub = sec.items.reduce((sum, item) => sum + (item.qty * (item.price + item.laborRate)), 0);
      return secSum + secSub;
    }, 0);
    const markupVal = subtotal * (q.markupPercent / 100);
    const taxVal = q.taxPlusApplicable ? 0 : (subtotal + markupVal) * (q.taxRate / 100);
    const total = subtotal + markupVal + taxVal;

    return `
      <tr>
        <td style="font-weight: 700;">
          <a href="#" class="view-history-quote-link" data-id="${q.id}" style="color: var(--primary); text-decoration: none; font-weight: 600;">
            ${escapeHtml(q.jobId)}
          </a>
        </td>
        <td>${formatDateTime(q.createdDateTime || q.date)}</td>
        <td>${q.status === 'Won' || q.status === 'Lost' || q.status === 'Completed' ? formatDateTime(q.dateWonLost) : '-'}</td>
        <td>${q.status === 'Completed' ? formatDateTime(q.dateCompleted) : '-'}</td>
        <td style="text-align: right; font-weight: 600; color: var(--primary);">${formatCurrency(total)}</td>
      </tr>
    `;
  }).join('');
}

// Render Attached Customer Documents (PDFs)
function renderCustomerDocuments(documents = []) {
  const list = document.getElementById('customer-documents-list');
  if (!list) return;

  const profile = getCurrentUserProfile();
  const isViewer = profile && profile.role === 'viewer';

  if (documents.length === 0) {
    list.innerHTML = `<span style="font-size:0.75rem; color:var(--text-muted);">No attached documents.</span>`;
    return;
  }

  list.innerHTML = documents.map(doc => {
    const deleteBtn = isViewer ? '' : `
      <button type="button" class="item-delete-btn remove-customer-doc-btn" data-doc-id="${doc.id}" style="padding: 0.2rem;" title="Delete Attachment">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    `;

    return `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; background: var(--bg-tertiary); padding: 0.35rem; border-radius: var(--radius-sm); width: 100%;">
        <a href="${doc.url}" target="_blank" style="font-size: 0.8rem; font-weight: 600; color: var(--primary); text-decoration: none; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 80%;">
          📄 ${escapeHtml(doc.name)}
        </a>
        ${deleteBtn}
      </div>
    `;
  }).join('');
}

// Interface helper to open customer modal inline
export function openCustomerModalInline(callback = null) {
  inlineSaveCallback = callback;
  activeCustomerDocs = [];
  
  const modal = document.getElementById('customer-modal');
  const form = document.getElementById('customer-form');
  
  form.reset();
  document.getElementById('customer-form-id').value = '';
  document.getElementById('customer-modal-title').textContent = 'Add Database Customer';
  
  document.getElementById('customer-form-default-markup').value = '';
  document.getElementById('customer-form-default-terms-notes').value = '';
  document.getElementById('customer-form-default-tax-plus-applicable').checked = false;
  
  const contactsList = document.getElementById('customer-contacts-list');
  contactsList.innerHTML = ''; // Reset contacts
  
  renderCustomerDocuments([]);
  
  // Hide history section on new customer creation
  document.getElementById('customer-quotes-history-section').style.display = 'none';

  modal.classList.add('active');
}

// Generate HTML contact input block
function addContactRow(contact = { name: '', role: '', email: '', phone: '' }) {
  const container = document.getElementById('customer-contacts-list');
  if (!container) return;

  const profile = getCurrentUserProfile();
  const isViewer = profile && profile.role === 'viewer';

  const deleteBtnHtml = isViewer ? '' : `
    <button type="button" class="item-delete-btn contact-row-remove" title="Remove Contact" style="padding: 0.25rem;">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>
  `;

  const row = document.createElement('div');
  row.className = 'contact-entry-row';
  row.innerHTML = `
    <input type="text" class="contact-row-input contact-name" value="${escapeHtml(contact.name)}" placeholder="Contact Name" required>
    <input type="text" class="contact-row-input contact-role" value="${escapeHtml(contact.role)}" placeholder="Role (e.g. Architect)">
    <input type="email" class="contact-row-input contact-email" value="${escapeHtml(contact.email)}" placeholder="Email">
    <input type="tel" class="contact-row-input contact-phone" value="${escapeHtml(formatPhoneNumber(contact.phone))}" placeholder="Phone" maxlength="14">
    ${deleteBtnHtml}
  `;
  container.appendChild(row);

  const phoneInput = row.querySelector('.contact-phone');
  if (phoneInput) {
    applyPhoneMask(phoneInput);
  }
}

function applyPhoneMask(inputEl) {
  if (!inputEl) return;
  inputEl.addEventListener('input', (e) => {
    e.target.value = formatPhoneNumber(e.target.value);
  });
}

// Set up UI Event Listeners for Customers Tab
function setupCustomerListeners() {
  const modal = document.getElementById('customer-modal');
  const addBtn = document.getElementById('customers-new-btn');
  const closeBtn = document.getElementById('customer-modal-close-btn');
  const cancelBtn = document.getElementById('customer-modal-cancel-btn');
  const form = document.getElementById('customer-form');
  const searchInput = document.getElementById('customers-search-input');
  
  const addContactBtn = document.getElementById('customer-add-contact-btn');
  const contactsList = document.getElementById('customer-contacts-list');
  const tableBody = document.getElementById('customers-table-body');
  const historyTbody = document.getElementById('customer-quotes-history-tbody');

  const docUpload = document.getElementById('customer-doc-upload');
  const docList = document.getElementById('customer-documents-list');

  const profile = getCurrentUserProfile();
  const isViewer = profile && profile.role === 'viewer';

  const phoneInput = document.getElementById('customer-form-phone');
  if (phoneInput) {
    applyPhoneMask(phoneInput);
  }

  const zipInput = document.getElementById('customer-form-zip');
  if (zipInput) {
    zipInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
    });
  }

  // Toggle View limitations
  if (isViewer) {
    if (addBtn) addBtn.style.display = 'none';
    if (addContactBtn) addContactBtn.style.display = 'none';
    const submitBtn = document.getElementById('customer-modal-submit-btn');
    if (submitBtn) submitBtn.style.display = 'none';
    const uploadLabel = document.querySelector('label[for="customer-doc-upload"]');
    if (uploadLabel) uploadLabel.style.display = 'none';
  } else {
    if (addBtn) addBtn.style.display = 'inline-flex';
    if (addContactBtn) addContactBtn.style.display = 'inline-flex';
    const submitBtn = document.getElementById('customer-modal-submit-btn');
    if (submitBtn) submitBtn.style.display = 'inline-flex';
    const uploadLabel = document.querySelector('label[for="customer-doc-upload"]');
    if (uploadLabel) uploadLabel.style.display = 'inline-flex';
  }

  // Handle PDF Contract Attachments
  if (docUpload) {
    // Recreate input to clear prior files
    docUpload.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        if (file.type !== 'application/pdf') {
          showToast('Only PDF files are supported.', 'danger');
          docUpload.value = '';
          return;
        }

        const sb = getSupabase();
        if (!sb || !profile) {
          showToast('Database connection not established.', 'danger');
          docUpload.value = '';
          return;
        }

        showToast('Uploading contract document...');
        const filePath = `${profile.company_id}/${Math.random().toString(36).substr(2, 9)}_${file.name}`;
        
        const { error } = await uploadFileToStorage('pdf-contracts', filePath, file);

        if (error) {
          showToast('Upload failed: ' + error.message, 'danger');
          docUpload.value = '';
          return;
        }

        const { data: { publicUrl } } = sb.storage
          .from('pdf-contracts')
          .getPublicUrl(filePath);

        activeCustomerDocs.push({
          id: 'doc_' + Math.random().toString(36).substr(2, 9),
          name: file.name,
          url: publicUrl,
          path: filePath
        });

        renderCustomerDocuments(activeCustomerDocs);
        showToast('Document uploaded successfully.');
        docUpload.value = '';
      }
    });
  }

  // Handle PDF Attachment deletion
  if (docList) {
    docList.addEventListener('click', async (e) => {
      const deleteBtn = e.target.closest('.remove-customer-doc-btn');
      if (deleteBtn) {
        const docId = deleteBtn.getAttribute('data-doc-id');
        const doc = activeCustomerDocs.find(d => d.id === docId);
        if (doc && confirm(`Are you sure you want to remove the document "${doc.name}"?`)) {
          // Delete from storage if path exists
          if (doc.path) {
            const sb = getSupabase();
            if (sb) {
              await sb.storage.from('pdf-contracts').remove([doc.path]);
            }
          }
          activeCustomerDocs = activeCustomerDocs.filter(d => d.id !== docId);
          renderCustomerDocuments(activeCustomerDocs);
          showToast('Attachment deleted.');
        }
      }
    });
  }

  // Search filter
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      activeSearchQuery = e.target.value;
      renderCustomersTable();
    });
  }

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      openCustomerModalInline(null);
    });
  }

  if (addContactBtn) {
    addContactBtn.addEventListener('click', () => {
      addContactRow();
    });
  }

  if (contactsList) {
    contactsList.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.contact-row-remove');
      if (deleteBtn) {
        const row = deleteBtn.closest('.contact-entry-row');
        row.remove();
        showToast('Contact row removed.');
      }
    });
  }

  if (historyTbody) {
    historyTbody.addEventListener('click', (e) => {
      const link = e.target.closest('.view-history-quote-link');
      if (link) {
        e.preventDefault();
        const quoteId = link.getAttribute('data-id');
        modal.classList.remove('active');
        viewQuoteDetails(quoteId);
      }
    });
  }

  const closeModal = () => {
    modal.classList.remove('active');
    inlineSaveCallback = null;
  };
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isViewer) return;

      const submitBtn = document.getElementById('customer-modal-submit-btn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
      }

      try {
        const contactRows = contactsList.querySelectorAll('.contact-entry-row');
        const contacts = [];
        contactRows.forEach(row => {
          const name = row.querySelector('.contact-name').value.trim();
          if (name) {
            contacts.push({
              name,
              role: row.querySelector('.contact-role').value.trim(),
              email: row.querySelector('.contact-email').value.trim(),
              phone: formatPhoneNumber(row.querySelector('.contact-phone').value.trim())
            });
          }
        });

        const customer = {
          id: document.getElementById('customer-form-id').value || null,
          name: document.getElementById('customer-form-name').value.trim(),
          email: document.getElementById('customer-form-email').value.trim(),
          phone: formatPhoneNumber(document.getElementById('customer-form-phone').value.trim()),
          address1: document.getElementById('customer-form-address1').value.trim(),
          address2: document.getElementById('customer-form-address2').value.trim(),
          city: document.getElementById('customer-form-city').value.trim(),
          state: document.getElementById('customer-form-state').value.trim().toUpperCase(),
          zip: document.getElementById('customer-form-zip').value.trim(),
          contacts,
          documents: activeCustomerDocs,
          defaultMarkupPercent: parseFloat(document.getElementById('customer-form-default-markup').value) || 0,
          defaultTermsNotes: document.getElementById('customer-form-default-terms-notes').value.trim(),
          defaultTaxPlusApplicable: document.getElementById('customer-form-default-tax-plus-applicable').checked
        };

        const res = await saveCustomer(customer);
        if (res.success) {
          showToast(customer.id ? 'Customer profile updated.' : 'Customer profile created.');
          if (inlineSaveCallback) {
            inlineSaveCallback(res.customer);
          }
          closeModal();
          await renderCustomersTable();
        } else {
          showToast(res.error, 'danger');
        }
      } catch (err) {
        console.error('Error saving customer:', err);
        showToast('Error saving customer profile.', 'danger');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Customer';
        }
      }
    });
  }

  if (tableBody) {
    tableBody.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('.edit-customer-btn');
      const deleteBtn = e.target.closest('.delete-customer-btn');
      const toggleStatusBtn = e.target.closest('.toggle-customer-status-btn');

      if (toggleStatusBtn) {
        const id = toggleStatusBtn.getAttribute('data-id');
        const c = await getCustomerById(id);
        if (c) {
          c.status = c.status === 'Inactive' ? 'Active' : 'Inactive';
          const res = await saveCustomer(c);
          if (res.success) {
            showToast(`Customer "${c.name}" marked ${c.status.toLowerCase()}.`);
            await renderCustomersTable();
          } else {
            showToast(res.error, 'danger');
          }
        }
      }

      if (editBtn) {
        const id = editBtn.getAttribute('data-id');
        const c = await getCustomerById(id);
        
        if (c) {
          form.reset();
          document.getElementById('customer-form-id').value = c.id;
          document.getElementById('customer-form-name').value = c.name;
          document.getElementById('customer-form-email').value = c.email || '';
          document.getElementById('customer-form-phone').value = formatPhoneNumber(c.phone || '');
          document.getElementById('customer-form-address1').value = c.address1 || '';
          document.getElementById('customer-form-address2').value = c.address2 || '';
          document.getElementById('customer-form-city').value = c.city || '';
          document.getElementById('customer-form-state').value = c.state || '';
          document.getElementById('customer-form-zip').value = c.zip || '';
          
          document.getElementById('customer-form-default-markup').value = c.defaultMarkupPercent || '';
          document.getElementById('customer-form-default-terms-notes').value = c.defaultTermsNotes || '';
          document.getElementById('customer-form-default-tax-plus-applicable').checked = c.defaultTaxPlusApplicable || false;
          
          contactsList.innerHTML = '';
          if (c.contacts && c.contacts.length > 0) {
            c.contacts.forEach(contact => addContactRow(contact));
          }

          // Enable/disable form inputs based on role
          const formInputs = form.querySelectorAll('input, textarea, select');
          formInputs.forEach(input => {
            input.disabled = isViewer;
          });

          // Toggle visibility of management elements for viewers
          const submitBtn = document.getElementById('customer-modal-submit-btn');
          const addContactBtn = document.getElementById('customer-add-contact-btn');
          const docUploadLabel = document.querySelector('label[for="customer-doc-upload"]');
          const defaultsSection = document.getElementById('customer-form-defaults-section');

          if (submitBtn) submitBtn.style.display = isViewer ? 'none' : '';
          if (addContactBtn) addContactBtn.style.display = isViewer ? 'none' : '';
          if (docUploadLabel) docUploadLabel.style.display = isViewer ? 'none' : '';
          if (defaultsSection) defaultsSection.style.display = isViewer ? 'none' : '';

          activeCustomerDocs = c.documents || [];
          renderCustomerDocuments(activeCustomerDocs);

          await renderCustomerQuoteHistory(c.id);

          document.getElementById('customer-modal-title').textContent = isViewer ? 'View Customer Profile' : 'Edit Customer Profile';
          modal.classList.add('active');
        }
      }

      if (deleteBtn) {
        const id = deleteBtn.getAttribute('data-id');
        const c = await getCustomerById(id);
        if (c) {
          const res = await deleteCustomer(id);
          if (res.success) {
            showToast('Customer deleted.');
            await renderCustomersTable();
          } else {
            if (confirm(`${res.error}\n\nWould you like to mark "${c.name}" as Inactive instead?`)) {
              c.status = 'Inactive';
              const saveRes = await saveCustomer(c);
              if (saveRes.success) {
                showToast(`Customer "${c.name}" marked inactive.`);
                await renderCustomersTable();
              } else {
                showToast(saveRes.error, 'danger');
              }
            }
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
