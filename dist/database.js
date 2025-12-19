const sqlite3 = require('sqlite3').verbose();

// יצירת חיבורים לקבצי מסד הנתונים
const usersDb = new sqlite3.Database('./users.db');
const projectsDb = new sqlite3.Database('./projects.db');
const meetingsDb = new sqlite3.Database('./meetings.db');
const logsDb = new sqlite3.Database('./logs.db');

// --- הגדרת אכיפת Foreign Keys (חשוב למחיקת שרשרת) ---
projectsDb.run("PRAGMA foreign_keys = ON");

// --- פונקציית עזר לתיקון טבלאות קיימות (Migration) ---
// פונקציה זו מונעת קריסות אם העמודות החדשות לא קיימות בקובץ הישן
function addColumnIfNotExists(db, table, column, type) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`, (err) => {
        // אם יש שגיאה (למשל העמודה כבר קיימת), אנחנו מתעלמים ממנה וממשיכים
        if (!err) {
            console.log(`Auto-Migration: Added column '${column}' to table '${table}'`);
        }
    });
}

// --- הגדרת טבלאות משתמשים ---
usersDb.serialize(() => {
    // יצירת טבלת משתמשים
    usersDb.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        username TEXT UNIQUE, 
        password TEXT, 
        role TEXT, 
        phone TEXT, 
        email TEXT, 
        is_approved BOOLEAN DEFAULT 0, 
        must_change_password BOOLEAN DEFAULT 0
    )`, (err) => {
        if (!err) {
            // יצירת אדמין ברירת מחדל
            usersDb.run(`INSERT OR IGNORE INTO users (id, username, password, role, is_approved) VALUES (1, 'admin', 'admin', 'admin', 1)`);
        }
    });

    usersDb.run(`CREATE TABLE IF NOT EXISTS api_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        service_name TEXT, 
        token TEXT UNIQUE, 
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // --- תיקון אוטומטי לטבלת משתמשים (מוסיף עמודות חסרות) ---
    addColumnIfNotExists(usersDb, 'users', 'is_approved', 'BOOLEAN DEFAULT 0');
    addColumnIfNotExists(usersDb, 'users', 'must_change_password', 'BOOLEAN DEFAULT 0');
});

// --- הגדרת טבלאות פרויקט ודיירים ---
projectsDb.serialize(() => {
    // 1. טבלת דיירים ראשיים
    projectsDb.run(`CREATE TABLE IF NOT EXISTS residents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT, 
        complex_name TEXT, 
        block TEXT, 
        parcel TEXT, 
        sub_parcel TEXT, 
        floor TEXT,
        name TEXT, 
        phone TEXT, 
        old_phone TEXT, 
        id_number TEXT, 
        email TEXT,
        
        -- סטטוסים כלליים
        status TEXT DEFAULT 'ללא מענה', 
        note TEXT,
        
        -- נציגות
        representation_status TEXT DEFAULT 'טרם חתם', 
        representation_refusal_reason TEXT, 
        unsigned_owners TEXT, 
        
        -- משפטי וחוזים
        lawyer_status TEXT DEFAULT 'טרם טופל',
        missing_docs_json TEXT, -- שדה קריטי לחוסרים
        doc_checklist TEXT DEFAULT '{}', 
        contract_file_path TEXT,
        missing_docs TEXT,
        
        signed_representation TEXT DEFAULT 'לא', 
        signed_contract TEXT DEFAULT 'לא',
        
        -- פרטים נוספים
        is_renter TEXT DEFAULT 'לא', 
        renter_name TEXT, 
        renter_phone TEXT,
        warning_note TEXT DEFAULT 'לא', 
        actual_address TEXT, 
        
        current_address TEXT,
        source_type TEXT, 
        assigned_user_id INTEGER,
        
        -- מניעת כפילות
        UNIQUE(project_name, block, parcel, sub_parcel)
    )`);

    // --- תיקון אוטומטי לטבלה קיימת (מוסיף עמודות חסרות) ---
    // זה החלק שמתקן את השגיאה של 500 מבלי למחוק את הדאטה
    addColumnIfNotExists(projectsDb, 'residents', 'missing_docs_json', 'TEXT');
    addColumnIfNotExists(projectsDb, 'residents', 'unsigned_owners', 'TEXT');
    addColumnIfNotExists(projectsDb, 'residents', 'id_number', 'TEXT');
    addColumnIfNotExists(projectsDb, 'residents', 'warning_note', "TEXT DEFAULT 'לא'");

    // 2. טבלה לבעלים נוספים
    projectsDb.run(`CREATE TABLE IF NOT EXISTS secondary_owners (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        resident_id INTEGER, 
        name TEXT, 
        phone TEXT, 
        id_number TEXT,
        lawyer_status TEXT DEFAULT 'טרם טופל', 
        doc_checklist TEXT DEFAULT '{}', 
        representation_status TEXT DEFAULT 'טרם חתם',
        FOREIGN KEY(resident_id) REFERENCES residents(id) ON DELETE CASCADE
    )`);

    // 3. טבלה להודעות צ'אט
    projectsDb.run(`CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        resident_id INTEGER, 
        message TEXT, 
        sender TEXT, -- 'bot' or 'resident'
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(resident_id) REFERENCES residents(id) ON DELETE CASCADE
    )`);

    // 4. טבלה למשימות (לשימוש כללי, היומן משתמש ב-meetings)
    projectsDb.run(`CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        resident_id INTEGER, 
        user_id INTEGER, 
        title TEXT, 
        due_date DATETIME, 
        is_completed BOOLEAN DEFAULT 0, 
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 5. מטא-דאטה של הפרויקט
    projectsDb.run(`CREATE TABLE IF NOT EXISTS projects_metadata (
        project_name TEXT PRIMARY KEY, 
        project_status TEXT DEFAULT 'התארגנות', 
        conference_date TEXT, 
        conference_name TEXT, 
        original_file_path TEXT, 
        conference_invitation_path TEXT
    )`);

    // 6. מטא-דאטה של מתחמים
    projectsDb.run(`CREATE TABLE IF NOT EXISTS complexes_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT, 
        complex_name TEXT,
        manager_id INTEGER, 
        lawyer_id INTEGER, 
        agent_id INTEGER,
        status TEXT DEFAULT 'התארגנות', 
        conference_name TEXT, 
        conference_date DATETIME,
        invitation_path TEXT, 
        protocol_path TEXT,
        UNIQUE(project_name, complex_name)
    )`);

    // 7. מסמכים
    projectsDb.run(`CREATE TABLE IF NOT EXISTS resident_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        resident_id INTEGER, 
        file_name TEXT, 
        file_path TEXT, 
        doc_type TEXT, 
        uploaded_by_role TEXT, 
        upload_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 8. פרוטוקולים
    projectsDb.run(`CREATE TABLE IF NOT EXISTS building_protocols (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        project_name TEXT, 
        block TEXT, 
        parcel TEXT, 
        file_name TEXT, 
        file_path TEXT, 
        upload_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// --- הגדרת טבלת פגישות (יומן) ---
meetingsDb.serialize(() => {
    meetingsDb.run(`CREATE TABLE IF NOT EXISTS meetings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        resident_id INTEGER, 
        user_id INTEGER, 
        title TEXT, 
        start_time DATETIME, 
        meeting_type TEXT
    )`);
});

// --- הגדרת טבלת לוגים ---
logsDb.serialize(() => {
    logsDb.run(`CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        user_id INTEGER, 
        action_type TEXT, 
        description TEXT, 
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

module.exports = { usersDb, projectsDb, meetingsDb, logsDb };
