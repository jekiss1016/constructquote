import { showToast } from './utils.js?v=3.0.41';

const KEYS = {
  OFFLINE_QUOTES: 'cq_offline_quotes',
  OFFLINE_CUSTOMERS: 'cq_offline_customers',
  PHOTO_QUEUE: 'cq_offline_photo_queue'
};

/**
 * Checks if browser is currently offline
 */
export function isOffline() {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

/**
 * Intercepts action buttons in offline mode with a friendly user notification
 */
export function checkOfflineAction(e) {
  if (isOffline()) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    showToast('This function is not available in offline mode. Please try again when you are back online.', 'warning');
    return true; // Was blocked because app is offline
  }
  return false; // Online, allow action to proceed
}

/**
 * Filter and save quotes, schedules, and customers to localStorage for offline access
 */
export function updateOfflineCache(allQuotes = [], allCustomers = []) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const minScheduleDate = new Date(today);
    minScheduleDate.setDate(minScheduleDate.getDate() - 7);

    const maxScheduleDate = new Date(today);
    maxScheduleDate.setDate(maxScheduleDate.getDate() + 7);

    const maxPendingExpDate = new Date(today);
    maxPendingExpDate.setDate(maxPendingExpDate.getDate() + 30);

    // 1. Filter quotes according to offline business rules
    const offlineQuotes = allQuotes.filter(q => {
      if (q.isLegacy) return false;
      const statusLower = (q.status || '').toLowerCase();

      // Rule: Won or In Progress states
      if (statusLower === 'won' || statusLower === 'in progress') return true;

      // Rule: Pending state with expiration date <= Today + 30 Days
      if (statusLower === 'pending') {
        if (!q.expirationDate) return true; // Include if no expiration specified
        const expDate = new Date(q.expirationDate);
        if (isNaN(expDate.getTime()) || expDate <= maxPendingExpDate) return true;
      }

      // Rule: Today - 7d to Today + 7d schedule window (In Progress, Completed, or scheduled to start)
      if (q.scheduleTasks && q.scheduleTasks.length > 0) {
        const hasTaskInWindow = q.scheduleTasks.some(t => {
          if (!t.startDate) return false;
          const sDate = new Date(t.startDate);
          const eDate = t.endDate ? new Date(t.endDate) : sDate;
          return (sDate <= maxScheduleDate && eDate >= minScheduleDate);
        });
        if (hasTaskInWindow) return true;
      }

      // Check dateCompleted or dateWonLost fall within schedule window
      if (q.dateCompleted) {
        const compDate = new Date(q.dateCompleted);
        if (compDate >= minScheduleDate && compDate <= maxScheduleDate) return true;
      }

      return false;
    });

    // Save cached quotes
    localStorage.setItem(KEYS.OFFLINE_QUOTES, JSON.stringify(offlineQuotes));

    // 2. Filter customers associated with the offline quotes
    const offlineCustomerIds = new Set(offlineQuotes.map(q => q.customerId).filter(Boolean));
    const offlineCustomers = allCustomers.filter(c => offlineCustomerIds.has(c.id));

    localStorage.setItem(KEYS.OFFLINE_CUSTOMERS, JSON.stringify(offlineCustomers));

    console.log(`[OfflineCache] Updated offline cache: ${offlineQuotes.length} quotes, ${offlineCustomers.length} customers.`);
  } catch (e) {
    console.error('[OfflineCache] Failed to update offline cache:', e);
  }
}

/**
 * Get offline quotes from local cache
 */
export function getOfflineQuotes() {
  try {
    const cached = localStorage.getItem(KEYS.OFFLINE_QUOTES);
    return cached ? JSON.parse(cached) : [];
  } catch (e) {
    console.error('[OfflineCache] Failed to read offline quotes cache:', e);
    return [];
  }
}

/**
 * Get offline customers from local cache
 */
