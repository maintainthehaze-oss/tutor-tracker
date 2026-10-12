'use strict';
// Slice D (2026-10-11): family payment intake + monthly statement.
// Pure allocation and statement model in protected/js/payments.js, the optional payment method on the
// session.payment event (repository.js + record-policy.js overlay), the client's defaultPaymentMethod,
// and the Owed panel -> Record payment -> Save flow driven through the real ui.js delegation with a fake
// DOM and a fake clock. Fabricated data only; this repo is public. Unit-level evidence, not what a person
// sees on screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { activate, command, loadApp, readSource } = require('./helpers/harness.cjs');
const { bootUi } = require('./helpers/ui-app.cjs');
const { MODULES, rawFixture } = require('./helpers/money-fixture.cjs');

const copy = x => JSON.parse(JSON.stringify(x));
const FAMILY = 'family:Family Test-1';
const MODEL = [...MODULES, 'payments'];

/** The fabricated fixture plus three more pre-activation (locked) rows so Family Test-1 has several own
 *  unpaid sessions out of date order, and one session shared with Family Test-2. */
function familyFixture() {
  const data = rawFixture();
  data.clients[0].defaultPaymentMethod = 'Venmo';                                  // c1 (Family Test-1) usually pays by Venmo
  const base = { companyAmount: 0, companySplit: 0, status: 'completed', paid: false, payment: 'unpaid', mileage: 0 };
  data.sessions.push(
    { id: 'x1', clientIds: ['c1'], date: '2026-01-10', duration: 1, amount: 100, ...base },
    { id: 'x2', clientIds: ['c2'], date: '2026-02-20', duration: 1, amount: 60, ...base },
    { id: 'x3', clientIds: ['c1', 'c3'], date: '2026-02-25', duration: 2, amount: 200, ...base },   // shared with Family Test-2
  );
  return data;
}
// Family Test-1 own unpaid, oldest first: x1 100 (Jan 10), a2 150 (Feb 5), x2 60 (Feb 20) = 310. Shared: x3 (half = 100).
// Owed panel for the family = 310 + 100 = 410.

const row = (App, id) => App.state.sessions.find(s => String(s.id) === id);
const events = App => copy(App.repository.snapshot().events).filter(e => e.type === 'payment');

test('allocatePayment (pure): oldest first, whole sessions only, partial and over-payment refused', () => {
  const App = loadApp(['app-core', 'sessions', 'session-table', 'session-form', 'mileage', 'payments']);
  const s = (id, date, amount) => ({ id, date, amount });
  const rows = [s('b', '2026-02-05', 150), s('a', '2026-01-10', 100), s('c', '2026-02-20', 60)];
  const ids = a => copy(a.covered.map(x => x.id));   // copy(): vm-realm arrays are not deepEqual to ours
  let a = App.allocatePayment(rows, 250);
  assert.deepEqual(ids(a), ['a', 'b']); assert.equal(a.exact, true); assert.equal(a.total, 250); assert.equal(a.owed, 310); assert.equal(a.next.id, 'c');
  a = App.allocatePayment(rows, 200);
  assert.deepEqual(ids(a), ['a']); assert.equal(a.exact, false); assert.equal(a.remainder, 100); assert.equal(a.over, false);
  a = App.allocatePayment(rows, 310);
  assert.deepEqual(ids(a), ['a', 'b', 'c']); assert.equal(a.exact, true); assert.equal(a.next, null);
  a = App.allocatePayment(rows, 310.01);
  assert.equal(a.over, true); assert.equal(a.exact, false);
  a = App.allocatePayment(rows, 0);
  assert.deepEqual(ids(a), []); assert.equal(a.exact, false);
  a = App.allocatePayment(rows, '100');
  assert.deepEqual(ids(a), ['a']); assert.equal(a.exact, true);
  // Cents: a stored sub-cent amount (51.875) is paid by the cents the owner sees (51.88); float noise never refuses.
  a = App.allocatePayment([s('p', '2026-02-11', 51.875), s('q', '2026-02-12', 0.1), s('r', '2026-02-13', 0.2)], 52.18);
  assert.deepEqual(ids(a), ['p', 'q', 'r']); assert.equal(a.exact, true);
  // Same date: time, then id, keeps the order stable.
  a = App.allocatePayment([{ id: 'z', date: '2026-03-01', time: '16:00', amount: 10 }, { id: 'y', date: '2026-03-01', time: '09:00', amount: 10 }], 10);
  assert.deepEqual(ids(a), ['y']);
  assert.equal(App.allocatePayment(rows, 250).ordered.map(x => x.id).join(), 'a,b,c', 'input order must not matter');
});

