export const SchedulingEngine = {
    formatDate(date) {
        return date.toISOString().split('T')[0];
    },
    
    isWorkingDay(dateStrOrObj, projectSettings) {
        // Handle timezone issues by using local time construction if it's a string
        let date;
        if (typeof dateStrOrObj === 'string') {
            const parts = dateStrOrObj.split('-');
            date = new Date(parts[0], parts[1] - 1, parts[2]);
        } else {
            date = new Date(dateStrOrObj);
        }
        
        const dateStr = this.formatDate(new Date(date.getTime() - (date.getTimezoneOffset() * 60000)));
        
        // 1. Check custom workdays (Catch-up days)
        if (projectSettings.custom_workdays && projectSettings.custom_workdays.includes(dateStr)) {
            return true;
        }
        
        // 2. Check holidays
        if (projectSettings.holidays && projectSettings.holidays.includes(dateStr)) {
            return false;
        }
        
        // 3. Check standard weekly rules
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = days[date.getDay()];
        
        if (projectSettings.workdays && projectSettings.workdays.length > 0) {
            return projectSettings.workdays.includes(dayName);
        }
        
        // Fallback: If no explicit workdays array, check weekend_days (0=Sun, 6=Sat)
        if (projectSettings.weekend_days && projectSettings.weekend_days.includes(date.getDay())) {
            return false;
        }
        
        // Default to true if not explicitly excluded
        return true;
    },
    
    addWorkingDays(startDateStrOrObj, daysToAdd, projectSettings) {
        let date;
        if (typeof startDateStrOrObj === 'string') {
            const parts = startDateStrOrObj.split('-');
            date = new Date(parts[0], parts[1] - 1, parts[2]);
        } else {
            date = new Date(startDateStrOrObj);
        }
        
        // If the start date itself is not a working day, advance it to the next working day first
        while (!this.isWorkingDay(date, projectSettings)) {
            date.setDate(date.getDate() + 1);
        }
        
        let added = 0;
        while (added < daysToAdd) {
            date.setDate(date.getDate() + 1);
            if (this.isWorkingDay(date, projectSettings)) {
                added++;
            }
        }
        
        return date;
    },
    
    cascadeSchedule(tasks, projectSettings, projectStartDate) {
        const taskMap = {};
        tasks.forEach(t => taskMap[t.id] = t);
        
        let changed = true;
        let maxIterations = tasks.length * 2; 
        let iterations = 0;
        
        while (changed && iterations < maxIterations) {
            changed = false;
            iterations++;
            
            tasks.forEach(task => {
                let targetStartDate;
                if (typeof projectStartDate === 'string') {
                    const parts = projectStartDate.split('-');
                    targetStartDate = new Date(parts[0], parts[1] - 1, parts[2]);
                } else {
                    targetStartDate = new Date(projectStartDate);
                }
                
                // 1. Resolve Target Date based on Predecessors
                if (task.dependencies && task.dependencies.length > 0) {
                    let maxPredEndDate = null;
                    task.dependencies.forEach(predId => {
                        const pred = taskMap[predId];
                        if (pred) {
                            let predEndStr = pred.end_date || pred.calculated_end_date;
                            if (predEndStr) {
                                const parts = predEndStr.split('-');
                                const predEnd = new Date(parts[0], parts[1] - 1, parts[2]);
                                if (!maxPredEndDate || predEnd > maxPredEndDate) {
                                    maxPredEndDate = predEnd;
                                }
                            }
                        }
                    });
                    
                    if (maxPredEndDate) {
                        targetStartDate = this.addWorkingDays(maxPredEndDate, 1, projectSettings);
                    }
                }
                
                // 2. Apply Firm Constraint
                if (task.start_date) {
                    const parts = task.start_date.split('-');
                    const firmDate = new Date(parts[0], parts[1] - 1, parts[2]);
                    if (firmDate > targetStartDate) {
                        targetStartDate = firmDate;
                    }
                }
                
                // 3. Ensure start date is a working day
                while (!this.isWorkingDay(targetStartDate, projectSettings)) {
                    targetStartDate.setDate(targetStartDate.getDate() + 1);
                }
                
                const localOffset = targetStartDate.getTimezoneOffset() * 60000;
                const formattedStart = this.formatDate(new Date(targetStartDate.getTime() - localOffset));
                
                // 4. Calculate End Date
                const durationDays = task.duration > 0 ? task.duration : 1;
                const targetEndDate = this.addWorkingDays(targetStartDate, durationDays - 1, projectSettings);
                
                const endLocalOffset = targetEndDate.getTimezoneOffset() * 60000;
                const formattedEnd = this.formatDate(new Date(targetEndDate.getTime() - endLocalOffset));
                
                // Update and check if changed
                if (task.calculated_start_date !== formattedStart || task.calculated_end_date !== formattedEnd) {
                    task.calculated_start_date = formattedStart;
                    task.calculated_end_date = formattedEnd;
                    changed = true;
                }
            });
        }
        
        return tasks;
    }
};

window.SchedulingEngine = SchedulingEngine;
