import { api, me, ask, $, esc } from '../core.js';
export default async function (el) {
  async function draw(msg = '') {
    const { rows } = await api('day_close?select=id,closed_date,closed_by,created_at&order=closed_date.desc&limit=20'), last = rows[0] && rows[0].closed_date;
    el.innerHTML = `<div class="card" style="padding:16px;display:grid;gap:10px;max-width:520px"><div>${last ? `Everything up to <b>${esc(last)}</b> is closed.` : 'No day has been closed yet.'} Users without the special permission cannot change closed days.</div>
    <div class="bar" style="margin:0"><input id="d" type="date" aria-label="Close through date"><button class="btn p" id="c">Close day</button>${last ? '<button class="btn" id="r">Re-open last close</button>' : ''}</div><div id="m" class="${msg.startsWith('!') ? 'err' : ''}">${esc(msg.replace(/^!/, ''))}</div></div>
    <div class="card" style="margin-top:14px"><div class="tw"><table><thead><tr><th>Closed up to</th><th>By</th><th>Recorded</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.closed_date)}</td><td>${esc(r.closed_by)}</td><td>${esc(String(r.created_at || '').slice(0, 16).replace('T', ' '))}</td></tr>`).join('') || '<tr><td colspan="3">No history yet.</td></tr>'}</tbody></table></div></div>`;
    $('#c').onclick = async () => { const d = $('#d').value; if (!d) return draw('!Choose a date.'); if (last && d <= last) return draw(`!Everything up to ${last} is already closed.`);
      if (!await ask(`Close every day up to ${d}? Nobody without the special permission can change these days afterwards.`)) return;
      try { await api('day_close', { method: 'POST', body: { closed_date: d, closed_by: me().email || '' } }); draw('Day closed.'); } catch (e) { draw('!' + e.message); } };
    if ($('#r')) $('#r').onclick = async () => { if (!await ask(`Re-open the close up to ${last}?`)) return; try { await api('day_close?id=eq.' + rows[0].id, { method: 'DELETE' }); draw('Re-opened.'); } catch (e) { draw('!' + e.message); } };
  }
  await draw();
}