test('session.payment: optional method rides on the event and the read view; invalid method refused unchanged', async () => {
  const { App } = await activate(MODEL, familyFixture());
  const repo = App.repository;
  await command(repo, 'session.payment', { ids: ['x1'], date: '2027-01-05', method: ' Zelle ' });
  const ev = events(App);
  assert.equal(ev.length, 1); assert.equal(ev[0].method, 'Zelle'); assert.equal(ev[0].date, '2027-01-05'); assert.equal(ev[0].sessionId, 'x1');
  App.refreshReadViews();
  assert.equal(row(App, 'x1').paid, true); assert.equal(row(App, 'x1').paymentDate, '2027-01-05'); assert.equal(row(App, 'x1').paymentMethod, 'Zelle');
  assert.equal(Object.hasOwn(repo.snapshot().working.sessions.find(s => s.id === 'x1'), 'paymentMethod'), false, 'stored row must not change');
  // No method: the event is byte-compatible with every event written before Slice D (no `method` key at all).
  await command(repo, 'session.payment', { ids: ['x2'], date: '2026-03-01' });
  assert.equal(Object.hasOwn(events(App)[1], 'method'), false);
  await command(repo, 'session.payment', { ids: ['a2'], date: '2026-03-01', method: '' });
  assert.equal(Object.hasOwn(events(App)[2], 'method'), false);
  App.refreshReadViews();
  assert.equal(Object.hasOwn(row(App, 'x2'), 'paymentMethod'), false);
  for (const method of [42, '   ', 'x'.repeat(41), {}]) {
    const before = JSON.stringify(repo.snapshot());
    await assert.rejects(command(repo, 'session.payment', { ids: ['x3'], date: '2026-03-01', method }), /Invalid payment method/);
    assert.equal(JSON.stringify(repo.snapshot()), before, 'refusal changed the store');
  }
});

test('statementModel: balance equals the Owed panel for every group; month rows add up to the month rollup', async () => {
  const ctx = await activate(MODEL, familyFixture());
  const P = ctx.App;
  await command(P.repository, 'session.payment', { ids: ['x1'], date: '2026-03-02', method: 'Venmo' });
  P.refreshReadViews();
  const owed = P.computeOwedByFamily();
  assert.ok(owed.groups.length >= 3);
  for (const g of owed.groups) {
    for (const month of ['2026-01', '2026-02', '2026-03', '2026-12']) {
      const st = P.statementModel(g.key, month);
      assert.equal(st.balance, g.amount, g.key + ' ' + month + ': statement balance != Owed panel');
      assert.equal(st.balanceCount, g.count);
      const m = P.computeMetrics({ month }).groups.find(x => x.key === g.key);
      const shares = st.rows.reduce((sum, r) => sum + r.share, 0);
      assert.equal(Math.round(shares * 1000) / 1000, Math.round((m ? m.gross : 0) * 1000) / 1000, g.key + ' ' + month + ': row shares != month gross');
      assert.equal(st.charged, m ? m.gross : 0); assert.equal(st.unpaid, m ? m.outstanding : 0);
      assert.equal(Math.round((st.charged - st.paid - st.unpaid) * 1000) / 1000, 0);
    }
  }
  const feb = P.statementModel(FAMILY, '2026-02');
  assert.deepEqual(copy(feb.rows).map(r => [r.id, r.shared, r.share, r.paid]), [['a1', false, 100, true], ['a2', false, 150, false], ['x2', false, 60, false], ['x3', true, 100, false]]);
  assert.equal(feb.label, 'Family Test-1'); assert.equal(feb.charged, 410); assert.equal(feb.unpaid, 310); assert.equal(feb.paid, 100);
  assert.equal(feb.balance, 310, 'x1 (Jan) paid, so Feb 150+60 own + 100 share of x3');
  const jan = P.statementModel(FAMILY, '2026-01');
  assert.deepEqual(copy(jan.rows).map(r => [r.id, r.paid, r.paymentDate, r.paymentMethod]), [['x1', true, '2026-03-02', 'Venmo']]);
  assert.equal(jan.unpaid, 0); assert.equal(jan.balance, 310, 'balance is ALL TIME, not the month');
  const waived = P.statementModel('family:Family Test-2', '2026-02');
  assert.deepEqual(copy(waived.rows).map(r => [r.id, r.waived, r.amount, r.shared]), [['a3', true, 0, false], ['x3', false, 200, true]]);
  assert.equal(waived.charged, 100); assert.equal(waived.balance, 100);
  // A group with no sessions that month still gets its label and its all-time balance.
  const empty = P.statementModel('client:c4', '2026-12');
  assert.deepEqual(copy(empty.rows), []); assert.equal(empty.label, 'Client Delta'); assert.equal(empty.charged, 0); assert.equal(empty.balance, 51.875);
});

