import * as db from './db.js?v=3.0.3';
import * as utils from './utils.js?v=3.0.3';
import { SchedulingEngine } from './scheduling-engine.js?v=3.0.3';

let schedules = [];
let companySettings = null;
let currentSchedulingConfig = null;

export async function initSchedulingView() {
    console.log("Initializing scheduling view...");
    const profile = db.getCurrentUserProfile();
    if (!profile) return;

    // Permissions check
    const isViewer = profile.role === 'viewer';
    if (isViewer) {
        // Viewers should not see action buttons
        const actionHeader = document.querySelector('#scheduling-table th:last-child');
        if (actionHeader) actionHeader.style.display = 'none';
        
        const templateBtn = document.getElementById('scheduling-templates-btn');
        if (templateBtn) templateBtn.style.display = 'none';
    }

    await loadSchedules();
    companySettings = await db.getSettings();
    currentSchedulingConfig = companySettings.schedulingConfig || {
        workdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        weekend_days: [0, 6],
        holidays: [],
        custom_workdays: []
    };
    
    renderSchedulesTable('active');
    
    // Also load templates if possible
    window.loadTemplates();
}

// Global setup for tab listeners (run once)
document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('#scheduling-status-tabs .filter-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            tabs.forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            renderSchedulesTable(e.target.dataset.status);
        });
    });

    const templateBtn = document.getElementById('scheduling-templates-btn');
    if (templateBtn) {
        templateBtn.addEventListener('click', () => {
            const activeSec = document.querySelector('.view-section.active');
            if (activeSec) activeSec.classList.remove('active');
            document.getElementById('template-view').classList.add('active');
            window.scrollTo(0, 0);
        });
    }
});

async function loadSchedules() {
    // In a real DB scenario, we fetch project_schedules joined with quotes
    // For now, we will fetch 'Won' quotes and mock schedules if they don't exist
    try {
        const quotes = await window.db.getQuotes(); // fetch all active quotes
        const wonQuotes = quotes.filter(q => q.status.toLowerCase() === 'won' || q.status.toLowerCase() === 'completed');
        
        // Mock schedules for now
        schedules = wonQuotes.map(q => {
            let sub = 0;
            if (q.sections && Array.isArray(q.sections)) {
                q.sections.forEach(sec => {
                    if (sec.items && Array.isArray(sec.items)) {
                        sec.items.forEach(item => { 
                            sub += (item.qty * (item.price + (item.laborRate || 0))) || 0; 
                        });
                    }
                });
            }
            const markupVal = sub * (q.markupPercent / 100) || 0;
            const taxVal = q.taxPlusApplicable ? 0 : (sub + markupVal) * ((q.taxRate || 0) / 100);
            const total = sub + markupVal + taxVal;

            return {
                id: 'SCH-' + q.id,
                quote_id: q.id,
                job_id: q.jobId || 'Unknown',
                customer_name: q.customerName || 'Unknown',
                total: total,
                start_date: null,
                end_date: null,
                status: 'Not Scheduled',
                scheduleTasks: q.scheduleTasks || []
            };
        });
    } catch (e) {
        console.error("Failed to load schedules:", e);
        utils.showToast("Error loading schedules: " + e.message, "danger");
    }
}

