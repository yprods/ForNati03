const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

// חיבור לבסיס הנתונים
const dbPath = path.resolve(__dirname, 'users.db');
const db = new sqlite3.Database(dbPath);

async function createAdmin() {
    const username = 'admin';
    const password = '123456';

    // --- השינוי כאן: הגדרת התפקיד כ-admin ---
    const role = 'admin';
    // ----------------------------------------

    const phone = '0500000000';
    const email = 'admin@system.com';

    try {
        // 1. הצפנת הסיסמה (חובה למניעת שגיאת 401)
        const hashedPassword = await bcrypt.hash(password, 10);

        // 2. מחיקת המשתמש הישן (כדי שנוכל ליצור אותו מחדש עם התפקיד הנכון)
        db.run(`DELETE FROM users WHERE username = ?`, [username], (err) => {
            if (err) console.error("Error deleting old user:", err.message);
        });

        // 3. יצירת המשתמש החדש
        const sql = `INSERT INTO users (username, password, role, phone, email, is_approved) VALUES (?, ?, ?, ?, ?, 1)`;

        db.run(sql, [username, hashedPassword, role, phone, email], function(err) {
            if (err) {
                console.error("שגיאה ביצירת משתמש:", err.message);
                db.close();
                return;
            }
            console.log(`
            ------------------------------------------
            ✅ משתמש אדמין נוצר/עודכן בהצלחה!
            ------------------------------------------
            שם משתמש: ${username}
            סיסמה:    ${password}
            תפקיד:    ${role} (מנהל מערכת)
            ------------------------------------------
            `);
            db.close();
        });

    } catch (error) {
        console.error("System Error:", error);
        db.close();
    }
}

createAdmin();
