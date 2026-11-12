export const iso = d => d.toLocaleDateString('en-CA');
export function span(k) {   // period presets -> [from, to] as YYYY-MM-DD
  const d = new Date(), y = d.getFullYear(), m = d.getMonth(), ago = n => { const x = new Date(d); x.setDate(d.getDate() - n); return iso(x); };
  return { today: [iso(d), iso(d)], yest: [ago(1), ago(1)], w: [ago(6), iso(d)], month: [iso(new Date(y, m, 1)), iso(d)], last: [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))], year: [y + '-01-01', iso(d)], all: ['0000-01-01', '9999-12-31'] }[k];
}
export const PERIODS = '<option value="today">Today<option value="yest">Yesterday<option value="w">Last 7 days<option value="month" selected>This month<option value="last">Last month<option value="year">This year<option value="all">All time<option value="custom">Custom';
export const fmt = n => (Math.round((+n || 0) * 100) / 100).toLocaleString('en-US');
export function csv(name, head, rows) {   // CSV download; guards against spreadsheet formula injection
  const q = v => { let t = String(v == null ? '' : v); if (/^\s*[=+\-@]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([[head, ...rows].map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = name + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
