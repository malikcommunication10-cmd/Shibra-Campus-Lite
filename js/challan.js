import { esc } from './core.js';
import { fmt } from './util.js';
import { tc } from './fees-gen.js';
// Prints a two-copy fee challan (school copy + parent copy) through a hidden frame, so no pop-up is needed.
export function printChallan(list, school = 'Concept School') {
  const one = (g, who) => `<div class="c"><h2>${esc(school)}</h2><div class="s">Fee challan · ${who}</div><table class="i"><tr><td>Voucher</td><td><b>${esc(g.id)}</b></td></tr><tr><td>Student</td><td>${esc(g.student)}</td></tr><tr><td>Adm no / class</td><td>${esc(g.adm)} / ${esc(g.cls)}</td></tr><tr><td>Period</td><td>${esc(g.period)}</td></tr></table>
    <table class="t"><tr><th>Item</th><th>Amount</th><th>Discount</th><th>Net</th></tr>${g.items.map(i => `<tr><td>${esc(tc(i.type || 'tuition fee'))}</td><td>${fmt(i.payable)}</td><td>${fmt(i.discount)}</td><td>${fmt(i.payable - i.discount)}</td></tr>`).join('')}
    <tr><td colspan="3">Total payable</td><td><b>${fmt(g.net)}</b></td></tr>${g.paid > 0 ? `<tr><td colspan="3">Already paid</td><td>${fmt(g.paid)}</td></tr>` : ''}<tr class="d"><td colspan="3">Amount due</td><td><b>${fmt(g.due)}</b></td></tr></table><div class="f"><span>Received by / stamp</span><span>Date</span></div></div>`;
  const html = `<!doctype html><meta charset="utf-8"><title>Fee challan</title><style>body{font:12px system-ui,sans-serif;margin:0}.p{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:10px;page-break-after:always;break-inside:avoid}.c{border:1px solid #333;padding:10px}h2{margin:0;font-size:15px}.s{color:#555;margin-bottom:6px}table{width:100%;border-collapse:collapse;margin:6px 0}.t td,.t th{border:1px solid #999;padding:4px;text-align:right}.t td:first-child,.t th:first-child{text-align:left}.i td{padding:2px 0}.d td{background:#eee}.f{display:flex;justify-content:space-between;margin-top:26px;border-top:1px dashed #666;padding-top:4px;color:#555}</style>${list.map(g => `<div class="p">${one(g, 'School copy')}${one(g, 'Parent copy')}</div>`).join('')}`;
  const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;width:0;height:0;border:0'; document.body.appendChild(fr); fr.contentDocument.open(); fr.contentDocument.write(html); fr.contentDocument.close();
  setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 1500); }, 200);
}
