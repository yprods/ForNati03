const urlParams = new URLSearchParams(window.location.search);
const userId = urlParams.get('userId');

// הפניה לדף כניסה אם אין מזהה משתמש
if (!userId) location.href = '/html/index.html';

let allBuildings = [], groupedComplexes = {}, currentView = 'complexes', currentComplex = null, currentAddress = null, currentProject = null;

// משתנה גלובלי לניהול הצ'אט (מול הדייר)
window.currentResidentIdForChat = null;

document.addEventListener('DOMContentLoaded', () => {
    initData();

    // --- אתחול צ'אט צוות מרחף ---
    loadStaffUsers();

    // רענון אוטומטי לצ'אט הצוות (כל 10 שניות, רק אם החלון פתוח)
    setInterval(() => {
        const chatWin = document.getElementById('staffChatWindow');
        if (chatWin && chatWin.style.display === 'flex') {
            loadStaffChatHistory();
        }
    }, 10000);

    // כפתור חזור
    const backBtn = document.getElementById('backBtn');
    if(backBtn) {
        backBtn.onclick = () => {
            if(currentView === 'buildings') renderComplexes();
            else if(currentView === 'residents') renderBuildings(currentComplex);
        };
    }

    // שליחת טופס שמירת דייר
    const editForm = document.getElementById('editForm');
    if(editForm) {
        editForm.onsubmit = async (e) => {
            e.preventDefault();
            await saveResident();
        };
    }

    // --- מאזינים לשינויים בטופס (לוגיקה דינמית) ---

    // 1. סטטוס שוטף -> פגישה
    const statusSelect = document.getElementById('editStatus');
    if (statusSelect) {
        statusSelect.onchange = (e) => {
            document.getElementById('meetingDiv').style.display = e.target.value === 'נקבעה פגישה' ? 'block' : 'none';
        };
    }

    // 2. סטטוס ייצוג -> סירוב/חוסרים
    const repSelect = document.getElementById('editRepresentationStatus');
    if (repSelect) {
        repSelect.onchange = (e) => {
            document.getElementById('refusalReasonDiv').style.display = e.target.value === 'סרבן' ? 'block' : 'none';
            document.getElementById('unsignedOwnersDiv').style.display = e.target.value === 'חתם חלקי' ? 'block' : 'none';
        };
    }

    // 3. מושכר -> פרטי שוכר
    const renterSelect = document.getElementById('editIsRenter');
    if (renterSelect) {
        renterSelect.addEventListener('change', (e) => {
            const div = document.getElementById('tenantDetailsDiv');
            if (div) div.style.display = e.target.value === 'כן' ? 'block' : 'none';
        });
    }
});

// --- טעינת נתונים ראשונית ---
async function initData() {
    try {
        const res = await fetch(`/my-buildings?userId=${userId}`);
        allBuildings = await res.json();

        // קיבוץ לפי מתחמים
        groupedComplexes = allBuildings.reduce((acc, item) => {
            const c = item.complex_name || 'כללי';
            if(!acc[c]) acc[c]=[];
            acc[c].push(item);
            return acc;
        }, {});

        renderComplexes();
    } catch(e) {
        console.error(e);
        const main = document.getElementById('mainContent');
        if(main) main.innerHTML = '<p style="text-align:center;">שגיאה בטעינת נתונים</p>';
    }
}

// --- רינדור תצוגות (מתחמים/בניינים/דיירים) ---

function renderComplexes() {
    currentView = 'complexes';
    document.getElementById('navBar').style.display = 'none';
    document.getElementById('complexHeader').style.display = 'none';

    const container = document.getElementById('mainContent');

    if (Object.keys(groupedComplexes).length === 0) {
        container.innerHTML = '<p style="text-align:center;">אין פרויקטים משוייכים.</p>';
        return;
    }

    container.innerHTML = Object.keys(groupedComplexes).map(c => `
        <div class="card" onclick="renderBuildings('${c}')" style="cursor:pointer;">
            <h3>🏢 מתחם ${c}</h3>
            <div style="color:var(--text-muted);">${groupedComplexes[c].length} בניינים</div>
        </div>
    `).join('');
}