function renderSchedulesTable(filterStatus) {
    const tbody = document.getElementById('scheduling-table-body');
    const profile = db.getCurrentUserProfile();
    const isViewer = profile && profile.role === 'viewer';
    
    tbody.innerHTML = '';
    
    let filtered = schedules;
    if (filterStatus === 'active') {
        filtered = schedules.filter(s => s.status !== 'Completed');
    } else {
        filtered = schedules.filter(s => s.status === 'Completed');
    }

    if (filtered.length === 0) {
        const colSpan = isViewer ? 6 : 7;
        tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; color: var(--text-muted); padding: 2rem;">No ${filterStatus} schedules found.</td></tr>`;
        return;
    }

    filtered.forEach(sch => {
        const tr = document.createElement('tr');
        
        let statusBadge = '';
        if (sch.status === 'Not Scheduled') statusBadge = '<span class="badge badge-pending">Not Scheduled</span>';
        else if (sch.status === 'In Progress') statusBadge = '<span class="badge badge-active">In Progress</span>';
        else if (sch.status === 'Completed') statusBadge = '<span class="badge badge-won">Completed</span>';
        else statusBadge = `<span class="badge badge-default">${sch.status}</span>`;
        
        let actionCell = '';
        if (!isViewer) {
            actionCell = `<td style="text-align: right;"><button class="btn btn-sm btn-secondary" onclick="window.viewSchedule('${sch.id}')">Manage</button></td>`;
        }
        
        tr.innerHTML = `
            <td><strong>${sch.job_id}</strong></td>
            <td>${sch.customer_name}</td>
            <td>${utils.formatCurrency(sch.total)}</td>
            <td>${sch.start_date || '--'}</td>
            <td>${sch.end_date || '--'}</td>
            <td>${statusBadge}</td>
            ${actionCell}
        `;
        tbody.appendChild(tr);
    });
}

// Global expose for inline onclicks (will refactor later)
let activeScheduleId = null;
let currentTasks = [];
let ganttStartDate = null;
let ganttEndDate = null;

window.viewSchedule = function(id) {
    activeScheduleId = id;
    
    // Switch views
    document.getElementById('scheduling-view').classList.remove('active');
    const ganttView = document.getElementById('gantt-view');
    ganttView.classList.add('active');
    window.scrollTo(0, 0);
    
    const sch = schedules.find(s => s.id === id);
    if (!sch) return;
    
    document.getElementById('gantt-project-title').innerText = `${sch.customer_name} - ${sch.job_id}`;
    
    // Load real tasks from the quote object
    currentTasks = sch.scheduleTasks || [];
    
    // If empty, we can just render an empty chart
    if (currentTasks.length > 0) {
        // Cascade to ensure dates are fresh based on current settings
        const todayStr = SchedulingEngine.formatDate(new Date());
        SchedulingEngine.cascadeSchedule(currentTasks, currentSchedulingConfig, todayStr);
    }
    
    renderGanttChart(currentTasks);
};

