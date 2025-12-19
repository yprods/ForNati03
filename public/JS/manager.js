const urlParams = new URLSearchParams(window.location.search);
const userId = urlParams.get('userId');

if (!userId) {
    alert('שגיאת התחברות');
    window.location.href = '/html/index.html';
}

document.addEventListener('DOMContentLoaded', loadManagerData);

function openManagerCalendar() {
    const modal = document.getElementById('calendarModal');
    const container = document.getElementById('calendarContainer');
    modal.style.display = 'flex';
    container.innerHTML = "";
    const calendarEl = document.createElement('div');
    calendarEl.style.height = '100%';
    container.appendChild(calendarEl);

    setTimeout(() => {
        var calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth', locale: 'he', direction: 'rtl', height: '100%',
            headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listWeek' },
            events: `/api/meetings?role=manager&userId=${userId}`
        });
        calendar.render();
    }, 100);
}

async function loadManagerData() {
    const container = document.getElementById('managerProjects');
    container.innerHTML = '<p>טוען נתונים...</p>';

    try {
        const res = await fetch(`/manager/stats?userId=${userId}`);
        const projects = await res.json();

        if (projects.length === 0) {
            container.innerHTML = '<div class="card">אין פרויקטים משויכים אליך.</div>';
            return;
        }

        let html = '';
        projects.forEach(p => {
            const invLink = p.invitation_path ? `<a href="/download-complex-file/invitation/${p.invitation_path}" target="_blank" style="color:#2563eb;">📄 הזמנה לכנס</a>` : '<span style="color:#999;">אין הזמנה</span>';
            const protLink = p.protocol_path ? `<a href="/download-complex-file/protocol/${p.protocol_path}" target="_blank" style="color:#2563eb;">📂 פרוטוקול</a>` : '<span style="color:#999;">אין פרוטוקול</span>';

            let buildingsHtml = '<table style="width:100%; margin-top:15px; font-size:0.9rem; border-collapse:collapse;"><tr><th style="text-align:right;padding:5px;">בניין</th><th style="padding:5px;">חתמו מלא</th><th style="padding:5px;">חתמו חלקי</th></tr>';
            p.buildings_stats.forEach(b => {
                buildingsHtml += `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:5px;">${b.name} (${b.total} דיירים)</td>
                    <td style="padding:5px;"><div style="background:#dcfce7; width:${b.full_pct}%; height:15px; border-radius:5px; min-width:20px; text-align:center; font-size:0.7rem;">${b.full_pct}%</div></td>
                    <td style="padding:5px;"><div style="background:#fef3c7; width:${b.partial_pct}%; height:15px; border-radius:5px; min-width:20px; text-align:center; font-size:0.7rem;">${b.partial_pct}%</div></td>
                </tr>`;
            });
            buildingsHtml += '</table>';

            html += `
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h2 style="margin:0; color:#1e3a8a;">${p.project_name} - מתחם ${p.complex_name}</h2>
                    <div>
                        <button onclick="window.location.href='/export-project/${encodeURIComponent(p.project_name)}?complex=${encodeURIComponent(p.complex_name)}'" style="background:#10b981;">📥 הורד דוח</button>
                    </div>
                </div>

                <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin-bottom:20px; text-align:center;">
                    <div style="background:#dcfce7; padding:10px; border-radius:8px; border:1px solid #86efac;">
                        <div style="font-size:1.5rem; font-weight:bold; color:#166534;">${p.signed_full}</div>
                        <div>חתמו מלא</div>
                    </div>
                    <div style="background:#fef3c7; padding:10px; border-radius:8px; border:1px solid #fcd34d;">
                        <div style="font-size:1.5rem; font-weight:bold; color:#b45309;">${p.signed_partial}</div>
                        <div>חתמו חלקי</div>
                    </div>
                    <div style="background:#eff6ff; padding:10px; border-radius:8px; border:1px solid #bfdbfe;">
                        <div style="font-size:1.5rem; font-weight:bold; color:#1e40af;">${p.meeting}</div>
                        <div>בפגישות</div>
                    </div>
                    <div style="background:#fef2f2; padding:10px; border-radius:8px; border:1px solid #fecaca;">
                        <div style="font-size:1.5rem; font-weight:bold; color:#991b1b;">${p.refused}</div>
                        <div>סרבנים</div>
                    </div>
                </div>

                <label>סטטוס כללי:</label>
                <div class="progress-container" style="display:flex; height:20px; background:#e5e7eb; border-radius:10px; overflow:hidden; margin-bottom:10px;">
                    <div style="width:${p.signed_full_pct}%; background:#10b981;" title="מלא"></div>
                    <div style="width:${p.signed_partial_pct}%; background:#f59e0b;" title="חלקי"></div>
                    <div style="width:${p.refused_pct}%; background:#ef4444;" title="סרבן"></div>
                </div>
                <div style="font-size:0.8rem; display:flex; justify-content:space-between; margin-bottom:20px;">
                    <span style="color:#166534">■ מלא ${p.signed_full_pct}%</span>
                    <span style="color:#b45309">■ חלקי ${p.signed_partial_pct}%</span>
                    <span style="color:#991b1b">■ סרבנים ${p.refused_pct}%</span>
                </div>

                <div style="background:#f9fafb; padding:15px; border-radius:8px; border:1px solid #eee;">
                    <h4 style="margin:0;">פילוח לפי בניינים:</h4>
                    ${buildingsHtml}
                </div>

                <div style="margin-top:15px; display:flex; gap:20px;">
                    ${invLink} ${protLink}
                </div>
            </div>`;
        });

        container.innerHTML = html;

    } catch (e) { container.innerHTML = `<p style="color:red">שגיאה בטעינת נתונים: ${e.message}</p>`; }
}