const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const http = require('http');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt'); // אבטחה: הצפנת סיסמאות
const helmet = require('helmet'); // אבטחה: כותרות HTTP
const rateLimit = require('express-rate-limit'); // אבטחה: הגבלת בקשות
const cron = require('node-cron'); // גיבויים: תזמון משימות
const { exec } = require('child_process'); // הרצת סקריפט אדמין
const { usersDb, projectsDb, meetingsDb } = require('./database');

const app = express();

// Configure multer for file uploads
const upload = multer({ 
    dest: 'uploads/',
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    },
    fileFilter: (req, file, cb) => {
        // Accept Excel files
        const allowedMimes = [
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel.sheet.macroEnabled.12',
            'text/csv'
        ];
        if (allowedMimes.includes(file.mimetype) || 
            file.originalname.endsWith('.xlsx') || 
            file.originalname.endsWith('.xls') || 
            file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('סוג קובץ לא נתמך. אנא העלה קובץ אקסל (.xlsx, .xls)'));
        }
    }
});

// --- 1. בדיקות מסד נתונים ותיקונים אוטומטיים (Migrations) ---

// טבלאות לבוט ולמערכת הודעות
const createTables = [
    `CREATE TABLE IF NOT EXISTS staff_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER,
        recipient_id INTEGER, 
        message TEXT,
        file_path TEXT,
        file_name TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_read INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT,
        phone TEXT,
        city TEXT,
        source TEXT DEFAULT 'bot',
        status TEXT DEFAULT 'new',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS support_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        resident_phone TEXT,
        category TEXT,
        description TEXT,
        status TEXT DEFAULT 'open',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
];

createTables.forEach(sql => projectsDb.run(sql));

// הוספת עמודות חסרות לטבלת דיירים (שוכרים)
projectsDb.all("PRAGMA table_info(residents)", (err, rows) => {
    if (rows && !rows.some(col => col.name === 'tenant_name')) {
        console.log("🛠️ מעדכן DB: מוסיף עמודות שוכר...");
        projectsDb.run("ALTER TABLE residents ADD COLUMN tenant_name TEXT");
        projectsDb.run("ALTER TABLE residents ADD COLUMN tenant_phone TEXT");
    }
});

// --- 2. הגדרות אבטחה (Security) ---

app.use(helmet({ contentSecurityPolicy: false }));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'יותר מדי בקשות מכתובת זו.',
    skip: (req) => {
        // Skip rate limiting for file uploads - they need higher limits
        return req.path === '/upload' || req.path === '/upload-resident-doc';
    }
});
app.use(limiter);

// Separate rate limiter for file uploads with higher limits
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20, // Allow 20 uploads per 15 minutes
    message: 'יותר מדי העלאות קבצים. אנא נסה שוב בעוד כמה דקות.'
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'יותר מדי ניסיונות התחברות נכשלו.'
});

// יצירת תיקיות מערכת
const dirs = ['uploads/stored_files', 'uploads/resident_docs', 'uploads/staff_files', 'uploads/invitations', 'uploads/protocols', 'backups'];
dirs.forEach(d => {
    const p = path.join(__dirname, d);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Body parser - Express 5 has built-in body parser
// Must be before multer for JSON/URL-encoded data
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Error handler for multer
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).send('הקובץ גדול מדי. מקסימום 50MB');
        }
        return res.status(400).send(`שגיאת העלאה: ${err.message}`);
    }
    if (err) {
        return res.status(400).send(err.message);
    }
    next();
});

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/', (req, res) => res.redirect('/html/index.html'));

// ייצוא פרויקט לאקסל - חייב להיות לפני express.static
app.get('/export-project/:projectName', async (req, res) => {
    try {
        const projectName = decodeURIComponent(req.params.projectName);
        const complexName = req.query.complex ? decodeURIComponent(req.query.complex) : null;
        
        console.log(`Export request: project=${projectName}, complex=${complexName || 'all'}`);
        
        // בניית שאילתה
        let query = `SELECT * FROM residents WHERE project_name = ?`;
        const params = [projectName];
        
        if (complexName) {
            query += ` AND complex_name = ?`;
            params.push(complexName);
        }
        
        query += ` ORDER BY complex_name, current_address, sub_parcel`;
        
        const residents = await dbAll(projectsDb, query, params);
        
        if (residents.length === 0) {
            return res.status(404).send('לא נמצאו דיירים בפרויקט זה');
        }
        
        // יצירת workbook
        const workbook = xlsx.utils.book_new();
        
        // הכנת נתונים לאקסל
        const data = residents.map(r => {
            return {
                'מתחם': r.complex_name || '',
                'רחוב': r.current_address ? r.current_address.split(' ')[0] : '',
                'מספר בית': r.current_address ? r.current_address.split(' ').slice(1).join(' ') : '',
                'מספר דירה': r.sub_parcel || '',
                'שם דייר': r.name || 'דייר לא ידוע',
                'טלפון': r.phone || '',
                'ת.ז.': r.id_number || '',
                'סטטוס': r.status || '',
                'סטטוס עו"ד': r.lawyer_status || '',
                'סטטוס נציגות': r.representation_status || '',
                'הערות': r.note || '',
                'הערות אזהרה': r.warning_note || '',
                'שוכר': r.is_renter === 'כן' ? 'כן' : 'לא',
                'שם שוכר': r.tenant_name || '',
                'טלפון שוכר': r.tenant_phone || '',
                'כתובת בפועל': r.actual_address || '',
                'מקור': r.source_type || ''
            };
        });
        
        // יצירת גיליון
        const worksheet = xlsx.utils.json_to_sheet(data);
        
        // הגדרת רוחב עמודות
        const colWidths = [
            { wch: 15 }, // מתחם
            { wch: 20 }, // רחוב
            { wch: 12 }, // מספר בית
            { wch: 12 }, // מספר דירה
            { wch: 20 }, // שם דייר
            { wch: 15 }, // טלפון
            { wch: 12 }, // ת.ז.
            { wch: 15 }, // סטטוס
            { wch: 15 }, // סטטוס עו"ד
            { wch: 15 }, // סטטוס נציגות
            { wch: 30 }, // הערות
            { wch: 20 }, // הערות אזהרה
            { wch: 10 }, // שוכר
            { wch: 20 }, // שם שוכר
            { wch: 15 }, // טלפון שוכר
            { wch: 30 }, // כתובת בפועל
            { wch: 12 }  // מקור
        ];
        worksheet['!cols'] = colWidths;
        
        // הוספת גיליון ל-workbook
        const sheetName = complexName ? `${projectName}_${complexName}` : projectName;
        xlsx.utils.book_append_sheet(workbook, worksheet, sheetName.substring(0, 31)); // Excel מגביל ל-31 תווים
        
        // יצירת buffer
        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        
        // הגדרת headers להורדה
        const dateStr = new Date().toISOString().split('T')[0];
        const safeSheetName = sheetName.replace(/[<>:"/\\|?*]/g, '_'); // הסרת תווים לא חוקיים
        const fileName = `${safeSheetName}_${dateStr}.xlsx`;
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        
        console.log(`Export successful: ${residents.length} residents exported to ${fileName}`);
        res.send(buffer);
    } catch (e) {
        console.error('Export error:', e);
        res.status(500).send(`שגיאה בייצוא: ${e.message}`);
    }
});

// Static files - חייב להיות אחרי כל ה-routes הדינמיים
app.use(express.static('public'));

// --- 3. מנגנון גיבוי יומי (21:00) ---
cron.schedule('0 21 * * *', () => {
    console.log('🔄 מתחיל גיבוי מערכת...');
    const backupRoot = path.join(__dirname, 'backups');
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    const todayBackupPath = path.join(backupRoot, dateStr);

    if (!fs.existsSync(todayBackupPath)) fs.mkdirSync(todayBackupPath, { recursive: true });

    try {
        ['users.db', 'projects.db', 'meetings.db'].forEach(db => {
            if (fs.existsSync(db)) fs.copyFileSync(db, path.join(todayBackupPath, db));
        });
        const uploadsDir = path.join(__dirname, 'uploads');
        if (fs.existsSync(uploadsDir)) fs.cpSync(uploadsDir, path.join(todayBackupPath, 'uploads'), { recursive: true });

        console.log(`✅ גיבוי הושלם: ${dateStr}`);
    } catch (error) { console.error('❌ שגיאה בגיבוי:', error); }
});

// --- Helpers ---
function dbRun(db, sql, params = []) { return new Promise((resolve, reject) => { db.run(sql, params, function(err) { if (err) reject(err); else resolve(this); }); }); }
function dbGet(db, sql, params = []) { return new Promise((resolve, reject) => { db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); }); }); }
function dbAll(db, sql, params = []) { return new Promise((resolve, reject) => { db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); }); }); }
function sanitize(value) { return (value == null || String(value).trim() === '') ? '' : String(value).trim(); }
function cleanNumber(val) { return val ? String(val).replace('.0', '').trim() : ''; }
function parseId(val) { return (val && val !== 'null') ? parseInt(val) : null; }

// --- Excel Engine ---
async function processExcel(filePath, projectName) {
    if (!fs.existsSync(filePath)) {
        throw new Error('קובץ לא נמצא');
    }
    
    let workbook;
    try {
        workbook = xlsx.readFile(filePath, { type: 'binary', cellDates: true });
    } catch (e) {
        throw new Error(`שגיאה בקריאת קובץ אקסל: ${e.message}`);
    }
    
    if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('הקובץ אינו קובץ אקסל תקין או ריק');
    }
    
    await dbRun(projectsDb, `INSERT OR IGNORE INTO projects_metadata (project_name) VALUES (?)`, [projectName]);

    let totalCreated = 0, totalUpdated = 0;
    let complexesFound = new Set();

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        if (rows.length < 2) continue;

        let colMap = { complex: 0, subComplex: 1, street: 2, houseNum: 3, subParcel: 4, name: 5, idNum: 6, phone: 7, warning: 12 };
        let headerRowIndex = 0;
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
            if (JSON.stringify(rows[i]).includes('שם')) { headerRowIndex = i; break; }
        }

        let lastCtx = { street: '', houseNum: '', aptNum: '', complex: '' };

        for (let i = headerRowIndex + 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r || r.length === 0) continue;

            let rawName = sanitize(r[colMap.name]);
            if (rawName.includes('שם בעל')) continue;

            let curStreet = sanitize(r[colMap.street]) || lastCtx.street; lastCtx.street = curStreet;
            let curHouseNum = cleanNumber(r[colMap.houseNum]) || lastCtx.houseNum; lastCtx.houseNum = curHouseNum;
            let curAptNum = cleanNumber(r[colMap.subParcel]) || lastCtx.aptNum; lastCtx.aptNum = curAptNum;
            let curComplex = sanitize(r[colMap.complex]) || lastCtx.complex || 'כללי'; lastCtx.complex = curComplex;

            if (curComplex) complexesFound.add(curComplex);
            if (!rawName && !curStreet) continue;

            let uniqueKey = `${curStreet}_${curHouseNum}_${curAptNum}`;
            let phone = sanitize(r[colMap.phone]).replace(/[^0-9]/g, '');
            if (phone.length >= 9 && !phone.startsWith('0')) phone = '0' + phone;
            let idNum = sanitize(r[colMap.idNum]);
            let fullAddress = `${curStreet} ${curHouseNum}`;
            let isUnknown = !rawName;
            if (isUnknown) rawName = "דייר לא ידוע";

            try {
                const existing = await dbGet(projectsDb, `SELECT id FROM residents WHERE project_name=? AND sub_parcel=?`, [projectName, uniqueKey]);
                if (existing) {
                    const ownerExists = await dbGet(projectsDb, "SELECT id FROM secondary_owners WHERE resident_id=? AND name=?", [existing.id, rawName]);
                    if (!ownerExists && !isUnknown) {
                        await dbRun(projectsDb, `INSERT INTO secondary_owners (resident_id, name, phone, id_number) VALUES (?, ?, ?, ?)`, [existing.id, rawName, phone, idNum]);
                        totalUpdated++;
                    }
                } else {
                    await dbRun(projectsDb, `INSERT INTO residents (project_name, complex_name, block, parcel, sub_parcel, floor, name, phone, id_number, current_address, warning_note, source_type) VALUES (?, ?, '0', '0', ?, '', ?, ?, ?, ?, ?, 'excel')`,
                        [projectName, curComplex, uniqueKey, rawName, phone, idNum, fullAddress, sanitize(r[colMap.warning])]);
                    totalCreated++;
                }
            } catch (e) { console.error(`Row error: ${e.message}`); }
        }
    }
    for (const c of complexesFound) await dbRun(projectsDb, `INSERT OR IGNORE INTO complexes_metadata (project_name, complex_name) VALUES (?, ?)`, [projectName, c]);
    return { created: totalCreated, updated: totalUpdated };
}

// --- Auth Routes ---

app.post('/login', loginLimiter, async (req, res) => {
    try {
        const user = await dbGet(usersDb, `SELECT * FROM users WHERE username = ?`, [req.body.username]);
        if (!user) return res.status(401).send('פרטים שגויים');
        if (!user.is_approved) return res.status(403).send('משתמש לא מאושר');

        const match = await bcrypt.compare(req.body.password, user.password);
        if (!match) return res.status(401).send('פרטים שגויים');

        const userResponse = { ...user }; delete userResponse.password;
        res.json({ message: 'ok', user: userResponse });
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/forgot-password', async (req, res) => {
    try {
        const user = await dbGet(usersDb, `SELECT * FROM users WHERE email = ? OR phone LIKE ?`, [req.body.identifier, `%${req.body.identifier.slice(-9)}`]);
        if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });

        const tempPass = Math.floor(100000 + Math.random() * 900000).toString();
        const hashed = await bcrypt.hash(tempPass, 10);
        await dbRun(usersDb, `UPDATE users SET password = ?, must_change_password = 1 WHERE id = ?`, [hashed, user.id]);

        console.log(`Temp Pass for ${user.username}: ${tempPass}`);
        res.json({ message: 'נשלח', debugPass: tempPass });
    } catch (e) { res.status(500).json({ error: 'שגיאה' }); }
});

app.post('/change-password', async (req, res) => {
    try {
        const hashed = await bcrypt.hash(req.body.newPassword, 10);
        await dbRun(usersDb, `UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?`, [hashed, req.body.userId]);
        res.json({ message: 'ok' });
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/register', async (req, res) => {
    try {
        const exists = await dbGet(usersDb, "SELECT id FROM users WHERE username = ?", [req.body.username]);
        if(exists) return res.status(400).send('שם משתמש תפוס');
        const hashed = await bcrypt.hash(req.body.password, 10);
        await dbRun(usersDb, `INSERT INTO users (username, password, role, phone, email, is_approved) VALUES (?, ?, 'user', ?, ?, 0)`,
            [req.body.username, hashed, req.body.phone, req.body.email]);
        res.json({ message: 'נרשמת בהצלחה! ממתין לאישור.' });
    } catch (e) { res.status(500).send(e.message); }
});

// --- General API (User Side) ---

// עדכון דייר עם לוגיקת נעילה (אם העו"ד חתם - אסור לשנות סטטוס שוטף)
app.post('/update-resident-data', async (req, res) => {
    const { id, status, note, phone, id_number, is_renter, tenant_name, tenant_phone, actual_address, warning_note, representation_status, representation_refusal_reason, unsigned_owners } = req.body;
    try {
        // 1. בדיקת סטטוס נוכחי מהעורך דין
        const current = await dbGet(projectsDb, "SELECT lawyer_status, status FROM residents WHERE id=?", [id]);

        let statusToUpdate = status; // הסטטוס שהנציג ביקש לעדכן

        if (current && (current.lawyer_status === 'חתם מלא' || current.lawyer_status === 'חתם חלקי')) {
            // אם העו"ד כבר סימן חתימה -> שומרים על הסטטוס הישן (חוסמים שינוי)
            statusToUpdate = current.status;
        }

        // 2. ביצוע העדכון (עם שדות השוכר)
        await dbRun(projectsDb, `UPDATE residents SET 
            status=?, note=?, phone=?, id_number=?, 
            is_renter=?, tenant_name=?, tenant_phone=?, 
            actual_address=?, warning_note=?, 
            representation_status=?, representation_refusal_reason=?, unsigned_owners=? 
            WHERE id=?`,
            [statusToUpdate, note, phone, id_number, is_renter, tenant_name, tenant_phone, actual_address, warning_note, representation_status, representation_refusal_reason, unsigned_owners, id]);

        res.json({message:'ok'});
    } catch(e) { res.status(500).send(e.message); }
});

// Meetings/Calendar API
app.get('/api/meetings', async (req, res) => {
    try {
        let query = `SELECT * FROM meetings WHERE 1=1`;
        const params = [];
        
        if (req.query.userId) {
            query += ` AND user_id = ?`;
            params.push(req.query.userId);
        }
        if (req.query.role === 'manager') {
            // Managers see all meetings
            query = `SELECT m.* FROM meetings m 
                     JOIN complexes_metadata c ON m.user_id = c.manager_id 
                     WHERE c.manager_id = ?`;
            params.push(req.query.userId);
        }
        
        query += ` ORDER BY start_time ASC`;
        const meetings = await dbAll(meetingsDb, query, params);
        const events = [];
        
        for (const m of meetings) {
            let title = m.title;
            if (m.resident_id) {
                const r = await dbGet(projectsDb, `SELECT name FROM residents WHERE id=?`, [m.resident_id]);
                if (r) title += ` - ${r.name}`;
            }
            events.push({ 
                title: title, 
                start: m.start_time, 
                extendedProps: { type: m.meeting_type },
                id: m.id
            });
        }
        res.json(events);
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.get('/api/tasks', async (req, res) => {
    try {
        const meetings = await dbAll(meetingsDb, `SELECT * FROM meetings WHERE user_id=? ORDER BY start_time ASC`, [req.query.userId]);
        const events = [];
        for (const m of meetings) {
            let title = m.title;
            if (m.resident_id) {
                const r = await dbGet(projectsDb, `SELECT name FROM residents WHERE id=?`, [m.resident_id]);
                if (r) title += ` - ${r.name}`;
            }
            events.push({ title: title, start: m.start_time, extendedProps: { type: m.meeting_type } });
        }
        res.json(events);
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/api/add-task', async (req, res) => {
    try {
        const conflict = await dbGet(meetingsDb, `SELECT id FROM meetings WHERE start_time = ? AND meeting_type = 'blocked'`, [req.body.due_date]);
        if (conflict) return res.status(400).json({ error: 'המועד חסום ע"י עורך הדין' });

        await dbRun(meetingsDb, `INSERT INTO meetings (resident_id, user_id, title, start_time, meeting_type) VALUES (?,?,?,?,?)`,
            [req.body.resident_id, req.body.user_id, req.body.title, req.body.due_date, req.body.meeting_type]);
        res.json({success:true});
    } catch(e) { res.status(500).json({error:e.message}); }
});

// --- CHATBOT API (נתיבים לבוט) ---

// 1. קליטת ליד (לקוח חדש)
app.post('/api/bot/new-lead', async (req, res) => {
    const { full_name, phone, city, source } = req.body;
    try {
        await dbRun(projectsDb, `INSERT INTO leads (full_name, phone, city, source) VALUES (?, ?, ?, ?)`,
            [full_name, phone, city, source || 'whatsapp']);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. דיווח תקלה
app.post('/api/bot/report-issue', async (req, res) => {
    const { phone, category, description } = req.body;
    try {
        await dbRun(projectsDb, `INSERT INTO support_tickets (resident_phone, category, description) VALUES (?, ?, ?)`,
            [phone, category, description]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3. בדיקת סטטוס דייר
app.post('/api/bot/check-status', async (req, res) => {
    const { phone } = req.body;
    try {
        const cleanPhone = phone.replace(/\D/g, '').slice(-9);
        const resident = await dbGet(projectsDb, `SELECT name, status, lawyer_status, missing_docs_json FROM residents WHERE phone LIKE ?`, [`%${cleanPhone}`]);

        if (!resident) return res.json({ found: false });

        let reply = `שלום ${resident.name}, `;
        if (resident.lawyer_status === 'חתם מלא') reply += "התיק שלך חתום ומאושר! ✅";
        else if (resident.lawyer_status === 'חתם חלקי') reply += "התיק חתום חלקית. יש להשלים מסמכים.";
        else reply += `הסטטוס הנוכחי: ${resident.status || 'בטיפול'}.`;

        res.json({ found: true, reply: reply, data: resident });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Lawyer Features Routes ---

app.get('/lawyer/projects', async (req, res) => {
    try {
        const assignments = await dbAll(projectsDb, "SELECT * FROM complexes_metadata WHERE lawyer_id=?", [req.query.userId]);
        const result = [];
        for (const a of assignments) {
            const residents = await dbAll(projectsDb, `SELECT * FROM residents WHERE project_name=? AND complex_name=? ORDER BY current_address ASC, sub_parcel ASC`, [a.project_name, a.complex_name]);
            for (let r of residents) r.secondary_owners = await dbAll(projectsDb, "SELECT * FROM secondary_owners WHERE resident_id=?", [r.id]);
            result.push({ project_name: a.project_name, complex_name: a.complex_name, residents });
        }
        res.json(result);
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/lawyer/block-time', async (req, res) => {
    try {
        await dbRun(meetingsDb, `INSERT INTO meetings (user_id, title, start_time, meeting_type) VALUES (?, ?, ?, 'blocked')`,
            [req.body.user_id, `⛔ חסום: ${req.body.reason}`, req.body.start_time]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/lawyer/update-resident', upload.array('signed_docs'), async (req, res) => {
    const { id, lawyer_status, missing_docs_json } = req.body;
    if (!id) return res.status(400).send('Missing ID');
    try {
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const safeName = `signed_${Date.now()}_${path.basename(file.originalname)}`;
                fs.renameSync(file.path, path.join(__dirname, 'uploads/resident_docs', safeName));
                await dbRun(projectsDb, `INSERT INTO resident_documents (resident_id, file_name, file_path, doc_type, uploaded_by_role) VALUES (?, ?, ?, 'signed_contract_part', 'lawyer')`, [id, file.originalname, safeName]);
            }
        }
        await dbRun(projectsDb, "UPDATE residents SET lawyer_status=?, missing_docs_json=? WHERE id=?", [lawyer_status, missing_docs_json, id]);

        // אם עו"ד אישר סופית -> נועלים את הדייר לנציג
        if (lawyer_status === 'חתם מלא') await dbRun(projectsDb, "UPDATE residents SET status='חתם חוזה' WHERE id=?", [id]);

        res.json({ message: 'ok' });
    } catch (e) { res.status(500).send(e.message); }
});

// --- Staff Chat (Lawyer <-> Agents) ---

app.get('/api/staff/users', async (req, res) => {
    try { res.json(await dbAll(usersDb, "SELECT id, username, role FROM users WHERE role IN ('user', 'manager', 'agent', 'lawyer') AND is_approved=1")); } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/staff/send', upload.single('file'), async (req, res) => {
    const { sender_id, recipient_id, message } = req.body;
    let fileName = null, filePath = null;

    if (req.file) {
        fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        filePath = `staff_${Date.now()}_${fileName}`;
        fs.renameSync(req.file.path, path.join(__dirname, 'uploads/staff_files', filePath));
    }

    try {
        await dbRun(projectsDb,
            `INSERT INTO staff_messages (sender_id, recipient_id, message, file_name, file_path) VALUES (?, ?, ?, ?, ?)`,
            [sender_id, recipient_id === 'all' ? 0 : recipient_id, message, fileName, filePath]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/staff/history', async (req, res) => {
    const userId = req.query.userId;
    try {
        const msgs = await dbAll(projectsDb,
            `SELECT * FROM staff_messages WHERE recipient_id = 0 OR recipient_id = ? OR sender_id = ? ORDER BY timestamp ASC`,
            [userId, userId]);

        for (let m of msgs) {
            const u = await dbGet(usersDb, "SELECT username, role FROM users WHERE id=?", [m.sender_id]);
            m.sender_name = u ? u.username : 'Unknown';
        }
        res.json(msgs);
    } catch(e) { res.status(500).send(e.message); }
});

app.get('/staff-files/:filename', (req, res) => {
    const p = path.join(__dirname, 'uploads/staff_files', req.params.filename);
    if(fs.existsSync(p)) res.download(p); else res.status(404).send('Not Found');
});

// --- General Files & Uploads ---

app.post('/upload-resident-doc', uploadLimiter, upload.single('doc'), async (req, res) => {
    if (!req.file) return res.status(400).send('חסר קובץ');
    try {
        const safeName = `doc_${Date.now()}_${path.basename(req.file.originalname)}`;
        fs.renameSync(req.file.path, path.join(__dirname, 'uploads/resident_docs', safeName));
        await dbRun(projectsDb, `INSERT INTO resident_documents (resident_id, file_name, file_path, doc_type, uploaded_by_role) VALUES (?, ?, ?, ?, ?)`,
            [req.body.resident_id, req.file.originalname, safeName, req.body.doc_type, req.body.uploaded_by_role]);
        res.json({ message: 'הועלה' });
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/download-doc/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'uploads/resident_docs', path.basename(req.params.filename));
    if (fs.existsSync(filePath)) res.download(filePath); else res.status(404).send('Not Found');
});

// Chat Bot History (Client <-> System)
app.get('/api/chat/history/:residentId', async (req, res) => {
    try { res.json(await dbAll(projectsDb, `SELECT * FROM chat_messages WHERE resident_id = ? ORDER BY timestamp ASC`, [req.params.residentId])); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/chat/send', async (req, res) => {
    try { await dbRun(projectsDb, `INSERT INTO chat_messages (resident_id, message, direction, timestamp, sender_name) VALUES (?, ?, 'incoming', ?, ?)`, [req.body.resident_id, req.body.message, Date.now(), req.body.sender_name]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manager
app.post('/add-user', async (req, res) => {
    try {
        console.log('Add user request received:', {
            body: req.body,
            contentType: req.get('Content-Type'),
            hasBody: !!req.body
        });
        
        // בדיקה שהגוף קיים
        if (!req.body) {
            console.error('No request body received');
            return res.status(400).json({ error: 'לא התקבלו נתונים. אנא נסה שוב.' });
        }
        
        // בדיקות תקינות
        if (!req.body.username || typeof req.body.username !== 'string' || !req.body.username.trim()) {
            console.error('Invalid username:', req.body.username);
            return res.status(400).json({ error: 'שם משתמש הוא שדה חובה' });
        }
        
        if (!req.body.password || typeof req.body.password !== 'string' || req.body.password.length < 4) {
            console.error('Invalid password length:', req.body.password ? req.body.password.length : 0);
            return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 4 תווים' });
        }
        
        if (!req.body.role || typeof req.body.role !== 'string' || !req.body.role.trim()) {
            console.error('Invalid role:', req.body.role);
            return res.status(400).json({ error: 'יש לבחור תפקיד למשתמש' });
        }
        
        const username = req.body.username.trim();
        const role = req.body.role.trim();
        const phone = req.body.phone ? String(req.body.phone).trim() : '';
        const email = req.body.email ? String(req.body.email).trim() : '';
        
        console.log('Processing user:', { username, role, phone: phone ? 'provided' : 'empty', email: email ? 'provided' : 'empty' });
        
        // בדיקה אם המשתמש כבר קיים
        const exists = await dbGet(usersDb, "SELECT id FROM users WHERE username = ?", [username]);
        if (exists) {
            console.error('Username already exists:', username);
            return res.status(400).json({ error: 'שם משתמש זה כבר תפוס. אנא בחר שם אחר.' });
        }
        
        // הצפנת סיסמה
        const hashed = await bcrypt.hash(req.body.password, 10);
        
        // הוספת המשתמש
        await dbRun(usersDb, `INSERT INTO users (username, password, role, phone, email, is_approved) VALUES (?, ?, ?, ?, ?, 1)`, 
            [username, hashed, role, phone, email]);
        
        console.log('User added successfully:', username);
        res.json({ success: true, message: 'המשתמש נוסף בהצלחה!' });
    } catch (e) {
        console.error('Add user error:', e);
        console.error('Error stack:', e.stack);
        res.status(500).json({ error: `שגיאה בהוספת משתמש: ${e.message}` });
    }
});
app.get('/users', async (req, res) => { try { res.json(await dbAll(usersDb, "SELECT * FROM users WHERE id != 1")); } catch (e) { res.status(500).send(e.message); } });
app.get('/my-buildings', async (req, res) => {
    try {
        const rows = await dbAll(projectsDb, `SELECT r.project_name, r.current_address as address, r.complex_name FROM residents r WHERE r.assigned_user_id=? GROUP BY r.project_name, r.current_address`, [req.query.userId]);
        const result = [];
        for (const r of rows) {
            const stats = await dbGet(projectsDb, `SELECT COUNT(*) as total, SUM(CASE WHEN lawyer_status LIKE '%חתם%' THEN 1 ELSE 0 END) as signed FROM residents WHERE project_name=? AND current_address=?`, [r.project_name, r.address]);
            result.push({...r, stats: {full_pct: stats.total ? ((stats.signed/stats.total)*100).toFixed(0) : 0, total: stats.total}});
        }
        res.json(result);
    } catch(e) { res.status(500).send(e.message); }
});
app.get('/residents-by-address', async (req, res) => { res.json(await dbAll(projectsDb, "SELECT * FROM residents WHERE project_name=? AND current_address=?", [req.query.project, req.query.address])); });
app.get('/api/secondary-owners/:id', async (req, res) => { res.json(await dbAll(projectsDb, "SELECT * FROM secondary_owners WHERE resident_id=?", [req.params.id])); });
app.get('/api/complex-details', async (req, res) => { try { const d = await dbGet(projectsDb, `SELECT * FROM complexes_metadata WHERE project_name=? AND complex_name=?`, [req.query.project, req.query.complex]); if(d && d.lawyer_id) { const l = await dbGet(usersDb, "SELECT username FROM users WHERE id=?", [d.lawyer_id]); d.lawyerName = l ? l.username : '-'; } res.json(d || {}); } catch(e) { res.status(500).send(e.message); } });

// --- Admin & Project Management Routes ---

// סטטיסטיקות פרויקטים
app.get('/project-stats', async (req, res) => {
    try {
        const projects = await dbAll(projectsDb, `SELECT project_name, COUNT(*) as total, SUM(CASE WHEN lawyer_status LIKE '%חתם מלא%' THEN 1 ELSE 0 END) as signed FROM residents GROUP BY project_name`);
        res.json(projects);
    } catch (e) { res.status(500).send(e.message); }
});

// העלאת קובץ אקסל
app.post('/upload', uploadLimiter, upload.single('file'), async (req, res) => {
    if (!req.file) {
        console.error('Upload error: No file received');
        return res.status(400).send('חסר קובץ');
    }
    
    if (!req.body.project || !req.body.project.trim()) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(400).send('חסר שם פרויקט');
    }
    
    const projectName = req.body.project.trim();
    console.log(`Uploading file: ${req.file.originalname} for project: ${projectName}`);
    
    try {
        // Verify file exists and is readable
        if (!fs.existsSync(req.file.path)) {
            throw new Error('הקובץ לא נמצא לאחר ההעלאה');
        }
        
        // Check file size
        const stats = fs.statSync(req.file.path);
        if (stats.size === 0) {
            fs.unlinkSync(req.file.path);
            throw new Error('הקובץ ריק');
        }
        
        // Process the Excel file
        const result = await processExcel(req.file.path, projectName);
        
        // Clean up uploaded file
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        console.log(`Upload successful: Created ${result.created}, Updated ${result.updated}`);
        res.send(`✅ הועלה בהצלחה! נוצרו ${result.created} דיירים חדשים, עודכנו ${result.updated} בעלים נוספים.`);
    } catch (e) {
        console.error('Upload error:', e);
        console.error('Error stack:', e.stack);
        // Clean up on error
        if (req.file && fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (cleanupErr) {
                console.error('Error cleaning up file:', cleanupErr);
            }
        }
        const errorMessage = e.message || 'שגיאה לא ידועה בהעלאה';
        res.status(500).send(`שגיאה בהעלאה: ${errorMessage}`);
    }
});

// אישור משתמש
app.post('/approve-user', async (req, res) => {
    try {
        await dbRun(usersDb, `UPDATE users SET is_approved = 1, role = ? WHERE id = ?`, [req.body.role, req.body.id]);
        res.json({ message: 'ok' });
    } catch (e) { res.status(500).send(e.message); }
});

// מחיקת משתמש
app.post('/delete-user', async (req, res) => {
    try {
        await dbRun(usersDb, `DELETE FROM users WHERE id = ?`, [req.body.id]);
        res.json({ message: 'ok' });
    } catch (e) { res.status(500).send(e.message); }
});

// מחיקת פרויקט
app.post('/delete-project', async (req, res) => {
    try {
        await dbRun(projectsDb, `DELETE FROM residents WHERE project_name = ?`, [req.body.project_name]);
        await dbRun(projectsDb, `DELETE FROM projects_metadata WHERE project_name = ?`, [req.body.project_name]);
        await dbRun(projectsDb, `DELETE FROM complexes_metadata WHERE project_name = ?`, [req.body.project_name]);
        res.json({ message: 'ok' });
    } catch (e) { res.status(500).send(e.message); }
});

// מחיקת מתחם
app.post('/delete-complex', async (req, res) => {
    try {
        await dbRun(projectsDb, `DELETE FROM residents WHERE project_name = ? AND complex_name = ?`, [req.body.project_name, req.body.complex_name]);
        await dbRun(projectsDb, `DELETE FROM complexes_metadata WHERE project_name = ? AND complex_name = ?`, [req.body.project_name, req.body.complex_name]);
        res.json({ message: 'ok' });
    } catch (e) { res.status(500).send(e.message); }
});

// נתוני מתחמים לפרויקט
app.get('/api/complexes-data', async (req, res) => {
    try {
        const complexes = await dbAll(projectsDb, `SELECT * FROM complexes_metadata WHERE project_name = ?`, [req.query.project]);
        res.json(complexes);
    } catch (e) { res.status(500).send(e.message); }
});

// עדכון מתחם
app.post('/api/update-complex', upload.fields([{ name: 'invitation', maxCount: 1 }, { name: 'protocol', maxCount: 1 }]), async (req, res) => {
    try {
        const { project_name, complex_name, manager_id, lawyer_id, agent_id, status, conference_name, conference_date } = req.body;
        let invitation_path = null, protocol_path = null;

        if (req.files.invitation) {
            const file = req.files.invitation[0];
            invitation_path = `inv_${Date.now()}_${path.basename(file.originalname)}`;
            fs.renameSync(file.path, path.join(__dirname, 'uploads/invitations', invitation_path));
        }
        if (req.files.protocol) {
            const file = req.files.protocol[0];
            protocol_path = `prot_${Date.now()}_${path.basename(file.originalname)}`;
            fs.renameSync(file.path, path.join(__dirname, 'uploads/protocols', protocol_path));
        }

        const existing = await dbGet(projectsDb, `SELECT id FROM complexes_metadata WHERE project_name = ? AND complex_name = ?`, [project_name, complex_name]);
        
        if (existing) {
            const updates = [];
            const values = [];
            if (manager_id) { updates.push('manager_id = ?'); values.push(manager_id); }
            if (lawyer_id) { updates.push('lawyer_id = ?'); values.push(lawyer_id); }
            if (agent_id) { updates.push('agent_id = ?'); values.push(agent_id); }
            if (status) { updates.push('status = ?'); values.push(status); }
            if (conference_name) { updates.push('conference_name = ?'); values.push(conference_name); }
            if (conference_date) { updates.push('conference_date = ?'); values.push(conference_date); }
            if (invitation_path) { updates.push('invitation_path = ?'); values.push(invitation_path); }
            if (protocol_path) { updates.push('protocol_path = ?'); values.push(protocol_path); }
            
            values.push(project_name, complex_name);
            await dbRun(projectsDb, `UPDATE complexes_metadata SET ${updates.join(', ')} WHERE project_name = ? AND complex_name = ?`, values);
        } else {
            await dbRun(projectsDb, `INSERT INTO complexes_metadata (project_name, complex_name, manager_id, lawyer_id, agent_id, status, conference_name, conference_date, invitation_path, protocol_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [project_name, complex_name, manager_id || null, lawyer_id || null, agent_id || null, status || 'התארגנות', conference_name || null, conference_date || null, invitation_path, protocol_path]);
        }
        res.json({ message: 'ok' });
    } catch (e) { res.status(500).send(e.message); }
});