function renderGanttChart(tasks) {
    const gridContainer = document.getElementById('gantt-grid-container');
    const dateRangeLabel = document.getElementById('gantt-date-range');
    gridContainer.innerHTML = '';
    
    if (tasks.length === 0) return;
    
    // Find min start and max end
    let minDate = new Date(tasks[0].start_date || tasks[0].calculated_start_date);
    let maxDate = new Date(tasks[0].end_date || tasks[0].calculated_end_date);
    
    tasks.forEach(t => {
        let tStart = new Date(t.start_date || t.calculated_start_date);
        let tEnd = new Date(t.end_date || t.calculated_end_date);
        if (tStart < minDate) minDate = tStart;
        if (tEnd > maxDate) maxDate = tEnd;
    });
    
    // Add 2 days padding on either side
    minDate.setDate(minDate.getDate() - 2);
    maxDate.setDate(maxDate.getDate() + 2);
    
    ganttStartDate = minDate;
    ganttEndDate = maxDate;
    
    dateRangeLabel.innerText = `${SchedulingEngine.formatDate(minDate)}  to  ${SchedulingEngine.formatDate(maxDate)}`;
    
    // Calculate total days
    const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;
    
    // Setup grid columns
    gridContainer.style.gridTemplateColumns = `repeat(${totalDays}, minmax(40px, 1fr))`;
    
    // Render Date Headers
    let headerHtml = '<div class="gantt-date-header">';
    for (let i = 0; i < totalDays; i++) {
        const d = new Date(minDate);
        d.setDate(d.getDate() + i);
        const dayStr = d.toLocaleDateString('en-US', { weekday: 'short' });
        const dateStr = d.getDate();
        
        let color = 'inherit';
        if (d.getDay() === 0 || d.getDay() === 6) color = 'var(--warning)'; // Weekend visual indicator
        
        headerHtml += `<div class="gantt-date-cell" style="color: ${color};">${dayStr}<br>${dateStr}</div>`;
    }
    headerHtml += '</div>';
    gridContainer.insertAdjacentHTML('beforeend', headerHtml);
    
    // Render Task Rows
    let allCompleted = true;
    
    tasks.forEach(task => {
        if (task.status !== 'Completed') allCompleted = false;
        
        let startStr = task.start_date || task.calculated_start_date;
        let endStr = task.end_date || task.calculated_end_date;
        
        let tStart = new Date(startStr);
        let tEnd = new Date(endStr);
        
        // Find column indexes
        const startCol = Math.floor((tStart - minDate) / (1000 * 60 * 60 * 24)) + 1;
        const endCol = Math.floor((tEnd - minDate) / (1000 * 60 * 60 * 24)) + 2; // +2 because we want it to span the day
        
        let taskClass = '';
        if (task.status === 'Completed') taskClass = 'completed';
        else if (task.is_no_dependency) taskClass = 'no-dependency';
        
        const durationCols = Math.max(1, Math.floor((tEnd - tStart) / (1000 * 60 * 60 * 24)) + 1);
        
        gridContainer.insertAdjacentHTML('beforeend', `<div class="gantt-bar-container" style="grid-column: ${startCol} / span ${durationCols};" onclick="window.ganttOpenEditTask(${task.id})">
            <div class="gantt-bar ${task.status.toLowerCase().replace(' ', '-')}">
                <span class="gantt-bar-title">${task.title}</span>
                <span class="gantt-bar-duration">${task.duration}d</span>
            </div>
        </div>`);
    });
    
    // Show Complete button or modal if everything is done
    const completeBtn = document.getElementById('gantt-complete-job-btn');
    if (allCompleted) {
        completeBtn.style.display = 'inline-block';
        document.getElementById('completion-modal').classList.add('active');
    } else {
        completeBtn.style.display = 'none';
        document.getElementById('completion-modal').classList.remove('active');
    }
}

window.toggleTaskStatus = function(taskId) {
    const task = currentTasks.find(t => t.id === taskId);
    if (!task) return;
    
    if (task.status === 'Completed') {
        task.status = 'Pending';
    } else if (task.status === 'In Progress') {
        task.status = 'Completed';
    } else {
        task.status = 'In Progress';
    }
    
    renderGanttChart(currentTasks);
};

// Bind Completion Confirm Button
document.addEventListener('DOMContentLoaded', () => {
    const confirmBtn = document.getElementById('confirm-job-completion-btn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            utils.showToast("Job officially marked as Completed!");
            document.getElementById('completion-modal').classList.remove('active');
            
            // Mark the active schedule as completed
            const sch = schedules.find(s => s.id === activeScheduleId);
            if (sch) sch.status = 'Completed';
            
            document.getElementById('gantt-view').classList.remove('active');
            document.getElementById('scheduling-view').classList.add('active');
            
            // Auto switch to completed tab
            document.querySelector('.filter-tab[data-status="completed"]').click();
        });
    }
});

// ==========================================
// TEMPLATE BUILDER LOGIC
// ==========================================
let templateTaskCount = 0;
let currentTemplates = [];
let currentEditingTemplateId = null;

window.showCreateTemplate = function() {
    currentEditingTemplateId = null;
    document.getElementById('template-name-input').value = '';
    document.getElementById('template-tasks-container').innerHTML = '';
    window.addTemplateTaskRow();
    document.getElementById('template-list-view').style.display = 'none';
    document.getElementById('template-editor-view').style.display = 'block';
};