async function renderBuildings(cName) {
    currentView = 'buildings';
    currentComplex = cName;

    document.getElementById('navBar').style.display = 'flex';
    document.getElementById('navTitle').innerText = cName;

    const container = document.getElementById('mainContent');
    const sample = groupedComplexes[cName][0];
    currentProject = sample.project_name;

    // הצגת כותרת מתחם
    const header = document.getElementById('complexHeader');
    header.style.display = 'block';

    // איפוס נתונים בזמן טעינה
    document.getElementById('infoLawyer').innerText = 'טוען...';
    document.getElementById('infoConference').innerText = 'טוען...';
    document.getElementById('infoProtocol').innerText = 'טוען...';

    // משיכת נתוני מטא של המתחם
    try {
        const metaRes = await fetch(`/api/complex-details?project=${encodeURIComponent(currentProject)}&complex=${encodeURIComponent(cName)}`);
        const meta = await metaRes.json();

        document.getElementById('infoLawyer').innerText = meta.lawyerName || 'לא הוקצה';

        if (meta.conference_date) {
            const d = new Date(meta.conference_date);
            document.getElementById('infoConference').innerText = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()} (${meta.conference_name})`;
        } else {
            document.getElementById('infoConference').innerText = 'לא נקבע';
        }

        if (meta.protocol_path) {
            document.getElementById('infoProtocol').innerHTML = `<a href="/download-complex-file/protocol/${meta.protocol_path}" target="_blank" style="color:var(--accent);">הורד קובץ</a>`;
        } else {
            document.getElementById('infoProtocol').innerText = 'אין';
        }

    } catch(e) { console.error(e); }

    // רינדור רשימת הבניינים
    container.innerHTML = groupedComplexes[cName].map(b => `
        <div class="card" onclick="showResidents('${b.project_name}', '${b.address}')" style="cursor:pointer; border-right: 4px solid var(--accent);">
            <h3>📍 ${b.address}</h3>
            <div style="margin-bottom:5px;">${b.stats.full_pct}% חתומים</div>
            <div class="progress-bg">
                <div class="progress-fill gold" style="width:${b.stats.full_pct}%;"></div>
            </div>
        </div>
    `).join('');
}

async function showResidents(proj, addr) {
    currentView = 'residents';
    currentAddress = addr;

    document.getElementById('navTitle').innerText = addr;
    const container = document.getElementById('mainContent');
    container.innerHTML = '<p style="text-align:center;">טוען דיירים...</p>';

    try {
        const res = await fetch(`/residents-by-address?project=${encodeURIComponent(proj)}&address=${encodeURIComponent(addr)}`);
        const residents = await res.json();

        // מיון לפי מספר דירה
        residents.sort((a,b) => (parseInt(a.sub_parcel)||999)-(parseInt(b.sub_parcel)||999));

        // הבאת בעלים נוספים
        const enriched = await Promise.all(residents.map(async r => {
            try {
                const sec = await fetch(`/api/secondary-owners/${r.id}`).then(res=>res.json());
                return {...r, secondary: sec};
            } catch(e) { return {...r, secondary: []}; }
        }));

        container.innerHTML = enriched.map(r => {
            // חישוב סטטוסים לתצוגה
            let isSignedContract = r.lawyer_status === 'חתם מלא' || r.status === 'חתם חוזה';
            let isPartial = r.lawyer_status === 'חתם חלקי';

            let cls = isSignedContract ? 'status-signed' : (isPartial ? 'status-partial' : (r.status==='סרבן'?'status-none':'bg-gray'));
            let statusText = isSignedContract ? 'חתם חוזה' : (isPartial ? 'חסרים מסמכים' : (r.status || 'חדש'));

            // רשימת בעלים
            let ownersHtml = `<div>1. <b>${r.name}</b> ${r.id_number?`<small>(${r.id_number})</small>`:''}</div>`;
            if (r.secondary && r.secondary.length > 0) {
                ownersHtml += r.secondary.map((s, i) => `<div style="font-size:0.9em; color:#555;">${i+2}. ${s.name}</div>`).join('');
            }

            // הצגת הערת אזהרה בכרטיס הראשי (אם יש)
            let warningHtml = (r.warning_note && r.warning_note !== 'לא' && r.warning_note.trim() !== '')
                ? `<div style="color:#dc2626; font-size:0.85rem; margin-top:5px; font-weight:bold;">⚠️ הערת אזהרה: ${r.warning_note}</div>`
                : '';

            // אייקון מנעול אם חתם
            let lockIcon = isSignedContract ? '🔒' : '';

            return `
            <div class="card resident-list-item" onclick='openEdit(${JSON.stringify(r).replace(/'/g,"&#39;")})'>
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <span style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-size:0.8rem; font-weight:bold;">דירה ${r.sub_parcel}</span>
                        <div style="margin-top:8px;">${ownersHtml}</div>
                        ${warningHtml}
                    </div>
                    <div style="text-align:left;">
                        <span class="status-badge ${cls}">${lockIcon} ${statusText}</span>
                    </div>
                </div>
            </div>`;
        }).join('');
    } catch(e) {
        console.error(e);
        container.innerHTML = '<p style="text-align:center;">שגיאה בטעינת דיירים</p>';
    }
}

// --- פתיחת כרטיס דייר (עריכה) ---
async function openEdit(r) {
    const set = (id, val) => {
        const el = document.getElementById(id);
        if(el) el.value = val || '';
    };

    // מילוי שדות בסיסיים
    set('editId', r.id);
    set('editPhone', r.phone);
    set('editIdNum', r.id_number);
    set('editStatus', r.status);
    set('editRepresentationStatus', r.representation_status || 'טרם חתם');
    set('editRefusalReason', r.representation_refusal_reason);
    set('editUnsignedOwners', r.unsigned_owners);
    set('editNote', r.note);
    set('editActualAddress', r.actual_address);
    // הערה: warning_note לא נטען לשדה עריכה כי זה קריאה בלבד

    // --- טיפול בהערת אזהרה (קריאה בלבד) ---
    const warningDiv = document.getElementById('warningDisplay');
    if (r.warning_note && r.warning_note !== 'לא' && r.warning_note.trim() !== '') {
        if(warningDiv) {
            warningDiv.style.display = 'block';
            warningDiv.innerText = `⚠️ הערת אזהרה: ${r.warning_note}`;
        }
    } else {
        if(warningDiv) warningDiv.style.display = 'none';
    }

    // --- טיפול בשוכרים ---
    set('editIsRenter', r.is_renter || 'לא');
    set('editTenantName', r.tenant_name || '');
    set('editTenantPhone', r.tenant_phone || '');

    const tenantDiv = document.getElementById('tenantDetailsDiv');
    if (tenantDiv) {
        tenantDiv.style.display = (r.is_renter === 'כן') ? 'block' : 'none';
    }

    // הצגת רשימת בעלים יפה
    let ownersText = `1. ${r.name} (${r.id_number||'-'})`;
    if (r.secondary && r.secondary.length > 0) {
        ownersText += '<br>' + r.secondary.map((s, i) => `${i+2}. ${s.name} (${s.id_number||'-'})`).join('<br>');
    }
    document.getElementById('ownersListDisplay').innerHTML = ownersText;

    // --- לוגיקת נעילה (חלק קריטי) ---
    const isLocked = (r.lawyer_status === 'חתם מלא') || (r.status === 'חתם חוזה');
    const lockedMsg = document.getElementById('lockedMsg');
    const saveBtn = document.getElementById('saveBtn');
    const formInputs = document.querySelectorAll('#editForm input, #editForm select, #editForm textarea');

    if (isLocked) {
        // מצב נעול
        if(lockedMsg) lockedMsg.style.display = 'block';
        if(saveBtn) saveBtn.style.display = 'none';
        formInputs.forEach(input => { input.disabled = true; input.style.opacity = '0.7'; });
    } else {
        // מצב פתוח לעריכה
        if(lockedMsg) lockedMsg.style.display = 'none';
        if(saveBtn) saveBtn.style.display = 'block';
        formInputs.forEach(input => { input.disabled = false; input.style.opacity = '1'; });
    }

    // ניהול תצוגת שדות דינמיים (רק אם לא נעול)
    const meetingDiv = document.getElementById('meetingDiv');
    const refusalDiv = document.getElementById('refusalReasonDiv');
    const unsignedDiv = document.getElementById('unsignedOwnersDiv');

    if(meetingDiv) meetingDiv.style.display = r.status==='נקבעה פגישה'?'block':'none';
    if(refusalDiv) refusalDiv.style.display = r.representation_status==='סרבן'?'block':'none';
    if(unsignedDiv) unsignedDiv.style.display = r.representation_status==='חתם חלקי'?'block':'none';

    // --- מסמכים חסרים + צ'אט ---

    // לוגיקה: מה שהעורך דין *לא* סימן, נחשב חסר ונשמר ב-DB כחסר.
    // כאן אנחנו רק מציגים את מה שנשמר ב-missing_docs_json.
    handleMissingDocsUI(r);

    window.currentResidentIdForChat = r.id;
    loadChatHistory(r.id); // טעינת צ'אט בוט

    document.getElementById('editModal').style.display = 'flex';
}

// --- שמירת דייר ---
async function saveResident() {
    const id = document.getElementById('editId').value;
    const status = document.getElementById('editStatus').value;
    const date = document.getElementById('editDate').value;

    if(status === 'נקבעה פגישה' && !date) {
        alert('חובה להזין תאריך לפגישה');
        return;
    }

    const btn = document.getElementById('saveBtn');
    btn.innerText = 'שומר...';
    btn.disabled = true;

    try {
        // איסוף נתונים (כולל שוכר)
        const payload = {
            id, status,
            phone: document.getElementById('editPhone').value,
            id_number: document.getElementById('editIdNum').value,
            note: document.getElementById('editNote').value,

            // שוכר
            is_renter: document.getElementById('editIsRenter').value,
            tenant_name: document.getElementById('editTenantName') ? document.getElementById('editTenantName').value : '',
            tenant_phone: document.getElementById('editTenantPhone') ? document.getElementById('editTenantPhone').value : '',

            actual_address: document.getElementById('editActualAddress').value,
            representation_status: document.getElementById('editRepresentationStatus').value,
            representation_refusal_reason: document.getElementById('editRefusalReason').value,
            unsigned_owners: document.getElementById('editUnsignedOwners').value,

            // שים לב: warning_note לא נשלח כי הוא קריאה בלבד!
        };

        // שמירה לשרת
        await fetch('/update-resident-data', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });

        // יצירת פגישה אם צריך
        if(status === 'נקבעה פגישה') {
            await fetch('/api/add-task', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    resident_id: id,
                    user_id: userId,
                    title: `פגישה (${document.getElementById('meetingType').value})`,
                    due_date: date,
                    meeting_type: document.getElementById('meetingType').value
                })
            });
        }

        document.getElementById('editModal').style.display = 'none';

        // רענון רשימה
        if(currentProject && currentAddress) {
            showResidents(currentProject, currentAddress);
        } else {
            renderComplexes();
        }

    } catch(e) {
        alert('שגיאה בשמירה');
        console.error(e);
    } finally {
        btn.innerText = 'שמור שינויים';
        btn.disabled = false;
    }
}

// --- מסמכים חסרים (מוצג לנציג) ---
function handleMissingDocsUI(r) {
    const container = document.getElementById('missingDocsContainer');
    const list = document.getElementById('missingDocsList');

    // אם העורך דין סימן ב'חתם חלקי', המערכת שמרה ב-DB את מה ש*חסר*.
    if (r.lawyer_status === 'חתם חלקי' && r.missing_docs_json) {
        try {
            const missing = JSON.parse(r.missing_docs_json);
            let hasItems = false;
            let html = '';

            // רשימת מסמכים שחסרים
            if (missing.docs && missing.docs.length > 0) {
                hasItems = true;
                missing.docs.forEach(docName => {
                    html += `
                    <div class="missing-item-row">
                        <span>📄 <b>חסר:</b> ${docName}</span>
                        <label class="upload-btn-mini">
                            העלה קובץ
                            <input type="file" style="display:none;" onchange="uploadSpecificDoc(this, '${docName}', ${r.id})">
                        </label>
                    </div>`;
                });
            }

            // רשימת בעלים שלא חתמו
            if (missing.owners && missing.owners.length > 0) {
                hasItems = true;
                html += `<div style="margin-top:10px; font-size:0.9rem; color:#991b1b;">
                    <b>דיירים שטרם חתמו:</b> ${missing.owners.join(', ')}
                </div>`;
            }

            if (hasItems) {
                container.style.display = 'block';
                list.innerHTML = html;
            } else { container.style.display = 'none'; }

        } catch (e) { container.style.display = 'none'; }
    } else { container.style.display = 'none'; }
}

// העלאת קובץ ספציפי
async function uploadSpecificDoc(input, docType, residentId) {
    if (!input.files[0]) return;
    const fd = new FormData();
    fd.append('doc', input.files[0]);
    fd.append('resident_id', residentId);
    fd.append('doc_type', docType);
    fd.append('uploaded_by_role', 'agent');

    const label = input.parentElement;
    const originalText = label.innerText;
    label.innerText = 'מעלה...';

    try {
        const res = await fetch('/upload-resident-doc', { method: 'POST', body: fd });
        if (res.ok) {
            label.innerText = '✅ הועלה!';
            label.style.background = '#10b981';

            // עדכון אוטומטי בצ'אט בוט שהקובץ הועלה
            await fetch('/api/chat/send', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    resident_id: residentId,
                    message: `העלאת קובץ חסר: ${docType}`,
                    sender_name: 'מערכת'
                })
            });
            loadChatHistory(residentId); // רענון היסטוריית הצ'אט
        } else {
            alert('שגיאה בהעלאה');
            label.innerText = originalText;
        }
    } catch (e) { alert('תקלה בתקשורת'); label.innerText = originalText; }
}

// --- צ'אט בוט (בתוך כרטיס דייר) ---
async function loadChatHistory(residentId) {
    const chatBox = document.getElementById('chatMessages');
    chatBox.innerHTML = '<div style="text-align:center; color:#aaa;">טוען הודעות...</div>';

    try {
        const res = await fetch(`/api/chat/history/${residentId}`);
        const messages = await res.json();

        if (messages.length === 0) {
            chatBox.innerHTML = '<div style="text-align:center; color:#aaa; margin-top:20px;">אין הודעות עדיין.</div>';
            return;
        }

        chatBox.innerHTML = messages.map(m => {
            const isMe = m.sender_name === 'נציג' || m.sender_name === 'מערכת';
            const cls = isMe ? 'msg-outgoing' : 'msg-incoming';
            const date = new Date(m.timestamp).toLocaleString('he-IL', {hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit'});

            return `
            <div class="message-bubble ${cls}">
                <div>${m.message}</div>
                <div class="msg-meta">
                    <span>${m.sender_name || 'אנונימי'}</span>
                    <span>${date}</span>
                </div>
            </div>`;
        }).join('');
        chatBox.scrollTop = chatBox.scrollHeight;
    } catch (e) { chatBox.innerHTML = 'שגיאה בטעינת צ\'אט'; }
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;
    if (!window.currentResidentIdForChat) return;

    input.value = '';

    try {
        await fetch('/api/chat/send', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                resident_id: window.currentResidentIdForChat,
                message: message,
                sender_name: 'נציג'
            })
        });
        loadChatHistory(window.currentResidentIdForChat);
    } catch (e) { alert('שגיאה בשליחת הודעה'); }
}

// --- צ'אט צוות מרחף (Floating Staff Chat) ---

// 1. פתיחה/סגירה
function toggleStaffChat() {
    const win = document.getElementById('staffChatWindow');
    if (win.style.display === 'flex') {
        win.style.display = 'none';
    } else {
        win.style.display = 'flex';
        loadStaffChatHistory();
    }
}

// 2. טעינת משתמשים (נציגים/מנהלים)
async function loadStaffUsers() {
    try {
        const res = await fetch('/api/staff/users');
        const users = await res.json();
        const sel = document.getElementById('staffChatRecipient');
        if (sel) {
            sel.innerHTML = '<option value="all">📢 לכולם</option>';
            users.forEach(u => {
                if(u.id != userId) {
                    const opt = document.createElement('option');
                    opt.value = u.id;
                    opt.innerText = `${u.username} (${u.role})`;
                    sel.appendChild(opt);
                }
            });
        }
    } catch(e){}
}

// 3. טעינת היסטוריה
async function loadStaffChatHistory() {
    const container = document.getElementById('staffChatBody');
    if(!container) return;

    try {
        const res = await fetch(`/api/staff/history?userId=${userId}`);
        const msgs = await res.json();

        container.innerHTML = msgs.map(m => {
            const isMe = m.sender_id == userId;
            const cls = isMe ? 'mine' : 'others';
            let fileHtml = '';
            if(m.file_path) {
                fileHtml = `<a href="/staff-files/${m.file_path}" target="_blank" class="staff-file-link">📎 ${m.file_name || 'קובץ'}</a>`;
            }
            return `
            <div class="staff-msg ${cls}">
                <small>${m.sender_name}</small>
                <div>${m.message}</div>
                ${fileHtml}
            </div>`;
        }).join('');
        container.scrollTop = container.scrollHeight;
    } catch(e){}
}

// 4. שליחת הודעה + קובץ
async function sendStaffMessage() {
    const msg = document.getElementById('staffChatMsg').value;
    const recipient = document.getElementById('staffChatRecipient').value;
    const fileInput = document.getElementById('staffChatFile');

    if(!msg && !fileInput.files.length) return;

    const fd = new FormData();
    fd.append('sender_id', userId);
    fd.append('recipient_id', recipient);
    fd.append('message', msg);
    if(fileInput.files[0]) fd.append('file', fileInput.files[0]);

    try {
        await fetch('/api/staff/send', { method: 'POST', body: fd });
        document.getElementById('staffChatMsg').value = '';
        fileInput.value = '';
        loadStaffChatHistory();
    } catch(e) { alert('שגיאה בשליחה'); }
}

// --- יומן משימות ---
function openUserCalendar() {
    const modal = document.getElementById('calendarModal');
    const container = document.getElementById('calendarContainer');

    modal.style.display = 'flex';
    container.innerHTML = '';

    setTimeout(() => {
        new FullCalendar.Calendar(container, {
            initialView: 'listWeek',
            locale: 'he',
            direction: 'rtl',
            height: '100%',
            headerToolbar: { left: 'prev,next', center: 'title', right: 'listWeek,dayGridMonth' },
            events: `/api/tasks?userId=${userId}`
        }).render();
    }, 100);
}

function searchResidents() {
    const term = prompt("חיפוש דייר (שם או תעודת זהות):");
    if(term) {
        alert("פונקציונליות חיפוש מתקדמת תתווסף בהמשך. כרגע ניתן לנווט ידנית.");
    }
}