// Manager Stats
app.get('/manager/stats', async (req, res) => {
    try {
        const complexes = await dbAll(projectsDb, `SELECT * FROM complexes_metadata WHERE manager_id = ?`, [req.query.userId]);
        const result = [];
        
        for (const c of complexes) {
            const buildings = await dbAll(projectsDb, 
                `SELECT current_address as name, COUNT(*) as total, 
                 SUM(CASE WHEN lawyer_status LIKE '%חתם מלא%' THEN 1 ELSE 0 END) as signed_full,
                 SUM(CASE WHEN lawyer_status LIKE '%חתם חלקי%' THEN 1 ELSE 0 END) as signed_partial
                 FROM residents WHERE project_name = ? AND complex_name = ? GROUP BY current_address`,
                [c.project_name, c.complex_name]);
            
            const buildings_stats = buildings.map(b => ({
                name: b.name,
                total: b.total,
                full_pct: b.total ? ((b.signed_full / b.total) * 100).toFixed(0) : 0,
                partial_pct: b.total ? ((b.signed_partial / b.total) * 100).toFixed(0) : 0
            }));
            
            result.push({
                project_name: c.project_name,
                complex_name: c.complex_name,
                status: c.status,
                invitation_path: c.invitation_path,
                protocol_path: c.protocol_path,
                buildings_stats
            });
        }
        res.json(result);
    } catch (e) { res.status(500).send(e.message); }
});

// הפעלה + הרצת סקריפט אדמין
function startServer(port) {
    exec('node create_admin.js', (error, stdout, stderr) => {
        if (error) console.error(`Admin setup error: ${error.message}`);
        else console.log(`Admin setup: ${stdout}`);

        const server = http.createServer(app);
        server.once('error', (err) => { if (err.code === 'EADDRINUSE') startServer(port + 1); });
        server.listen(port, () => console.log(`Server running on http://localhost:${port}`));
    });
}
startServer(3000);