test('statement PDF: rows, "This family" share column only when shared, and the balance line equals the Owed panel', async () => {
  const { App, context } = await activate(MODEL, familyFixture());
  const calls = [];
  class FakePDF {
    constructor() { this.lastAutoTable = { finalY: 40 }; }
    setFontSize() {} text(t) { calls.push(['text', t]); }
    autoTable(o) { calls.push(['table', o]); this.lastAutoTable = { finalY: 100 }; }
    save(name) { calls.push(['save', name]); }
  }
  FakePDF.API = { autoTable() {} };
  context.window.jspdf = { jsPDF: FakePDF };
  const toasts = []; App.showToast = (m, k) => toasts.push([k, m]);
  const doc = context.document;
  const statementFamily = { value: FAMILY }, statementMonth = { value: '2026-02' };
  doc.getElementById = id => ({ 'statement-family': statementFamily, 'statement-month': statementMonth }[id] || null);
  assert.equal(App.exportStatementPDF(), true, JSON.stringify(toasts));
  const tables = calls.filter(c => c[0] === 'table').map(c => copy(c[1]));
  assert.equal(tables.length, 2);
  assert.deepEqual(tables[0].head[0], ['Date', 'Client(s)', 'Hours', 'Amount', 'This family', 'Status']);
  assert.deepEqual(tables[0].body.map(r => [r[1], r[3], r[4], r[5]]), [
    ['Client Alpha', '$100.00', '', 'Paid Feb 10, 2026'], ['Client Alpha + Client Beta', '$150.00', '', 'Unpaid'],
    ['Client Beta', '$60.00', '', 'Unpaid'], ['Client Alpha + Client Gamma', '$200.00', '$100.00', 'Unpaid']]);
  const owed = App.computeOwedByFamily().groups.find(g => g.key === FAMILY).amount;
  assert.deepEqual(tables[1].body.at(-1), ['Balance due, all time (4 sessions)', App.formatCurrency(owed)]);
  assert.deepEqual(tables[1].body.slice(0, 3), [['Charged this month', '$410.00'], ['Paid (of this month)', '$100.00'], ['Still unpaid (this month)', '$310.00']]);
  assert.deepEqual(copy(calls.at(-1)), ['save', 'statement-family-test-1-2026-02.pdf']);
  assert.match(calls.find(c => c[0] === 'text')[1], /^Statement — Family Test-1$/);
  // Solo client, no shared rows: no share column; waived shows as Waived.
  calls.length = 0; statementFamily.value = 'client:c4'; statementMonth.value = '2026-02';
  App.exportStatementPDF();
  const t2 = calls.filter(c => c[0] === 'table').map(c => copy(c[1]));
  assert.deepEqual(t2[0].head[0], ['Date', 'Client(s)', 'Hours', 'Amount', 'Status']);
  assert.deepEqual(t2[0].body, [['Feb 11, 2026', 'Client Delta', '50m', '$51.88', 'Unpaid']]);
  // No jsPDF (the preview without vendor files): a toast, no throw, nothing saved.
  calls.length = 0; context.window.jspdf = undefined;
  assert.equal(App.exportStatementPDF(), false); assert.equal(calls.length, 0); assert.equal(toasts.at(-1)[0], 'error');
});

