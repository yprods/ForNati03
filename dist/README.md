# CRM System - Production Build

This is a production build of the CRM system.

## Installation

1. Install dependencies:
   ```bash
   npm install --production
   ```

2. Run the server:
   ```bash
   npm start
   ```

Or for production mode:
   ```bash
   npm run start:prod
   ```

## Initial Setup

Run the admin creation script:
```bash
node create_admin.js
```

## Notes

- Database files (users.db, projects.db, meetings.db) will be created automatically
- Upload directories are pre-created
- Backups directory is ready for scheduled backups
