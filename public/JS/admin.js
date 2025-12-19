document.addEventListener('DOMContentLoaded', () => {
    loadUsers();
    loadProjectStats();
    loadFilters();
    initCalendar();

    // הוספת משתמש חדש - מתוקן עם טלפון ומייל
    document.getElementById('addUserForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('newUsername').value.trim();
        const password = document.getElementById('newPassword').value;
        const role = document.getElementById('newRole').value;
        const phone = document.getElementById('newPhone') ? document.getElementById('newPhone').value.trim() : '';
        const email = document.getElementById('newEmail') ? document.getElementById('newEmail').value.trim() : '';
        
        const errorMsg = document.getElementById('addUserError');
        const successMsg = document.getElementById('addUserSuccess');
        
        // איפוס הודעות קודמות
        if (errorMsg) errorMsg.style.display = 'none';
        if (successMsg) successMsg.style.display = 'none';
        
        // בדיקות צד לקוח
        if (!username) {
            showUserError('אנא הזן שם משתמש');
            return;
        }
        
        if (!password || password.length < 4) {
            showUserError('הסיסמה חייבת להכיל לפחות 4 תווים');
            return;
        }
        
        if (!role) {
            showUserError('אנא בחר תפקיד למשתמש');
            return;
        }

        const btn = e.target.querySelector('button[type="submit"]');
        const originalText = btn ? btn.innerText : 'הוסף משתמש';
        if (btn) {
            btn.disabled = true;
            btn.innerText = 'מוסיף...';
        }

        try {
            const payload = {
                username: username,
                password: password,
                role: role,
                phone: phone || '',
                email: email || ''
            };
            
            console.log('Sending add-user request:', { ...payload, password: '***' });
            
            const res = await fetch('/add-user', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            console.log('Response status:', res.status, res.statusText);

            let data;
            try {
                const text = await res.text();
                console.log('Response text:', text);
                data = JSON.parse(text);
            } catch (parseError) {
                console.error('Failed to parse response:', parseError);
                data = { error: 'שגיאה בפענוח תשובת השרת' };
            }

            if(res.ok && data.success) {
                showUserSuccess(data.message || 'המשתמש נוסף בהצלחה!');
                loadUsers();
                document.getElementById('addUserForm').reset();
            } else {
                const errorMsg = data.error || `שגיאה בהוספת משתמש (קוד: ${res.status})`;
                console.error('Add user failed:', errorMsg);
                showUserError(errorMsg);
            }
        } catch(e) {
            console.error('Add user network error:', e);
            showUserError('תקלה בתקשורת עם השרת. אנא נסה שוב.');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerText = originalText;
            }
        }
    });
    
    function showUserError(message) {
        const errorEl = document.getElementById('addUserError');
        if (errorEl) {
            errorEl.textContent = '❌ ' + message;
            errorEl.style.display = 'block';
            errorEl.style.color = '#991b1b';
            errorEl.style.background = '#fee2e2';
            errorEl.style.padding = '12px';
            errorEl.style.borderRadius = '8px';
            errorEl.style.marginTop = '10px';
            errorEl.style.border = '1px solid #fecaca';
        } else {
            alert('שגיאה: ' + message);
        }
    }
    
    function showUserSuccess(message) {
        const successEl = document.getElementById('addUserSuccess');
        if (successEl) {
            successEl.textContent = '✅ ' + message;
            successEl.style.display = 'block';
            successEl.style.color = '#065f46';
            successEl.style.background = '#d1fae5';
            successEl.style.padding = '12px';
            successEl.style.borderRadius = '8px';
            successEl.style.marginTop = '10px';
            successEl.style.border = '1px solid #a7f3d0';
            setTimeout(() => {
                successEl.style.display = 'none';
            }, 5000);
        } else {
            alert(message);
        }
    }
});