export function getOfflineCustomers() {
  try {
    const cached = localStorage.getItem(KEYS.OFFLINE_CUSTOMERS);
    return cached ? JSON.parse(cached) : [];
  } catch (e) {
    console.error('[OfflineCache] Failed to read offline customers cache:', e);
    return [];
  }
}

/**
 * Queue a photo upload while offline
 */
export function enqueueOfflinePhoto(quoteId, dataUrl, fileName, label, category) {
  try {
    const queue = getOfflinePhotoQueue();
    const photoId = 'offline_img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const photoItem = {
      id: photoId,
      quoteId,
      dataUrl,
      fileName: fileName || 'offline_photo.jpg',
      label: label || 'Project Gallery Photo',
      category: category || 'before',
      timestamp: Date.now()
    };

    queue.push(photoItem);
    localStorage.setItem(KEYS.PHOTO_QUEUE, JSON.stringify(queue));

    // Also update offline quotes cache locally so preview shows immediately
    const cachedQuotes = getOfflineQuotes();
    const targetQuote = cachedQuotes.find(q => q.id === quoteId);
    if (targetQuote) {
      if (!targetQuote.photos) targetQuote.photos = [];
      targetQuote.photos.push({
        id: photoId,
        url: dataUrl,
        label: (label || 'Project Gallery Photo') + ' (Queued Offline)',
        category: category || 'before',
        isQueuedOffline: true
      });
      localStorage.setItem(KEYS.OFFLINE_QUOTES, JSON.stringify(cachedQuotes));
    }

    return photoItem;
  } catch (e) {
    console.error('[OfflineCache] Failed to enqueue offline photo:', e);
    throw e;
  }
}

/**
 * Get queued offline photo uploads
 */
export function getOfflinePhotoQueue() {
  try {
    const cached = localStorage.getItem(KEYS.PHOTO_QUEUE);
    return cached ? JSON.parse(cached) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Helper to convert Base64 Data URL to Blob/File object
 */
function dataURLtoFile(dataurl, filename) {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

/**
 * Automatically sync queued offline photo uploads when back online
 */
export async function syncOfflinePhotoQueue(uploadFileToStorage, getQuoteById, saveQuote, showToast) {
  const queue = getOfflinePhotoQueue();
  if (!queue || queue.length === 0) return;

  console.log(`[OfflineCache] Synchronizing ${queue.length} offline queued photo uploads...`);
  if (showToast) showToast(`Syncing ${queue.length} queued offline photo(s)...`, 'info');

  const remainingQueue = [];

  for (const item of queue) {
    try {
      const fileObj = dataURLtoFile(item.dataUrl, item.fileName);
      const filePath = `offline_uploads/${item.quoteId}/${Date.now()}_${item.fileName}`;
      const { error } = await uploadFileToStorage('project-photos', filePath, fileObj);

      if (error) {
        console.error('[OfflineCache] Failed to upload queued photo:', error);
        remainingQueue.push(item);
        continue;
      }

      // Get public URL from Supabase Storage
      const { data: { publicUrl } } = window.db.getSupabase().storage.from('project-photos').getPublicUrl(filePath);

      // Fetch quote and attach permanent photo URL
      const quote = await getQuoteById(item.quoteId);
      if (quote) {
        if (!quote.photos) quote.photos = [];
        // Remove temporary queued entry if present
        quote.photos = quote.photos.filter(p => p.id !== item.id);
        quote.photos.push({
          id: 'img_' + Math.random().toString(36).substr(2, 9),
          url: publicUrl,
          label: item.label,
          category: item.category
        });
        await saveQuote(quote);
      }
    } catch (err) {
      console.error('[OfflineCache] Exception during photo sync:', err);
      remainingQueue.push(item);
    }
  }

  localStorage.setItem(KEYS.PHOTO_QUEUE, JSON.stringify(remainingQueue));
  if (remainingQueue.length === 0) {
    if (showToast) showToast('Offline photo uploads synchronized successfully!', 'success');
  } else {
    if (showToast) showToast(`Synced photos. ${remainingQueue.length} photo(s) pending next connection.`, 'warning');
  }
}