window.addTemplateTaskRow = function(task = null) {
    templateTaskCount++;
    const container = document.getElementById('template-tasks-container');
    const rowId = `task-row-${templateTaskCount}`;
    
    const row = document.createElement('div');
    row.id = rowId;
    row.style = "display: flex; gap: 0.5rem; align-items: flex-end; background: var(--bg-tertiary); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);";
    
    row.innerHTML = `
        <div style="display: flex; flex-direction: column; justify-content: center; margin-right: 0.5rem; gap: 0.2rem;">
            <button type="button" class="btn-icon" style="padding: 2px; margin: 0; color: var(--text-secondary);" onclick="window.moveTemplateTaskUp('${rowId}')" title="Move Up">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
            </button>
            <button type="button" class="btn-icon" style="padding: 2px; margin: 0; color: var(--text-secondary);" onclick="window.moveTemplateTaskDown('${rowId}')" title="Move Down">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
            </button>
        </div>
        <div style="flex: 2;">
            <label style="font-size: 0.75rem; color: var(--text-secondary); display:block; margin-bottom: 0.25rem;">Task Name</label>
            <input type="text" class="search-input template-task-name" style="width: 100%; border: 1px solid var(--border-color); padding: 0.35rem;" placeholder="e.g. Foundation" value="${task ? (task.title || '').replace(/"/g, '&quot;') : ''}">
        </div>
        <div style="flex: 1;">
            <label style="font-size: 0.75rem; color: var(--text-secondary); display:block; margin-bottom: 0.25rem;">Days (Duration)</label>
            <input type="number" class="search-input template-task-duration" style="width: 100%; border: 1px solid var(--border-color); padding: 0.35rem;" value="${task ? (task.duration || 1) : 1}" min="1">
        </div>
        <div style="flex: 1.5; display: flex; flex-direction: column; justify-content: center; gap: 0.25rem;">
            <div style="display: flex; align-items: center; gap: 0.25rem;">
                <input type="checkbox" class="template-task-nodep" id="nodep-${templateTaskCount}" onchange="window.updateDependencyLabels()" ${task && task.is_no_dependency ? 'checked' : ''}>
                <label for="nodep-${templateTaskCount}" style="font-size: 0.8rem; margin: 0; cursor: pointer;">No Dependency</label>
            </div>
            <div class="dependency-label" style="font-size: 0.75rem; color: var(--primary);"></div>
        </div>
        <button type="button" class="btn-icon" style="color: var(--danger); margin-bottom: 0.25rem;" onclick="document.getElementById('${rowId}').remove(); window.updateDependencyLabels();">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="18" height="18">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
        </button>
    `;
    
    container.appendChild(row);
    
    // Add event listener to name input to live-update labels
    row.querySelector('.template-task-name').addEventListener('input', window.updateDependencyLabels);
    
    window.updateDependencyLabels();
};

window.updateDependencyLabels = function() {
    const taskRows = document.querySelectorAll('#template-tasks-container > div');
    
    taskRows.forEach((row, index) => {
        const noDepCheckbox = row.querySelector('.template-task-nodep');
        const depLabel = row.querySelector('.dependency-label');
        
        // The first task can never have a dependency
        if (index === 0) {
            noDepCheckbox.checked = true;
            noDepCheckbox.disabled = true;
            depLabel.textContent = "Starts Project";
            return;
        } else {
            noDepCheckbox.disabled = false;
        }
        
        if (noDepCheckbox.checked) {
            depLabel.textContent = "Concurrent Task";
        } else {
            const prevRow = taskRows[index - 1];
            const prevName = prevRow.querySelector('.template-task-name').value.trim() || ("Task " + index);
            depLabel.textContent = "Dependent on: " + prevName;
        }
    });
};