// שלבי הפרויקט
const PROJECT_STAGES = [
    "התארגנות / חתימת נציגות", "בחירת עורך דין דיירים", "מכרז יזמים / בחירת יזם",
    "מו״מ משפטי על ההסכם", "כנס חתימות / החתמות על חוזה", "הגשת תב״ע (תכנון)",
    "שינוי תב״ע (אישור וועדות)", "היתר בניה", "ליווי בנקאי וערבויות", "פינוי דיירים", "הריסה ובניה", "מסירת דירות / אכלוס"
];

// יצירת תיבת בחירה לסטטוס
function generateStatusSelect(currentStatus) {
    let options = PROJECT_STAGES.map(stage =>
        `<option value="${stage}" ${stage === currentStatus ? 'selected' : ''}>${stage}</option>`
    ).join('');

    if (currentStatus && !PROJECT_STAGES.includes(currentStatus)) {
        options += `<option value="${currentStatus}" selected>${currentStatus} (ישן/אחר)</option>`;
    }
    return `<select name="status" style="width:100%; padding: 8px; border:1px solid #ccc; border-radius:4px;">${options}</select>`;
}

// --- העלאת אקסל מהירה (AJAX) ---
async function uploadExcelFile() {
    const fileInput = document.getElementById('excelFile');
    const projectName = document.getElementById('projectName').value.trim();
    const btn = document.getElementById('uploadBtn');
    const errorMsg = document.getElementById('uploadError');
    const successMsg = document.getElementById('uploadSuccess');

    // איפוס הודעות קודמות
    if (errorMsg) errorMsg.style.display = 'none';
    if (successMsg) successMsg.style.display = 'none';

    // בדיקות צד לקוח
    if (!fileInput || !fileInput.files.length) {
        showUploadError('אנא בחר קובץ אקסל להעלאה');
        return;
    }

    if (!projectName) {
        showUploadError('אנא הזן שם פרויקט');
        return;
    }

    // בדיקת סוג קובץ
    const fileName = fileInput.files[0].name.toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls') && !fileName.endsWith('.csv')) {
        showUploadError('סוג קובץ לא נתמך. אנא העלה קובץ אקסל (.xlsx, .xls) או CSV');
        return;
    }

    // בדיקת גודל קובץ (50MB)
    if (fileInput.files[0].size > 50 * 1024 * 1024) {
        showUploadError('הקובץ גדול מדי. מקסימום 50MB');
        return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('project', projectName);

    if (btn) {
        btn.disabled = true;
        btn.innerText = '⏳ מעלה נתונים...';
    }

    try {
        const res = await fetch('/upload', { method: 'POST', body: formData });
        let data;
        try {
            data = await res.json();
        } catch {
            const text = await res.text().catch(() => 'שגיאה לא ידועה');
            data = { error: text };
        }

        if (res.ok && data.success) {
            showUploadSuccess(data.message || 'הקובץ הועלה בהצלחה!');
            loadProjectStats();
            document.getElementById('projectName').value = '';
            fileInput.value = '';
        } else {
            showUploadError(data.error || 'שגיאה בהעלאה. אנא נסה שוב.');
        }
    } catch (e) {
        console.error('Upload error:', e);
        showUploadError('תקלה בתקשורת עם השרת. אנא נסה שוב.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = 'העלה אקסל';
        }
    }
}

function showUploadError(message) {
    const errorEl = document.getElementById('uploadError');
    if (errorEl) {
        errorEl.textContent = '❌ ' + message;
        errorEl.style.display = 'block';
        errorEl.style.color = '#991b1b';
        errorEl.style.background = '#fee2e2';
        errorEl.style.padding = '12px';
        errorEl.style.borderRadius = '8px';
        errorEl.style.marginTop = '10px';
        errorEl.style.border = '1px solid #fecaca';
    } else {
        alert('שגיאה: ' + message);
    }
}

function showUploadSuccess(message) {
    const successEl = document.getElementById('uploadSuccess');
    if (successEl) {
        successEl.textContent = '✅ ' + message;
        successEl.style.display = 'block';
        successEl.style.color = '#065f46';
        successEl.style.background = '#d1fae5';
        successEl.style.padding = '12px';
        successEl.style.borderRadius = '8px';
        successEl.style.marginTop = '10px';
        successEl.style.border = '1px solid #a7f3d0';
        setTimeout(() => {
            successEl.style.display = 'none';
        }, 10000);
    } else {
        showSuccessModal(message);
    }
}

