import { api, all, bust, can, $, esc } from '../core.js';
import { fmt } from '../util.js';
// Fee update (old "Bulk Updation & Annual Increments"): one increments row per student, matched on the trimmed admission number.
const N = 100, num = v => parseFloat(v) || 0, trim = v => String(v ?? '').trim();
export default async function (el) {
  const probe = (await api('students?select=*', { range: [0, 0] })).rows[0] || {}, cols = ['admis_no', 'sr_no', 'student_name', 'class', 'status', 'monthly_tution_fee', 'annual_fund'].filter(c => c in probe);
  const [stu, inc] = await Promise.all([all('students?select=' + cols.join(','), 0), all('increments?select=*', 0)]);
  const yr = new Date().getFullYear(), ex = new Map(inc.map(i => [trim(i.admis_no), i])), canSave = can('increments', 'e') || can('increments', 'a'); let pg = 0; const f = { q: '', c: '', s: 'a' }, sel = new Set();
  const S = new Map(); const rows = stu.map(s => { const adm = trim(s.admis_no || s.sr_no), e = ex.get(adm), old = num(e ? (e.old_fee || s.monthly_tution_fee) : s.monthly_tution_fee);
    const r = { adm, name: trim(s.student_name), cls: trim(s.class), on: !trim(s.status) || /^active$/i.test(trim(s.status)), ex: e || null, fee_type: e ? (e.fee_type || 'tution fee') : 'tution fee', old_fee: old, fee_increament: e ? num(e.fee_increament) : '', new_fee: e ? num(e.new_fee) : '',
      effective_period: e ? (e.effective_period || `March ${yr}`) : `March ${yr}`, annual_fund: e ? (e.annual_fund ?? s.annual_fund ?? '') : (s.annual_fund ?? ''), remarks: e ? (e.remarks || '') : '', dirty: false }; S.set(adm, r); return r; }).filter(r => r.adm);
  const classes = [...new Set(rows.map(r => r.cls).filter(Boolean))].sort();
  el.innerHTML = `<div class="card" style="padding:14px;margin-bottom:12px;display:grid;gap:8px"><b>Apply to selected students</b><div class="bar" style="margin:0"><select id="bt"><option value="tution fee">Tuition fee<option value="annual fund">Annual fund</select><select id="bk"><option value="amount">Amount (PKR)<option value="percentage">Percentage (%)</select>
  <input id="bv" type="number" min="0" step="any" placeholder="Value" aria-label="Value"><input id="bp" value="March ${yr}" aria-label="Effective period" placeholder="Effective period"><button class="btn" id="ap">Apply to selected</button>${canSave ? '<button class="btn p" id="sv">Save changes</button>' : ''}</div><div id="ms" class="sub" style="padding:0">Apply fills the table only. Nothing reaches the database until you press Save changes.</div></div>
  <div class="bar"><input id="q" type="search" placeholder="Search name or admission no" aria-label="Search"><select id="c" aria-label="Class"><option value="">All classes${classes.map(c => `<option>${esc(c)}`).join('')}</select><select id="s" aria-label="Status"><option value="a">Active<option value="">All students</select></div>
  <div class="card"><div class="tw" id="tb"></div><div class="pager"><button class="btn" id="pv">‹ Prev</button><span id="in"></span><button class="btn" id="nx">Next ›</button></div></div>`;
  const list = () => { const q = f.q.toLowerCase(); return rows.filter(r => (!f.s || r.on) && (!f.c || r.cls === f.c) && (!q || r.name.toLowerCase().includes(q) || r.adm.toLowerCase().includes(q))); };
  function draw() {
    const l = list(), max = Math.max(0, Math.ceil(l.length / N) - 1); pg = Math.min(pg, max), inp = (k, r, t = 'number', w = 90) => `<input data-k="${k}" data-a="${esc(r.adm)}" type="${t}" value="${esc(r[k])}" style="width:${w}px;padding:4px 6px" aria-label="${k} for ${esc(r.name)}">`;
    $('#tb').innerHTML = l.length ? `<table><thead><tr><th><input type="checkbox" id="all" aria-label="Select all on this page"></th><th>Adm no</th><th>Student</th><th>Class</th><th>Type</th><th class="r">Current fee</th><th>Increment</th><th>New fee</th><th>Annual fund</th><th>Effective</th><th>Saved</th></tr></thead><tbody>${l.slice(pg * N, pg * N + N).map(r => `<tr><td><input type="checkbox" data-s="${esc(r.adm)}" ${sel.has(r.adm) ? 'checked' : ''} aria-label="Select ${esc(r.name)}"></td><td>${esc(r.adm)}</td><td>${esc(r.name)}</td><td>${esc(r.cls)}</td><td>${esc(r.fee_type)}</td><td class="r">${fmt(r.old_fee)}</td>
      <td>${inp('fee_increament', r)}</td><td id="nf-${esc(r.adm)}"><b>${r.new_fee === '' ? '—' : fmt(r.new_fee)}</b></td><td>${inp('annual_fund', r)}</td><td>${inp('effective_period', r, 'text', 110)}</td><td><span class="tag ${r.dirty ? 'pt' : r.ex ? '' : 'x'}">${r.dirty ? 'changed' : r.ex ? 'saved' : 'not set'}</span></td></tr>`).join('')}</tbody></table>` : '<div class="msg">No students match.</div>';
    $('#in').textContent = l.length ? `${pg * N + 1}-${Math.min(l.length, pg * N + N)} of ${l.length} · ${rows.filter(r => r.dirty).length} unsaved` : '0 students'; $('#pv').disabled = pg === 0; $('#nx').disabled = pg >= max;
  }
  $('#tb').oninput = e => { const t = e.target, a = t.dataset.a; if (!a) return; const r = S.get(a); r[t.dataset.k] = t.type === 'number' ? t.value : t.value.trim(); r.dirty = true;
    if (t.dataset.k === 'fee_increament') { r.new_fee = t.value === '' ? '' : r.old_fee + num(t.value); const c = document.getElementById('nf-' + a); if (c) c.innerHTML = `<b>${r.new_fee === '' ? '—' : fmt(r.new_fee)}</b>`; } $('#in').textContent = `${rows.filter(x => x.dirty).length} unsaved`; };
  $('#tb').onchange = e => { const t = e.target; if (t.id === 'all') list().slice(pg * N, pg * N + N).forEach(r => t.checked ? sel.add(r.adm) : sel.delete(r.adm)); else if (t.dataset.s) t.checked ? sel.add(t.dataset.s) : sel.delete(t.dataset.s); if (t.id === 'all') draw(); };
  $('#ap').onclick = () => { const v = num($('#bv').value), type = $('#bt').value, pr = $('#bp').value.trim(); if (!sel.size) return $('#ms').textContent = 'Tick at least one student first.';
    sel.forEach(a => { const r = S.get(a); if (!r) return; r.fee_type = type; r.effective_period = pr || r.effective_period; r.dirty = true; if (v > 0) { const inc = $('#bk').value === 'percentage' ? Math.round((type === 'annual fund' ? num(r.annual_fund) : r.old_fee) * v / 100) : v;
      if (type === 'tution fee') { r.fee_increament = inc; r.new_fee = r.old_fee + inc; } else r.annual_fund = inc; } });
    $('#ms').textContent = `Applied to ${sel.size} student(s). Press Save changes to store them.`; draw(); };
  if ($('#sv')) $('#sv').onclick = async () => {
    const ch = rows.filter(r => r.dirty); if (!ch.length) return $('#ms').textContent = 'No changes to save.'; $('#sv').disabled = true; let ok = 0; const bad = [];
    const body = r => ({ admis_no: r.adm, student_name: r.name, fee_type: r.fee_type, new_fee: num(r.new_fee), effective_period: r.effective_period, old_fee: r.old_fee, fee_increament: num(r.fee_increament), annual_fund: num(r.annual_fund), remarks: r.remarks });
    for (let i = 0; i < ch.length; i += 8) await Promise.all(ch.slice(i, i + 8).map(async r => { try {
      const q = r.ex ? (r.ex.id != null ? `increments?id=eq.${encodeURIComponent(r.ex.id)}` : `increments?admis_no=eq.${encodeURIComponent(r.ex.admis_no)}`) : 'increments';
      const rep = r.ex ? await api(q, { method: 'PATCH', body: body(r), prefer: 'return=representation' }) : await api(q, { method: 'POST', body: body(r), prefer: 'return=representation' });
      if (r.ex && Array.isArray(rep.rows) && !rep.rows.length) await api('increments', { method: 'POST', body: body(r) }); r.dirty = false; r.ex = r.ex || { admis_no: r.adm }; ok++; } catch (x) { bad.push(`${r.adm}: ${x.message}`); } }));
    bust(); $('#sv').disabled = false; $('#ms').innerHTML = `<b>${ok}</b> saved.` + (bad.length ? ` <span class="err">${bad.length} failed. ${esc(bad.slice(0, 3).join(' | '))}${/column/i.test(bad[0] || '') ? ' (A column may be missing in the increments table: see Admin → Setup SQL.)' : ''}</span>` : ''); draw();
  };
  let tm; $('#q').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { f.q = e.target.value; pg = 0; draw(); }, 250); }; $('#c').onchange = e => { f.c = e.target.value; pg = 0; draw(); }; $('#s').onchange = e => { f.s = e.target.value; pg = 0; draw(); };
  $('#pv').onclick = () => { pg--; draw(); }; $('#nx').onclick = () => { pg++; draw(); }; draw();
}
