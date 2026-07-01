// Product Catalog management controller
import { getProducts, getCategories, saveProduct, deleteProduct, saveCategory, deleteCategory, getQuotes, getCurrentUserProfile } from './db.js?v=5';
import { formatCurrency, showToast } from './utils.js';

let activeSearchQuery = '';

export async function initCatalogView() {
  await renderCatalogTable();
  await renderCategoryList();
  setupCatalogListeners();
}

// Renders product database table rows
export async function renderCatalogTable() {
  const tableBody = document.getElementById('catalog-table-body');
  if (!tableBody) return;

  const products = await getProducts();
  const quotes = await getQuotes();
  const usedProductIds = new Set();
  quotes.forEach(q => {
    if (q.sections) {
      q.sections.forEach(sec => {
        if (sec.items) {
          sec.items.forEach(item => {
            if (item.productId) {
              usedProductIds.add(item.productId);
            }
          });
        }
      });
    }
  });

  const filtered = products.filter(p => 
    p.name.toLowerCase().includes(activeSearchQuery.toLowerCase()) ||
    p.category.toLowerCase().includes(activeSearchQuery.toLowerCase()) ||
    (p.description && p.description.toLowerCase().includes(activeSearchQuery.toLowerCase()))
  );

  const profile = getCurrentUserProfile();
  const isViewer = profile && profile.role === 'viewer';

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">
          ${activeSearchQuery ? 'No products match your search.' : 'Product catalog is empty. Add a product to get started.'}
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = filtered.map(p => {
    const isInactive = p.status === 'Inactive';
    const statusBadge = `<span class="badge" style="background-color: ${isInactive ? 'rgba(100, 116, 139, 0.15)' : 'rgba(16, 185, 129, 0.15)'}; color: ${isInactive ? '#64748b' : '#10b981'}; font-weight: 600;">${p.status || 'Active'}</span>`;
    const isUsed = usedProductIds.has(p.id);

    const toggleBtn = isViewer ? '' : (isInactive ? `
      <button type="button" class="btn btn-secondary btn-icon-only toggle-product-status-btn" data-id="${p.id}" title="Reactivate Product" style="color: var(--success);">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
    ` : `
      <button type="button" class="btn btn-secondary btn-icon-only toggle-product-status-btn" data-id="${p.id}" title="Deactivate Product" style="color: var(--warning);">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      </button>
    `);

    const deleteBtnHtml = isViewer ? '' : (isUsed ? `
      <div style="width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; color: var(--text-muted); opacity: 0.35;" title="Product is used in historical quotes and cannot be deleted">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
    ` : `
      <button type="button" class="btn btn-danger btn-icon-only delete-product-btn" data-id="${p.id}" title="Delete Product">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    `);

    return `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(p.name)}</td>
        <td><span class="badge ${p.category.toLowerCase() === 'labor' ? 'badge-pending' : 'badge-legacy'}">${escapeHtml(p.category)}</span></td>
        <td style="font-weight: 500;">${p.uom}</td>
        <td>${formatCurrency(p.price)}</td>
        <td>${p.laborRate ? formatCurrency(p.laborRate) : '<span style="color: var(--text-muted); font-style: italic;">None</span>'}</td>
        <td>${statusBadge}</td>
        <td style="font-size: 0.85rem; color: var(--text-secondary); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(p.description || '')}">
          ${escapeHtml(p.description || '-')}
        </td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 0.5rem; justify-content: flex-end; align-items: center;">
            ${toggleBtn}
            <button type="button" class="btn btn-secondary btn-icon-only edit-product-btn" data-id="${p.id}" title="${isViewer ? 'View Product' : 'Edit Product'}">
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

// Renders the list of categories in the side-card
export async function renderCategoryList() {
  const catListContainer = document.getElementById('catalog-category-list');
  if (!catListContainer) return;

  const profile = getCurrentUserProfile();
  const isViewer = profile && profile.role === 'viewer';

  const categories = await getCategories();
  catListContainer.innerHTML = categories.map(cat => {
    const isLabor = cat.toLowerCase() === 'labor';
    const deleteBtn = isViewer ? '' : (isLabor ? `
      <span style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">Locked</span>
    ` : `
      <button type="button" class="item-delete-btn delete-category-btn" data-category="${escapeHtml(cat)}" style="padding: 0.15rem;">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="14" height="14">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    `);

    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; background-color: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
        <span style="font-weight: 500; font-size: 0.85rem;">${escapeHtml(cat)}</span>
        ${deleteBtn}
      </div>
    `;
  }).join('');
}

// Populate the categories selector inside the modal dialog
export async function populateCategoryDropdowns() {
  const dropdown = document.getElementById('product-form-category');
  if (!dropdown) return;

  const categories = await getCategories();
  dropdown.innerHTML = categories.map(c => `
    <option value="${escapeHtml(c)}">${escapeHtml(c)}</option>
  `).join('');
}