// פונקציית עזר להצגת מודאל הצלחה
function showSuccessModal(msg) {
    let modal = document.getElementById('successModal');
    if (!modal) {
        document.body.insertAdjacentHTML('beforeend', `
        <div id="successModal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;align-items:center;justify-content:center;">
            <div style="background:white;padding:30px;border-radius:12px;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.2); max-width:400px; width:90%;">
                <div style="font-size:3rem;">✅</div>
                <h3 style="color:#10b981; margin-top:10px;">העלאה הושלמה!</h3>
                <p id="succMsg" style="color:#666; margin:15px 0;">${msg}</p>
                <button onclick="document.getElementById('successModal').style.display='none'" style="background:#2563eb; color:white; padding:10px 20px; border:none; border-radius:6px; cursor:pointer;">סגור</button>
            </div>
        </div>`);
        modal = document.getElementById('successModal');
    }
    document.getElementById('succMsg').textContent = msg;
    modal.style.display = 'flex';
}

// --- טעינת מסננים ויומן ---
async function loadFilters() {
    try {
        const [projectsRes, usersRes] = await Promise.all([fetch('/project-stats'), fetch('/users')]);
        const projects = await projectsRes.json();
        const users = await usersRes.json();

        const projSel = document.getElementById('filterProject');
        if(projSel) { projSel.innerHTML = '<option value="">כל הפרויקטים</option>'; projects.forEach(p => projSel.innerHTML += `<option value="${p.project_name}">${p.project_name}</option>`); }

        const lawSel = document.getElementById('filterLawyer');
        if(lawSel) { lawSel.innerHTML = '<option value="">כל העורכי דין</option>'; users.filter(u => u.role === 'lawyer').forEach(l => lawSel.innerHTML += `<option value="${l.id}">${l.username}</option>`); }

        const agentSel = document.getElementById('filterAgent');
        if(agentSel) { agentSel.innerHTML = '<option value="">כל הנציגים</option>'; users.filter(u => u.role === 'user').forEach(u => agentSel.innerHTML += `<option value="${u.id}">${u.username}</option>`); }
    } catch(e) { console.error(e); }
}

function initCalendar() {
    const project = document.getElementById('filterProject')?.value || '';
    const lawyerId = document.getElementById('filterLawyer')?.value || '';
    const agentId = document.getElementById('filterAgent')?.value || '';
    let url = `/api/meetings?t=${Date.now()}`;

    if (project) url += `&project=${encodeURIComponent(project)}`;
    if (lawyerId) url += `&lawyerId=${lawyerId}`;
    if (agentId) url += `&userId=${agentId}`;

    var calendarEl = document.getElementById('calendar');
    if(calendarEl) {
        calendarEl.innerHTML = '';
        var calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            locale: 'he',
            direction: 'rtl',
            height: '100%',
            headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listWeek' },
            events: url,
            eventClick: function(info) {
                const p = info.event.extendedProps;
                alert(`פגישה: ${info.event.title}\nדייר: ${p.name || ''}\nטלפון: ${p.phone || ''}`);
            }
        });
        calendar.render();
    }
}

