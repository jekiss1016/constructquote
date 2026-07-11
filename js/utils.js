// Helper and Utility Functions

// Formats a number to USD currency (e.g. $1,245.50)
export function formatCurrency(amount) {
  const numericVal = parseFloat(amount);
  if (isNaN(numericVal)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(numericVal);
}

// Formats date string (YYYY-MM-DD) into readable formats (e.g., June 29, 2026)
export function formatDate(dateString) {
  if (!dateString) return 'N/A';
  
  // If strictly YYYY-MM-DD (e.g. from DB date columns), parse without timezone shifts
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString.trim())) {
    const parts = dateString.split('-');
    return `${parts[1]}/${parts[2]}/${parts[0]}`;
  }
  
  // Fallback or full ISO strings: convert to user's local PC timezone
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

// Converts a File object (uploaded image) to a Base64 string
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

// Toast Notification System
export function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  // Set icon based on type
  let icon = '';
  if (type === 'success') {
    icon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20" style="color: var(--success); flex-shrink: 0;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
  } else if (type === 'danger') {
    icon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20" style="color: var(--danger); flex-shrink: 0;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
  } else if (type === 'warning') {
    icon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20" style="color: var(--warning); flex-shrink: 0;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`;
  }

  toast.innerHTML = `
    ${icon}
    <div style="flex-grow: 1;">${message}</div>
  `;

  container.appendChild(toast);

  // Trigger exit animation before removing
  setTimeout(() => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 3500);
}

// Generate unique Job ID suggestions (e.g. JOB-2026-101)
export function generateJobIdSuggestion() {
  const year = new Date().getFullYear();
  const randNum = Math.floor(1000 + Math.random() * 9000);
  return `JOB-${year}-${randNum}`;
}

// Formats an ISO date-time string into readable format (e.g., 06/30/2026 10:45 AM)
export function formatDateTime(isoString) {
  if (!isoString) return 'N/A';
  
  let dateString = isoString;
  // If date-only format (YYYY-MM-DD), treat as local midnight so timezone shifts do not alter the date
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoString.trim())) {
    dateString = `${isoString.trim()}T00:00:00`;
  }
  
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return isoString;
  
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 hour should be 12
  const hh = String(hours).padStart(2, '0');
  
  return `${mm}/${dd}/${yyyy} ${hh}:${minutes} ${ampm}`;
}

// Compress image using HTML5 Canvas to fit storage boundaries
export function compressImage(base64Str, maxWidth = 600, maxHeight = 600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.70);
      resolve(compressedBase64);
    };
    img.onerror = (err) => reject(err);
  });
}

// Formats a phone number string to (xxx) xxx-xxxx mask
export function formatPhoneNumber(value) {
  if (!value) return '';
  const clean = value.replace(/\D/g, '').slice(0, 10);
  const match = clean.match(/^(\d{0,3})(\d{0,3})(\d{0,4})$/);
  if (!match) return value;
  let part1 = match[1];
  let part2 = match[2];
  let part3 = match[3];
  
  if (clean.length === 0) {
    return '';
  }
  if (clean.length <= 3) {
    return part1;
  }
  if (clean.length <= 6) {
    return `(${part1}) ${part2}`;
  }
  return `(${part1}) ${part2}-${part3}`;
}

export function parseCombinedAddress(addrStr) {
  if (!addrStr) return { street: '', city: '', state: '', zip: '' };
  
  const normalized = addrStr.replace(/\r?\n/g, ', ');
  const parts = normalized.split(',').map(p => p.trim()).filter(Boolean);
  
  let street = '';
  let city = '';
  let state = '';
  let zip = '';

  if (parts.length >= 3) {
    street = parts[0];
    city = parts[1];
    const stateZipPart = parts[2];
    const stateZipMatch = stateZipPart.match(/^([A-Z]{2})\s+(\d{5})$/i) || stateZipPart.match(/^([A-Z]{2})$/i) || stateZipPart.match(/^(\d{5})$/);
    if (stateZipMatch) {
      state = stateZipMatch[1] || '';
      zip = stateZipMatch[2] || '';
    }
  } else if (parts.length === 2) {
    const firstPart = parts[0];
    const camelCaseMatch = firstPart.match(/([a-z])([A-Z])/);
    if (camelCaseMatch) {
      const splitIdx = camelCaseMatch.index + 1;
      street = firstPart.substring(0, splitIdx).trim();
      city = firstPart.substring(splitIdx).trim();
    } else {
      street = firstPart;
      city = '';
    }
    
    const stateZipPart = parts[1];
    const stateZipMatch = stateZipPart.match(/^([A-Z]{2})\s+(\d{5})$/i) || stateZipPart.match(/^([A-Z]{2})$/i) || stateZipPart.match(/^(\d{5})$/);
    if (stateZipMatch) {
      state = stateZipMatch[1] || '';
      zip = stateZipMatch[2] || '';
    }
  } else {
    street = addrStr;
  }

  if (street && !city) {
    const camelCaseMatch = street.match(/([a-z])([A-Z])/);
    if (camelCaseMatch) {
      const splitIdx = camelCaseMatch.index + 1;
      city = street.substring(splitIdx).trim();
      street = street.substring(0, splitIdx).trim();
    }
  }

  return { street, city, state, zip };
}
