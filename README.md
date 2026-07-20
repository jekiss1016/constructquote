# MyBidBook Application Overview

**MyBidBook** is a comprehensive, cloud-connected construction quoting and project management platform. Designed specifically for contractors, it streamlines the entire estimation process—from initial client contact to generating professional PDF proposals and tracking project schedules.

The application is built as a **Progressive Web App (PWA)**, meaning it works flawlessly across desktops, tablets, and smartphones. It supports robust offline capabilities, allowing contractors to access their catalogs and quote histories directly from remote job sites even when an internet connection is unavailable.

## Core Features & Modules

### 1. Authentication & Security
- **Supabase Integration**: Secure, cloud-based tenant isolation ensuring contractor data is completely private.
- **Contractor Trial & Pro Subscriptions**: Automated trial tiers that limit accounts to 10 watermarked quotes until they upgrade to a Pro license.
- **Multi-Factor Authentication (MFA)**: Support for Time-based One-Time Passwords (TOTP) to secure user logins.
- **Terms of Service**: Built-in compliance checks during user registration.

### 2. Dashboard & Analytics
- Provides a high-level overview of active quotes, upcoming tasks, and quick-access shortcuts.
- Fully responsive design that collapses into mobile-friendly vertical cards on smaller screens.

### 3. Quote Builder & Management
- **Smart Estimation Engine**: Dynamic calculation logic for material quantities, labor hours, taxes, and margins.
- **Quote Versioning**: Safe tracking of quote modifications. Pricing updates explicitly trigger new versions rather than overwriting historical data.
- **Print-to-PDF**: Beautiful, customizable quote templates featuring the contractor's company branding, logo, and terms.
- **Watermarking**: Automatic document watermarking for trial users.

### 4. Product Catalog
- A centralized database for contractors to manage their materials, labor rates, and custom items.
- Supports local caching for immediate offline availability.

### 5. Customer Manager
- A dedicated CRM module for tracking client details, developers, and project sites.
- **Proposal History**: Displays a timeline of all past and active proposals linked to specific clients.
- **Custom Email Templates**: Set global or client-specific default email body texts when sending quotes directly from the app.

### 6. Project Scheduling & Gantt Charts
- **Task Dependencies**: Chain tasks together with strict start/completion date enforcements.
- **Global Schedule View**: A unified, paginated 15-day Gantt chart aggregating tasks from *all* active projects, helping management identify overlaps and crunches.
- **Historical Locking**: Once a project is marked "Completed," the tasks are permanently locked to preserve the historical record.

### 7. PWA & Offline Support
- Installable directly to the home screen on Windows, Android, and iOS via Safari.
- **Offline Mode**: Warns the user when connectivity drops but allows continued browsing of cached data. Data sync pauses and automatically resumes when the connection is restored.

### 8. System Settings
- **Company Profile**: Manage business details, logos, and global configurations.
- **Database Backups**: Export full backups of products, customers, and quotes as compressed JSON files for local archiving.