// --- ניהול משתמשים ---
async function loadUsers() {
    try {
        const res = await fetch('/users');
        const users = await res.json();

        const active = users.filter(u=>u.is_approved);
        const pending = users.filter(u=>!u.is_approved);

        // רשימת משתמשים פעילים (מעודכן עם טלפון ומייל)
        document.getElementById('userList').innerHTML = active.map(u => `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding:8px;">
                <div>
                    <b>${u.username}</b> (${u.role})
                    <div style="font-size:0.8rem; color:#666;">
                        ${u.phone ? `📞 ${u.phone}` : ''} 
                        ${u.email ? ` | ✉️ ${u.email}` : ''}
                    </div>
                </div>
                <button onclick="deleteUser(${u.id})" style="background:#ef4444; padding:5px 10px; font-size:0.8rem;">מחק</button>
            </div>
        `).join('');

        // רשימת ממתינים לאישור
        document.getElementById('pendingUsersList').innerHTML = pending.length ? pending.map(u => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; background:#fffbe6; margin-bottom:5px; border-radius:4px;">
                <div>
                    <b>${u.username}</b> (${u.phone||'-'})
                    <div style="font-size:0.8rem;">${u.email||'-'}</div>
                </div>
                <div>
                    <select id="role-${u.id}" style="padding:2px;"><option value="user">נציג</option><option value="manager">מנהל</option><option value="lawyer">עו"ד</option></select>
                    <button onclick="approveUser(${u.id})" style="background:#10b981; padding:2px 5px;">אשר</button>
                    <button onclick="deleteUser(${u.id})" style="background:#ef4444; padding:2px 5px;">מחק</button>
                </div>
            </div>`).join('') : '<p style="color:#666;">אין משתמשים ממתינים.</p>';

    } catch(e) {}
}

async function approveUser(id) {
    const role = document.getElementById(`role-${id}`).value;
    await fetch('/approve-user', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id, role})});
    loadUsers();
}

async function deleteUser(id) {
    if(confirm('האם למחוק משתמש זה?')) {
        await fetch('/delete-user', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id})});
        loadUsers();
    }
}

// --- סטטיסטיקות וניהול פרויקטים ---
async function loadProjectStats() {
    try {
        const [statsRes, usersRes] = await Promise.all([fetch('/project-stats'), fetch('/users')]);
        const stats = await statsRes.json();

        document.getElementById('projectStats').innerHTML = stats.map(s => `
            <div class="card" style="margin-bottom:15px; border-right:5px solid #2563eb;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h4 style="margin:0;">${s.project_name}</h4>
                    <div style="display:flex; gap:5px;">
                        <button onclick="showComplexManagement('${encodeURIComponent(s.project_name)}')" style="background:#f59e0b; padding:5px 10px; font-size:0.9rem;">🏢 ניהול מתחמים</button>
                        <button onclick="window.location.href='/export-project/${encodeURIComponent(s.project_name)}'" style="background:#3b82f6; padding:5px 10px; font-size:0.9rem;">📥 דוח</button>
                        <button onclick="deleteProject('${encodeURIComponent(s.project_name)}')" style="background:#ef4444; padding:5px 10px; font-size:0.9rem;">🗑️</button>
                    </div>
                </div>
                <div style="font-size:0.9rem; color:#666; margin-top:5px;">סה"כ דיירים: ${s.total} | חתמו: ${s.signed}</div>
            </div>`).join('');
    } catch(e) { document.getElementById('projectStats').innerHTML = 'שגיאה בטעינת נתונים'; }
}

async function deleteProject(encodedProject) {
    const project = decodeURIComponent(encodedProject);
    if (!confirm(`האם למחוק את כל הפרויקט "${project}"? פעולה זו תמחק את כל הדיירים והנתונים!`)) return;
    try {
        const res = await fetch('/delete-project', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ project_name: project }) });
        if (res.ok) { alert('הפרויקט נמחק בהצלחה'); loadProjectStats(); } else alert('שגיאה במחיקה');
    } catch (e) { alert('תקלה בתקשורת'); }
}

async function deleteComplex(project, complex) {
    if (!confirm(`האם למחוק את מתחם "${complex}"?`)) return;
    try {
        const res = await fetch('/delete-complex', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ project_name: project, complex_name: complex }) });
        if (res.ok) {
            alert('המתחם נמחק');
            document.getElementById('detailsModal').style.display='none';
            showComplexManagement(encodeURIComponent(project)); // רענון המודאל
        } else alert('שגיאה');
    } catch (e) { alert('תקלה'); }
}

// --- חלונית ניהול מתחמים ---
async function showComplexManagement(encodedProject) {
    const project = decodeURIComponent(encodedProject);
    const modal = document.getElementById('detailsModal');
    const content = document.getElementById('modalContent');
    document.getElementById('modalTitle').textContent = `ניהול מתחמים: ${project}`;
    modal.style.display = 'block';
    content.innerHTML = '<p style="text-align:center;">טוען נתונים...</p>';

    try {
        const [complexesRes, usersRes] = await Promise.all([fetch(`/api/complexes-data?project=${encodedProject}`), fetch('/users')]);
        const complexesData = await complexesRes.json();
        const users = await usersRes.json();

        const managers = users.filter(u => u.role === 'manager');
        const lawyers = users.filter(u => u.role === 'lawyer');
        const agents = users.filter(u => u.role === 'user');

        if (complexesData.length === 0) { content.innerHTML = '<p>לא נמצאו מתחמים בפרויקט זה.</p>'; return; }

        content.innerHTML = complexesData.map(c => {
            const formId = `form-${c.complex_name.replace(/\s/g, '_')}`;
            const invLink = c.invitation_path ? `<a href="/download-complex-file/invitation/${c.invitation_path}" target="_blank" style="font-size:0.8rem;color:blue;">הזמנה קיימת</a>` : '';
            const protLink = c.protocol_path ? `<a href="/download-complex-file/protocol/${c.protocol_path}" target="_blank" style="font-size:0.8rem;color:blue;">פרוטוקול קיים</a>` : '';

            return `
            <div style="border:1px solid #ddd; padding:15px; border-radius:8px; background:#f9f9f9; margin-bottom:15px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                    <h3 style="margin:0; color:#2563eb;">מתחם ${c.complex_name}</h3>
                    <button onclick="deleteComplex('${project}', '${c.complex_name}')" style="background:#ef4444; width:auto; font-size:0.8rem;">🗑️ מחק מתחם</button>
                </div>
                
                <form id="${formId}" onsubmit="return false;">
                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:10px;">
                        <div><label>מנהל:</label><select name="manager_id" style="width:100%"><option value="">בחר</option>${managers.map(u=>`<option value="${u.id}" ${u.id==c.manager_id?'selected':''}>${u.username}</option>`).join('')}</select></div>
                        <div><label>עו"ד:</label><select name="lawyer_id" style="width:100%"><option value="">בחר</option>${lawyers.map(u=>`<option value="${u.id}" ${u.id==c.lawyer_id?'selected':''}>${u.username}</option>`).join('')}</select></div>
                        <div><label>נציג:</label><select name="agent_id" style="width:100%"><option value="">בחר</option>${agents.map(u=>`<option value="${u.id}" ${u.id==c.agent_id?'selected':''}>${u.username}</option>`).join('')}</select></div>
                        
                        <div><label>סטטוס:</label>${generateStatusSelect(c.status)}</div>
                        
                        <div><label>כנס:</label><input type="text" name="conference_name" value="${c.conference_name}" placeholder="שם הכנס"></div>
                        <div><label>תאריך:</label><input type="datetime-local" name="conference_date" value="${c.conference_date}"></div>
                        
                        <div><label>הזמנה:</label><input type="file" name="invitation" style="font-size:0.8rem;"> ${invLink}</div>
                        <div><label>פרוטוקול:</label><input type="file" name="protocol" style="font-size:0.8rem;"> ${protLink}</div>
                    </div>
                    <div style="margin-top:10px; text-align:center;">
                        <button onclick="saveComplexSettings('${project}', '${c.complex_name}', '${formId}')" style="background:#10b981; width:100%; max-width:200px;">שמור שינויים</button>
                    </div>
                </form>
            </div>`;
        }).join('');
    } catch(e) { content.innerHTML = '<p>שגיאה בטעינת נתונים</p>'; }
}

async function saveComplexSettings(projectName, complexName, formId) {
    const form = document.getElementById(formId);
    const formData = new FormData(form);

    // הוספת מזהים שלא נמצאים בטופס
    formData.append('project_name', projectName);
    formData.append('complex_name', complexName);

    try {
        const res = await fetch('/api/update-complex', { method: 'POST', body: formData });
        if (res.ok) alert('הגדרות המתחם עודכנו בהצלחה!'); else alert('שגיאה בעדכון');
    } catch(e) { alert('תקלה בתקשורת'); }
}