test('Owed panel -> Record payment -> Save: pre-filled, partial refused, exact amount writes dated events with the method', async () => {
  const ui = await bootUi({ data: familyFixture() });
  const { App, field, click } = ui;
  const revision0 = App.repository.revision;
  await click('record-payment', { 'data-key': FAMILY, 'data-label': 'Family Test-1' });
  assert.equal(field('modal-record-payment').hidden, false, 'modal must open');
  assert.equal(field('record-payment-amount').value, '370.00', 'own-sessions total incl. a6 auto-completed on load; not the panel total (470 incl. the shared half)');
  assert.equal(field('record-payment-date').value, '2026-03-10', 'today from the fake clock');
  assert.equal(field('record-payment-method').value, 'Venmo', 'defaulted from the family member');
  assert.match(field('record-payment-owed').textContent, /4 unpaid sessions · \$370\.00 owed\. 1 session shared with another family stay unpaid here; mark those from the table\./);
  assert.match(field('record-payment-preview').innerHTML, /Pays 4 sessions, oldest first: Jan 10, 2026 \$100\.00 · Feb 5, 2026 \$150\.00 · Feb 9, 2026 \$60\.00 · Feb 20, 2026 \$60\.00\. Nothing left owed\./);
  assert.equal(field('record-payment-save').disabled, false);

  // Partial: the live preview (body 'input' delegation) refuses and Save does nothing.
  field('record-payment-amount').value = '200';
  for (const listener of ui.document.body.listeners.input || []) listener({ target: { id: 'record-payment-amount', getAttribute: () => null } });
  assert.match(field('record-payment-preview').innerHTML, /\$200\.00 does not cover whole sessions\.<\/strong> \$100\.00 pays 1 session; \$250\.00 pays 2 sessions\./);
  assert.equal(field('record-payment-save').disabled, true);
  await click('save-record-payment');
  assert.equal(App.repository.revision, revision0, 'partial payment must not write');
  assert.equal(events(App).length, 0);
  // Over: refused too.
  field('record-payment-amount').value = '370.01'; App.previewRecordPayment();
  assert.match(field('record-payment-preview').innerHTML, /\$370\.01 is more than the \$370\.00 owed/);
  await click('save-record-payment');
  assert.equal(App.repository.revision, revision0);

  // Exact for the two oldest, received in the NEXT tax year, by Zelle.
  field('record-payment-amount').value = '250'; App.previewRecordPayment();
  assert.match(field('record-payment-preview').innerHTML, /Pays 2 sessions, oldest first: Jan 10, 2026 \$100\.00 · Feb 5, 2026 \$150\.00\. 2 sessions \(\$120\.00\) stay unpaid\./);
  field('record-payment-date').value = '2027-01-05';
  field('record-payment-method').value = 'Zelle';
  await click('save-record-payment');
  // ui.js does not await saveRecordPayment and hashing is truly async: wait for the write, not a fixed tick count.
  await ui.waitFor(() => App.repository.revision !== revision0, 'payment save');
  assert.equal(App.repository.revision, revision0 + 1, 'one revision for both events');
  assert.deepEqual(events(App).map(e => [e.sessionId, e.date, e.method]), [['x1', '2027-01-05', 'Zelle'], ['a2', '2027-01-05', 'Zelle']]);
  assert.equal(field('modal-record-payment').classList.contains('modal-active'), false, 'modal closed');
  assert.equal(row(App, 'x1').paid, true); assert.equal(row(App, 'a2').paymentDate, '2027-01-05'); assert.equal(row(App, 'x2').paid, false);
  assert.equal(row(App, 'x3').paid, false, 'the shared session is never touched from the panel');
  // Cash basis (audit 6e): the money lands in 2027, not in the sessions' 2026.
  assert.equal(App.getTaxData(2027).grossIncome, 250); assert.equal(App.getTaxData(2026).grossIncome, 100);
  // The Owed panel drops by exactly what was recorded, and the statement agrees.
  const owed = App.computeOwedByFamily().groups.find(g => g.key === FAMILY);
  assert.equal(owed.amount, 220); assert.equal(App.statementModel(FAMILY, '2026-02').balance, 220);
  // Stored originals untouched (events only).
  const stored = App.repository.snapshot().working.sessions;
  assert.equal(stored.find(s => s.id === 'x1').paid, false); assert.equal(stored.find(s => s.id === 'a2').paid, false);

  // Stale modal: a save after another write is refused by the revision check, no second payment.
  await click('record-payment', { 'data-key': FAMILY, 'data-label': 'Family Test-1' });
  assert.equal(field('record-payment-amount').value, '120.00');
  await ui.save();
  const staleToasts = [], showToast = App.showToast; App.showToast = (m, k) => staleToasts.push([k, m]);
  await click('save-record-payment');
  await ui.waitFor(() => staleToasts.length > 0, 'stale save refusal');
  App.showToast = showToast;
  assert.match(staleToasts[0][1], /Stale action/);
  assert.equal(events(App).length, 2, 'stale save must not write');

  // Nothing own left but a shared session: the button explains instead of opening.
  await App.runCommand('session.payment', { ids: ['x2', 'a6'], date: '2026-03-10' }, App.repository.revision);
  field('modal-record-payment').hidden = true;
  const toasts = []; App.showToast = (m, k) => toasts.push([k, m]);
  await click('record-payment', { 'data-key': FAMILY, 'data-label': 'Family Test-1' });
  assert.equal(field('modal-record-payment').hidden, true, 'modal must not open');
  assert.deepEqual(toasts, [['error', '1 session for Family Test-1 also bill another family. Mark those paid from the table.']]);
});