window.saveTemplate = function() {
    const nameInput = document.getElementById('template-name-input');
    const name = nameInput.value.trim();
    
    if (!name) {
        utils.showToast("Please enter a template name.", "warning");
        return;
    }
    
    const taskRows = document.querySelectorAll('#template-tasks-container > div');
    if (taskRows.length === 0) {
        utils.showToast("Please add at least one task.", "warning");
        return;
    }
    
    const tasks = [];
    let isValid = true;
    
    taskRows.forEach((row, index) => {
        const tName = row.querySelector('.template-task-name').value.trim();
        const tDur = parseInt(row.querySelector('.template-task-duration').value, 10);
        const tNoDep = row.querySelector('.template-task-nodep').checked;
        
        if (!tName) isValid = false;
        
        tasks.push({
            id: index + 1,
            title: tName,
            duration: tDur || 1,
            is_no_dependency: tNoDep,
            // Assuming linear dependencies by default if not checked
            dependencies: tNoDep || index === 0 ? [] : [index]
        });
    });
    
    if (!isValid) {
        utils.showToast("All tasks must have a name.", "warning");
        return;
    }
    
    // Add to DB
    const payload = { name, tasks };
    if (currentEditingTemplateId) payload.id = currentEditingTemplateId;
    
    db.saveScheduleTemplate(payload).then(res => {
        if (res.success) {
            utils.showToast("Template saved successfully!", "success");
            window.loadTemplates();
            // Reset view
            nameInput.value = '';
            document.getElementById('template-tasks-container').innerHTML = '';
            document.getElementById('template-editor-view').style.display = 'none';
            document.getElementById('template-list-view').style.display = 'block';
        } else {
            utils.showToast(res.error, "danger");
        }
    }).catch(e => utils.showToast(e.message, "danger"));
};

window.loadTemplates = async function() {
    const tableBody = document.getElementById('templates-table-body');
    currentTemplates = await db.getScheduleTemplates();
    
    if (!currentTemplates || currentTemplates.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No templates configured.</td></tr>';
        return;
    }
    
    tableBody.innerHTML = currentTemplates.map(t => `
        <tr>
            <td><strong>${t.name}</strong></td>
            <td>${(t.tasks && t.tasks.length) || 0} Tasks</td>
            <td style="text-align:right;">
                <button class="btn btn-sm btn-secondary" style="margin-right:0.25rem;" onclick="window.editTemplate('${t.id}')">Edit</button>
                <button class="btn btn-sm btn-secondary" onclick="alert('Apply template function coming soon!')">Apply</button>
            </td>
        </tr>
    `).join('');
};

window.editTemplate = function(id) {
    const t = currentTemplates.find(x => x.id === id);
    if (!t) return;
    
    currentEditingTemplateId = id;
    document.getElementById('template-name-input').value = t.name;
    document.getElementById('template-tasks-container').innerHTML = '';
    
    if (t.tasks && t.tasks.length > 0) {
        t.tasks.forEach(task => window.addTemplateTaskRow(task));
    } else {
        window.addTemplateTaskRow();
    }
    
    document.getElementById('template-list-view').style.display = 'none';
    document.getElementById('template-editor-view').style.display = 'block';
};

window.moveTemplateTaskUp = function(rowId) {
    const row = document.getElementById(rowId);
    if (row && row.previousElementSibling) {
        row.parentNode.insertBefore(row, row.previousElementSibling);
        window.updateDependencyLabels();
    }
};

window.moveTemplateTaskDown = function(rowId) {
    const row = document.getElementById(rowId);
    if (row && row.nextElementSibling) {
        row.parentNode.insertBefore(row.nextElementSibling, row);
        window.updateDependencyLabels();
    }
};