// Set up UI Event Listeners for Catalog Tab
function setupCatalogListeners() {
  const modal = document.getElementById('product-modal');
  const addBtn = document.getElementById('catalog-new-product-btn');
  const closeBtn = document.getElementById('product-modal-close-btn');
  const cancelBtn = document.getElementById('product-modal-cancel-btn');
  const form = document.getElementById('product-form');
  const searchInput = document.getElementById('catalog-search-input');
  
  const catAddInput = document.getElementById('category-add-input');
  const catAddBtn = document.getElementById('category-add-btn');
  const catList = document.getElementById('catalog-category-list');
  const tableBody = document.getElementById('catalog-table-body');

  const profile = getCurrentUserProfile();
  const isViewer = profile && profile.role === 'viewer';

  // Toggle View limitations
  if (isViewer) {
    if (addBtn) addBtn.style.display = 'none';
    const catForm = document.getElementById('category-add-btn')?.closest('div');
    if (catForm) catForm.style.display = 'none';
    const submitBtn = document.getElementById('product-modal-submit-btn');
    if (submitBtn) submitBtn.style.display = 'none';
  } else {
    if (addBtn) addBtn.style.display = 'inline-flex';
    const catForm = document.getElementById('category-add-btn')?.closest('div');
    if (catForm) catForm.style.display = 'flex';
    const submitBtn = document.getElementById('product-modal-submit-btn');
    if (submitBtn) submitBtn.style.display = 'inline-flex';
  }

  // Search input filter
  if (searchInput) {
    searchInput.addEventListener('input', async (e) => {
      activeSearchQuery = e.target.value;
      await renderCatalogTable();
    });
  }

  // Open modal for NEW product
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      if (isViewer) return;
      form.reset();
      document.getElementById('product-form-id').value = '';
      document.getElementById('product-modal-title').textContent = 'Add Catalog Product';
      await populateCategoryDropdowns();
      modal.classList.add('active');
    });
  }

  const closeModal = () => modal.classList.remove('active');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  // Submit Product Form (Create / Edit)
  if (form) {
    form.addEventListener('submit', async (e) => {
      console.log('Catalog View: product-form submit event triggered');
      e.preventDefault();
      if (isViewer) {
        console.log('Catalog View: submit aborted because user is viewer');
        return;
      }

      const product = {
        id: document.getElementById('product-form-id').value || null,
        name: document.getElementById('product-form-name').value,
        category: document.getElementById('product-form-category').value,
        uom: document.getElementById('product-form-uom').value,
        price: parseFloat(document.getElementById('product-form-price').value) || 0,
        laborRate: parseFloat(document.getElementById('product-form-labor').value) || 0,
        description: document.getElementById('product-form-desc').value
      };

      const res = await saveProduct(product);
      if (res.success) {
        showToast(product.id ? 'Product updated successfully.' : 'Product added to catalog.');
        closeModal();
        await renderCatalogTable();
      } else {
        showToast(res.error, 'danger');
      }
    });
  }

  // Action Buttons inside Product Table (Edit / Delete / Toggle Status)
  if (tableBody) {
    tableBody.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('.edit-product-btn');
      const deleteBtn = e.target.closest('.delete-product-btn');
      const toggleStatusBtn = e.target.closest('.toggle-product-status-btn');

      if (toggleStatusBtn && !isViewer) {
        const id = toggleStatusBtn.getAttribute('data-id');
        const p = await getProductById(id);
        if (p) {
          p.status = p.status === 'Inactive' ? 'Active' : 'Inactive';
          const res = await saveProduct(p);
          if (res.success) {
            showToast(`Product "${p.name}" marked ${p.status.toLowerCase()}.`);
            await renderCatalogTable();
          } else {
            showToast(res.error, 'danger');
          }
        }
      }

      if (editBtn) {
        const id = editBtn.getAttribute('data-id');
        const p = await getProductById(id);
        
        if (p) {
          document.getElementById('product-form-id').value = p.id;
          document.getElementById('product-form-name').value = p.name;
          await populateCategoryDropdowns();
          document.getElementById('product-form-category').value = p.category;
          document.getElementById('product-form-uom').value = p.uom;
          document.getElementById('product-form-price').value = p.price;
          document.getElementById('product-form-labor').value = p.laborRate || 0;
          document.getElementById('product-form-desc').value = p.description || '';

          document.getElementById('product-modal-title').textContent = isViewer ? 'View Catalog Product' : 'Edit Catalog Product';
          modal.classList.add('active');
        }
      }

      if (deleteBtn && !isViewer) {
        const id = deleteBtn.getAttribute('data-id');
        const p = await getProductById(id);
        if (p) {
          const res = await deleteProduct(id);
          if (res.success) {
            showToast('Product deleted from database.');
            await renderCatalogTable();
          } else {
            p.status = 'Inactive';
            const saveRes = await saveProduct(p);
            if (saveRes.success) {
              showToast(`Product "${p.name}" is linked to quotes. Deactivated instead.`, 'warning');
              await renderCatalogTable();
            } else {
              showToast(saveRes.error, 'danger');
            }
          }
        }
      }
    });
  }

  // Category Manager: Add Category
  const handleAddCategory = async () => {
    if (isViewer) return;
    const val = catAddInput.value.trim();
    if (!val) return;
    const res = await saveCategory(val);
    if (res.success) {
      showToast(`Category "${val}" created.`);
      catAddInput.value = '';
      await renderCategoryList();
      await populateCategoryDropdowns();
    } else {
      showToast(res.error, 'warning');
    }
  };

  if (catAddBtn) catAddBtn.addEventListener('click', handleAddCategory);
  if (catAddInput) {
    catAddInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAddCategory();
    });
  }

  // Category Manager: Delete Category
  if (catList) {
    catList.addEventListener('click', async (e) => {
      const btn = e.target.closest('.delete-category-btn');
      if (btn && !isViewer) {
        const cat = btn.getAttribute('data-category');
        if (confirm(`Are you sure you want to delete the category "${cat}"? Products under this category will remain, but the category selector option will be removed.`)) {
          const res = await deleteCategory(cat);
          if (res.success) {
            showToast(`Category "${cat}" deleted.`);
            await renderCategoryList();
            await populateCategoryDropdowns();
          } else {
            showToast(res.error, 'danger');
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