test('client form: "Usually pays by" round-trips through client.save and pre-fills the modal; blank means not set', async () => {
  const ui = await bootUi();
  const { App, field, click } = ui;
  App.openClientForm('c3');                                               // Client Gamma, Family Test-2, no method yet
  assert.equal(field('client-default-payment-method').value, '');
  field('client-default-payment-method').value = 'Check';
  const r0 = App.repository.revision;
  await click('save-client');
  await ui.waitFor(() => App.repository.revision === r0 + 1, 'client save');
  const saved = ui.disk().working.clients.find(c => c.id === 'c3');
  assert.equal(saved.defaultPaymentMethod, 'Check'); assert.equal(saved.familyGroup, 'Family Test-2'); assert.equal(saved.rate, 80);
  assert.equal(App.familyDefaultMethod('family:Family Test-2'), 'Check');
  assert.equal(App.familyDefaultMethod('client:c4'), '');
  App.openClientForm('c3');
  assert.equal(field('client-default-payment-method').value, 'Check');
  field('client-default-payment-method').value = '';
  const r1 = App.repository.revision;
  await click('save-client');
  await ui.waitFor(() => App.repository.revision === r1 + 1, 'client save 2');
  assert.equal(ui.disk().working.clients.find(c => c.id === 'c3').defaultPaymentMethod, '');
  assert.equal(App.familyDefaultMethod('family:Family Test-2'), '');
  // Active members are asked first, then paused ones.
  await App.runCommand('client.save', { record: { id: 'c1', defaultPaymentMethod: 'Cash', status: 'paused' } }, App.repository.revision);
  await App.runCommand('client.save', { record: { id: 'c2', defaultPaymentMethod: 'PayPal' } }, App.repository.revision);
  assert.equal(App.familyDefaultMethod(FAMILY), 'PayPal');
});

test('source guards: markup, script order, Owed panel button, and no stray writes in payments.js', () => {
  const html = readSource('index.html');
  assert.ok(html.includes('id="modal-record-payment"') && html.includes('data-action="save-record-payment"'));
  assert.ok(html.includes('id="client-default-payment-method"'));
  assert.ok(html.includes('id="statement-family"') && html.includes('id="statement-month"') && html.includes('data-action="export-statement-pdf"'));
  assert.ok(html.indexOf('js/reports.js') < html.indexOf('js/payments.js') && html.indexOf('js/payments.js') < html.indexOf('js/ui.js'));
  assert.ok(readSource('js/dashboard.js').includes('data-action="record-payment"'));
  assert.ok(!readSource('js/ui.js').includes('mark-group-paid'), 'the one-tap Mark paid case was replaced');
  const src = readSource('js/payments.js');
  assert.ok(!/localStorage|indexedDB|App\.state\.\w+\s*=[^=]/.test(src), 'payments.js writes only through runCommand');
  assert.equal((src.match(/runCommand\('session\.payment'/g) || []).length, 1);
});

test('client form: Subjects / Learning Goals fold shut under "More" (roadmap 4.6), open only when the client has a value, storage unchanged', async () => {
  const ui = await bootUi();
  const { App, field, click } = ui;
  const html = readSource('index.html');
  const more = html.slice(html.indexOf('<details class="form-group-full form-more" id="client-more">'), html.indexOf('</details>', html.indexOf('id="client-more"')));
  assert.ok(more.includes('id="client-subjects"') && more.includes('id="client-goals"'), 'both fields live inside the fold');
  assert.ok(!more.includes(' open>'), 'the fold is closed in the markup');
  assert.ok(html.indexOf('id="client-more"') > html.indexOf('id="client-default-payment-method"'), 'the fold is the last thing in the form');
  assert.ok(readSource('styles.css').includes('.form-more > summary'));
  App.openClientForm();                              // Add: closed
  assert.equal(field('client-more').open, false);
  App.openClientForm('c3');                          // Edit, nothing in the fields: closed
  assert.equal(field('client-more').open, false);
  field('client-subjects').value = 'Algebra';
  const r0 = App.repository.revision;
  await click('save-client');
  await ui.waitFor(() => App.repository.revision === r0 + 1, 'client save');
  assert.equal(ui.disk().working.clients.find(c => c.id === 'c3').subjects, 'Algebra', 'stored exactly as before');
  App.openClientForm('c3');                          // Edit with a value: open
  assert.equal(field('client-more').open, true);
  assert.equal(field('client-subjects').value, 'Algebra');
  App.openClientForm();                              // Back to Add: closed again
  assert.equal(field('client-more').open, false);
});