// ==========================================
// SCHEDULE SETTINGS MODAL LOGIC
// ==========================================
window.openScheduleSettings = function() {
    const config = currentSchedulingConfig || { workdays: [], weekend_days: [0, 6], holidays: [], custom_workdays: [] };
    
    // Render Workdays Checkboxes
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const workdaysHtml = days.map(day => `
        <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.85rem; cursor:pointer;">
            <input type="checkbox" class="settings-workday-cb" value="${day}" ${config.workdays.includes(day) ? 'checked' : ''}>
            ${day}
        </label>
    `).join('');
    document.getElementById('scheduling-workdays-container').innerHTML = workdaysHtml;
    
    // Render Holidays
    window.renderScheduleList('scheduling-holidays-list', config.holidays, 'removeScheduleHoliday');
    
    // Render Custom Workdays
    window.renderScheduleList('scheduling-custom-workdays-list', config.custom_workdays, 'removeScheduleCustomWorkday');
    
    // Hide all view sections and show settings
    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    document.getElementById('scheduling-settings-view').classList.add('active');
    window.scrollTo(0, 0);
};

window.renderScheduleList = function(containerId, items, removeFnName) {
    const container = document.getElementById(containerId);
    if (!items || items.length === 0) {
        container.innerHTML = '<span style="font-size:0.8rem; color:var(--text-muted); font-style:italic;">None defined</span>';
        return;
    }
    container.innerHTML = items.sort().map(item => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-secondary); padding:0.25rem 0.5rem; border-radius:var(--radius-sm); border:1px solid var(--border-color);">
            <span style="font-size:0.85rem; font-family:monospace;">${item}</span>
            <button class="btn-icon" style="color:var(--danger);" onclick="window.${removeFnName}('${item}')">&times;</button>
        </div>
    `).join('');
};

window.addScheduleHoliday = function() {
    const dateInput = document.getElementById('scheduling-add-holiday-date');
    if (!dateInput.value) return utils.showToast('Please select a date', 'warning');
    if (!currentSchedulingConfig.holidays.includes(dateInput.value)) {
        currentSchedulingConfig.holidays.push(dateInput.value);
        window.renderScheduleList('scheduling-holidays-list', currentSchedulingConfig.holidays, 'removeScheduleHoliday');
    }
    dateInput.value = '';
};

window.removeScheduleHoliday = function(dateStr) {
    currentSchedulingConfig.holidays = currentSchedulingConfig.holidays.filter(d => d !== dateStr);
    window.renderScheduleList('scheduling-holidays-list', currentSchedulingConfig.holidays, 'removeScheduleHoliday');
};

window.addScheduleCustomWorkday = function() {
    const dateInput = document.getElementById('scheduling-add-custom-workday-date');
    if (!dateInput.value) return utils.showToast('Please select a date', 'warning');
    if (!currentSchedulingConfig.custom_workdays.includes(dateInput.value)) {
        currentSchedulingConfig.custom_workdays.push(dateInput.value);
        window.renderScheduleList('scheduling-custom-workdays-list', currentSchedulingConfig.custom_workdays, 'removeScheduleCustomWorkday');
    }
    dateInput.value = '';
};

window.removeScheduleCustomWorkday = function(dateStr) {
    currentSchedulingConfig.custom_workdays = currentSchedulingConfig.custom_workdays.filter(d => d !== dateStr);
    window.renderScheduleList('scheduling-custom-workdays-list', currentSchedulingConfig.custom_workdays, 'removeScheduleCustomWorkday');
};

// Make sure this is bound to DB save
async function saveScheduleToDB() {
    if (!activeScheduleId) return;
    const sch = schedules.find(s => s.id === activeScheduleId);
    if (!sch || !sch.quote_id) return;
    
    const res = await window.db.updateQuoteSchedule(sch.quote_id, currentTasks);
    if (!res.success) {
        utils.showToast(res.error, 'danger');
    } else {
        // Also update local memory so going back preserves it
        sch.scheduleTasks = currentTasks;
    }
}

// ==================== GANTT ADD TASK ====================
document.getElementById('gantt-add-task-btn').addEventListener('click', () => {
    const depSelect = document.getElementById('gantt-add-dependency');
    depSelect.innerHTML = '<option value="">None (Independent Task)</option>';
    currentTasks.forEach(t => {
        depSelect.innerHTML += `<option value="${t.id}">${t.title}</option>`;
    });
    document.getElementById('gantt-add-name').value = '';
    document.getElementById('gantt-add-duration').value = '1';
    document.getElementById('gantt-add-start-date').value = '';
    document.getElementById('gantt-add-task-modal').classList.add('active');
});

document.getElementById('gantt-add-task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('gantt-add-name').value;
    const duration = parseInt(document.getElementById('gantt-add-duration').value) || 1;
    const depId = document.getElementById('gantt-add-dependency').value;
    const startDateOverride = document.getElementById('gantt-add-start-date').value;
    
    if (startDateOverride) {
        const parts = startDateOverride.split('-');
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        if (!SchedulingEngine.isWorkingDay(dateObj, currentSchedulingConfig)) {
            utils.showToast("The selected start date is a non-working day. Please select a valid working day or add a custom workday exception in Schedule Settings.", "warning");
            return;
        }
    }
    
    const newTask = {
        id: Date.now(),
        title: name,
        duration: duration,
        status: 'Pending',
        dependencies: depId ? [parseInt(depId)] : [],
        start_date: startDateOverride ? startDateOverride : null
    };
    
    currentTasks.push(newTask);
    document.getElementById('gantt-add-task-modal').classList.remove('active');
    
    const todayStr = SchedulingEngine.formatDate(new Date());
    SchedulingEngine.cascadeSchedule(currentTasks, currentSchedulingConfig, todayStr);
    renderGanttChart(currentTasks);
    await saveScheduleToDB();
});

// ==================== GANTT EDIT TASK ====================
window.ganttOpenEditTask = function(taskId) {
    const task = currentTasks.find(t => t.id === taskId);
    if (!task) return;
    
    document.getElementById('gantt-edit-id').value = task.id;
    document.getElementById('gantt-edit-name').value = task.title;
    document.getElementById('gantt-edit-status').value = task.status;
    document.getElementById('gantt-edit-duration').value = task.duration;
    document.getElementById('gantt-edit-start-date').value = task.start_date || '';
    
    const depSelect = document.getElementById('gantt-edit-dependency');
    depSelect.innerHTML = '<option value="">None (Independent Task)</option>';
    currentTasks.forEach(t => {
        if (t.id !== task.id) { // Cannot depend on self
            const selected = (task.dependencies && task.dependencies.includes(t.id)) ? 'selected' : '';
            depSelect.innerHTML += `<option value="${t.id}" ${selected}>${t.title}</option>`;
        }
    });
    
    document.getElementById('gantt-edit-task-modal').classList.add('active');
};

document.getElementById('gantt-edit-task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = parseInt(document.getElementById('gantt-edit-id').value);
    const task = currentTasks.find(t => t.id === id);
    if (!task) return;
    
    task.title = document.getElementById('gantt-edit-name').value;
    task.status = document.getElementById('gantt-edit-status').value;
    task.duration = parseInt(document.getElementById('gantt-edit-duration').value) || 1;
    
    const depId = document.getElementById('gantt-edit-dependency').value;
    task.dependencies = depId ? [parseInt(depId)] : [];
    
    const overrideStart = document.getElementById('gantt-edit-start-date').value;
    
    if (overrideStart) {
        const parts = overrideStart.split('-');
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        if (!SchedulingEngine.isWorkingDay(dateObj, currentSchedulingConfig)) {
            utils.showToast("The selected start date is a non-working day. Please select a valid working day or add a custom workday exception in Schedule Settings.", "warning");
            return;
        }
    }
    
    task.start_date = overrideStart ? overrideStart : null;
    
    document.getElementById('gantt-edit-task-modal').classList.remove('active');
    
    const todayStr = SchedulingEngine.formatDate(new Date());
    SchedulingEngine.cascadeSchedule(currentTasks, currentSchedulingConfig, todayStr);
    renderGanttChart(currentTasks);
    await saveScheduleToDB();
});

window.ganttDeleteTask = async function() {
    const id = parseInt(document.getElementById('gantt-edit-id').value);
    // Remove task
    currentTasks = currentTasks.filter(t => t.id !== id);
    // Remove this task from other tasks' dependencies
    currentTasks.forEach(t => {
        if (t.dependencies) {
            t.dependencies = t.dependencies.filter(did => did !== id);
        }
    });
    
    document.getElementById('gantt-edit-task-modal').classList.remove('active');
    
    const todayStr = SchedulingEngine.formatDate(new Date());
    SchedulingEngine.cascadeSchedule(currentTasks, currentSchedulingConfig, todayStr);
    renderGanttChart(currentTasks);
    await saveScheduleToDB();
};

// ==================== AUTO SCHEDULE ====================
document.getElementById('gantt-auto-schedule-btn').addEventListener('click', async () => {
    if (currentTasks.length === 0) return;
    const todayStr = SchedulingEngine.formatDate(new Date());
    SchedulingEngine.cascadeSchedule(currentTasks, currentSchedulingConfig, todayStr);
    renderGanttChart(currentTasks);
    await saveScheduleToDB();
    utils.showToast('Schedule cascaded automatically!', 'success');
});

// ==================== APPLY TEMPLATE ====================
window.ganttOpenTemplateModal = async function() {
    // Load templates
    const res = await window.db.getScheduleTemplates();
    const select = document.getElementById('gantt-template-select');
    if (!res || res.length === 0) {
        select.innerHTML = '<option value="">No templates found</option>';
    } else {
        select.innerHTML = res.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    }
    document.getElementById('gantt-apply-template-modal').classList.add('active');
};

window.ganttApplySelectedTemplate = async function() {
    const templateId = document.getElementById('gantt-template-select').value;
    if (!templateId) return;
    
    const mode = document.querySelector('input[name="gantt_template_mode"]:checked').value;
    const res = await window.db.getScheduleTemplates();
    const template = res.find(t => t.id === templateId);
    if (!template || !template.tasks) return;
    
    // Duplicate tasks and generate new IDs to avoid conflicts
    const idMapping = {};
    const newTasks = template.tasks.map(t => {
        const newId = Date.now() + Math.floor(Math.random() * 10000);
        idMapping[t.id] = newId;
        return { ...t, id: newId, dependencies: [] };
    });
    
    // Remap dependencies
    template.tasks.forEach((t, index) => {
        if (t.dependencies && t.dependencies.length > 0) {
            newTasks[index].dependencies = t.dependencies.map(oldDepId => idMapping[oldDepId]).filter(id => id);
        }
    });
    
    if (mode === 'overwrite') {
        currentTasks = newTasks;
    } else {
        currentTasks = currentTasks.concat(newTasks);
    }
    
    document.getElementById('gantt-apply-template-modal').classList.remove('active');
    
    const todayStr = SchedulingEngine.formatDate(new Date());
    SchedulingEngine.cascadeSchedule(currentTasks, currentSchedulingConfig, todayStr);
    renderGanttChart(currentTasks);
    await saveScheduleToDB();
    
    utils.showToast(`Template applied!`, 'success');
};

window.saveScheduleSettings = async function() {
    // Gather checked workdays
    const checkboxes = document.querySelectorAll('.settings-workday-cb');
    const selectedWorkdays = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
    
    currentSchedulingConfig.workdays = selectedWorkdays;
    
    // Save to DB
    const res = await db.saveSettings({ schedulingConfig: currentSchedulingConfig });
    if (res.error) {
        utils.showToast(res.error.message || 'Error saving settings', 'danger');
    } else {
        utils.showToast('Schedule Settings Saved!', 'success');
        
        // Go back to scheduling view
        document.getElementById('scheduling-settings-view').classList.remove('active');
        document.getElementById('scheduling-view').classList.add('active');
        
        // Re-cascade current schedule if it's open
        if (activeScheduleId && currentTasks.length > 0) {
            window.viewSchedule(activeScheduleId);
        }
    }
};
