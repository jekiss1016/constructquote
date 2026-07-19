const fs = require('fs');
let content = fs.readFileSync('css/styles.css', 'utf8');
const idx = content.indexOf('.gantt-date-cell {');
if (idx !== -1) {
    content = content.substring(0, idx) + `.gantt-date-cell {
  background: var(--bg-tertiary);
  padding: 0.5rem 0;
  text-align: center;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
}

.gantt-task-row {
  display: contents;
}

.gantt-bar-container {
  /* position is determined by CSS grid column inline style */
  position: relative;
  padding: 4px 2px;
  height: 40px;
  box-sizing: border-box;
}

.gantt-bar {
  height: 100%;
  width: 100%;
  background: linear-gradient(135deg, var(--primary), var(--primary-dark));
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: center;
  padding: 0 0.5rem;
  color: white;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast), filter var(--transition-fast);
  cursor: pointer;
  box-sizing: border-box;
}

.gantt-bar:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  filter: brightness(1.1);
}

.gantt-bar-title {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.gantt-bar-duration {
  font-size: 0.7rem;
  opacity: 0.8;
  margin-left: 0.5rem;
}

.gantt-bar.pending {
  background: linear-gradient(135deg, var(--primary), var(--primary-dark));
}

.gantt-bar.in-progress {
  background: linear-gradient(135deg, var(--warning), #d97706);
}

.gantt-bar.completed {
  background: linear-gradient(135deg, var(--success), var(--success-dark));
}

.gantt-bar.no-dependency {
  background: linear-gradient(135deg, var(--warning), #d97706);
}

/* Completion Modal Specific */
.completion-modal-content {
  text-align: center;
  padding: 3rem 2rem;
}

.completion-icon-wrapper {
  width: 80px;
  height: 80px;
  background: var(--success-light);
  color: var(--success);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1.5rem;
  animation: bounceScale 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.completion-icon-wrapper svg {
  width: 40px;
  height: 40px;
}

@keyframes bounceScale {
  0% { transform: scale(0); }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); }
}

.completion-title {
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.completion-text {
  color: var(--text-secondary);
  margin-bottom: 2rem;
  font-size: 1.05rem;
}
`;
    fs.writeFileSync('css/styles.css', content, 'utf8');
    console.log('Fixed styles.css');
}
