// --- הצגת הודעות שגיאה/הצלחה ---
function showAlert(message, type = 'error') {
    const container = document.getElementById('alertContainer');
    if (!container) return;
    container.innerHTML = `<div class="alert ${type}" style="display: block;">${message}</div>`;
    setTimeout(() => {
        if (container) container.innerHTML = '';
    }, 5000);
}

// --- ניהול מודאלים ---
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal-overlay')) {
        // מונעים סגירה של חלון החלפת סיסמה בלחיצה בחוץ (הוא חובה)
        if (event.target.id !== 'changePasswordModal') {
            closeModal(event.target.id);
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
            showAlert(text, 'error');
            btn.innerText = originalText;
            btn.disabled = false;
        }
    } catch (err) {
        console.error(err);
        showAlert('שגיאת תקשורת עם השרת. אנא נסה שוב.', 'error');
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
            showAlert('הסיסמה שונתה בהצלחה! מתחבר...', 'success');
            setTimeout(() => {
                localStorage.setItem('user', JSON.stringify(data.user));
                redirectToPage(data.user.role, data.user.id);
            }, 1000);
        } else {
            const text = await res.text();
            showAlert(text || 'שגיאה בשינוי הסיסמה', 'error');
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
                showAlert('📱 סיסמה זמנית נשלחה אליך לווטסאפ!', 'success');
            } else {
                showAlert('📧 סיסמה זמנית נשלחה אליך למייל!', 'success');
            }
            closeModal('forgotModal');
            document.getElementById('forgotForm').reset();
        } else {
            showAlert(data.error || 'שגיאה בשחזור הסיסמה', 'error');
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
            showAlert(data.message, 'success');
            setTimeout(() => {
                closeModal('registerModal');
                document.getElementById('registerForm').reset();
            }, 2000);
        } else {
            const text = await res.text();
            showAlert('שגיאה: ' + text, 'error');
        }
    } catch (err) {
        showAlert('תקלה בהרשמה. אנא נסה שוב.', 'error');
    } finally {
        btn.disabled = false;
    }
});
