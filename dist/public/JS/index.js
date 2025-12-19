// --- ניהול מודאלים ---
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'flex';
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'none';
}

window.onclick = function(event) {
    if (event.target.className === 'modal-overlay') {
        // מונעים סגירה של חלון החלפת סיסמה בלחיצה בחוץ (הוא חובה)
        if (event.target.id !== 'changePasswordModal') {
            event.target.style.display = "none";
        }
    }
}

// --- 1. לוגיקה של התחברות (Login) ---
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const btn = e.target.querySelector('button');

    const originalText = btn.innerText;
    btn.innerText = 'מתחבר...';
    btn.disabled = true;

    try {
        const res = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });

        if (res.ok) {
            const data = await res.json();

            // בדיקה אם המשתמש חייב להחליף סיסמה
            if (data.user.must_change_password) {
                // שומרים את ה-ID ומציגים את המודאל להחלפה
                document.getElementById('changePassUserId').value = data.user.id;
                closeModal('loginModal'); // סוגרים הכל
                openModal('changePasswordModal'); // פותחים את המודאל החוסם

                btn.innerText = originalText;
                btn.disabled = false;
                return; // עוצרים כאן ולא ממשיכים
            }

            // התחברות רגילה
            localStorage.setItem('user', JSON.stringify(data.user));
            redirectToPage(data.user.role, data.user.id);

        } else {
            const text = await res.text();
            alert(text);
            btn.innerText = originalText;
            btn.disabled = false;
        }
    } catch (err) {
        console.error(err);
        alert('שגיאת תקשורת עם השרת');
        btn.innerText = originalText;
        btn.disabled = false;
    }
});

function redirectToPage(role, userId) {
    if (role === 'admin') window.location.href = '/html/admin.html';
    else if (role === 'lawyer') window.location.href = `/html/lawyer.html?userId=${userId}`;
    else if (role === 'manager') window.location.href = `/html/manager.html?userId=${userId}`;
    else window.location.href = `/html/user.html?userId=${userId}`;
}

// --- 2. לוגיקה של החלפת סיסמה זמנית ---
document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('changePassUserId').value;
    const newPass = document.getElementById('newPermanentPass').value;

    try {
        const res = await fetch('/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, newPassword: newPass })
        });

        if (res.ok) {
            const data = await res.json();
            alert('הסיסמה שונתה בהצלחה! מתחבר...');
            localStorage.setItem('user', JSON.stringify(data.user));
            redirectToPage(data.user.role, data.user.id);
        } else {
            alert('שגיאה בשינוי הסיסמה');
        }
    } catch (err) {
        alert('תקלה בתקשורת');
    }
});

// --- 3. לוגיקה של שכחתי סיסמה (מייל/טלפון) ---
document.getElementById('forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = document.getElementById('forgotIdentifier').value;
    const btn = e.target.querySelector('button');

    btn.disabled = true;
    btn.innerText = 'שולח...';

    try {
        const res = await fetch('/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier })
        });

        const data = await res.json();

        if (res.ok) {
            if (data.method === 'whatsapp') {
                alert('📱 סיסמה זמנית נשלחה אליך לווטסאפ!');
            } else {
                alert('📧 סיסמה זמנית נשלחה אליך למייל!');
            }
            closeModal('forgotModal');
            document.getElementById('forgotForm').reset();
        } else {
            alert(data.error || 'שגיאה בשחזור הסיסמה');
        }
    } catch (err) {
        alert('תקלה בתקשורת');
    } finally {
        btn.disabled = false;
        btn.innerText = 'שלח סיסמה זמנית';
    }
});

// --- 4. לוגיקה של הרשמה ---
document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('regUser').value;
    const password = document.getElementById('regPass').value;
    const phone = document.getElementById('regPhone').value;
    const email = document.getElementById('regEmail').value;
    const btn = e.target.querySelector('button');

    btn.disabled = true;

    try {
        const res = await fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, phone, email })
        });

        if (res.ok) {
            const data = await res.json();
            alert(data.message);
            closeModal('registerModal');
            document.getElementById('registerForm').reset();
        } else {
            const text = await res.text();
            alert('שגיאה: ' + text);
        }
    } catch (err) {
        alert('תקלה בהרשמה');
    } finally {
        btn.disabled = false;
    }
});
