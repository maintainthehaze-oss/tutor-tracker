/* ============================================================
   Tutoring Tracker Pro — Expenses
   Expense CRUD and rendering
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const escapeHtml = App.escapeHtml;
  const generateId = App.generateId;
  const formatCurrency = App.formatCurrency;
  const formatDate = App.formatDate;
  const todayISO = App.todayISO;
  const num = App.num;
  const EXPENSE_CATEGORIES = App.EXPENSE_CATEGORIES;

  function renderExpenses() {
    const expenses = App.state.expenses;
    const receipts = App.state.receipts;

    const countEl = $('expense-count');
    if (countEl) countEl.textContent = expenses.length;

    const tbody = $('expenses-tbody');
    if (!tbody) return;

    const sorted = [...expenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (sorted.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No expenses recorded yet</td></tr>';
      updateExpenseTotals();
      return;
    }

    tbody.innerHTML = sorted.map((e) => {
      const catLabel = EXPENSE_CATEGORIES.find((c) => c.value === e.category);
      const hasReceipt = e.receiptData || receipts[e.id];
      const receiptData = e.receiptData || receipts[e.id] || '';

      return '<tr>' +
        '<td>' + escapeHtml(formatDate(e.date)) + '</td>' +
        '<td>' + escapeHtml(catLabel ? catLabel.label : e.category || '') + '</td>' +
        '<td>' + escapeHtml(e.description || '') + '</td>' +
        '<td>' + formatCurrency(e.amount) + '</td>' +
        '<td>' + (hasReceipt
          ? '<button class="receipt-thumb-btn" data-action="view-receipt" data-id="' + escapeHtml(e.id) + '" title="View receipt">' +
            '<img src="' + escapeHtml(receiptData) + '" alt="Receipt" class="receipt-thumb-img">' +
          '</button>'
          : '-') +
        '</td>' +
        '<td class="col-actions">' +
          '<button class="btn btn-sm btn-icon" data-action="edit-expense" data-id="' + escapeHtml(e.id) + '" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>' +
          '<button class="btn btn-sm btn-icon btn-danger" data-action="delete-expense" data-id="' + escapeHtml(e.id) + '" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>' +
        '</td>' +
      '</tr>';
    }).join('');

    updateExpenseTotals();
  }

  function updateExpenseTotals() {
    const expenses = App.state.expenses;
    const total = expenses.reduce((sum, e) => sum + num(e.amount), 0);
    const el = $('total-expenses');
    if (el) el.innerHTML = '<strong>' + formatCurrency(total) + '</strong>';
  }

  function openExpenseForm(id) {
    const expenses = App.state.expenses;
    const receipts = App.state.receipts;

    const modal = $('modal-expense');
    const title = $('modal-expense-title');
    const form = $('expense-form');
    if (!modal || !form) return;

    form.reset();
    $('expense-id').value = '';
    $('expense-receipt-data').value = '';
    const preview = $('expense-receipt-preview');
    if (preview) preview.hidden = true;

    if (id) {
      const e = expenses.find((ex) => String(ex.id) === String(id));
      if (!e) return;
      if (title) title.textContent = 'Edit Expense';
      $('expense-id').value = e.id;
      $('expense-date').value = e.date || '';
      $('expense-category').value = e.category || '';
      $('expense-description').value = e.description || '';
      $('expense-amount').value = e.amount || '';

      // Show receipt if exists
      const receiptData = e.receiptData || receipts[e.id] || '';
      if (receiptData) {
        $('expense-receipt-data').value = receiptData;
        const thumb = $('expense-receipt-thumb');
        if (thumb) thumb.src = receiptData;
        if (preview) preview.hidden = false;
      }
    } else {
      if (title) title.textContent = 'Add Expense';
      $('expense-date').value = todayISO();
    }

    App.openModal('modal-expense');
  }

  function saveExpense() {
    const expenses = App.state.expenses;
    const receipts = App.state.receipts;

    const date = $('expense-date').value;
    const category = $('expense-category').value;
    const description = ($('expense-description').value || '').trim();
    const amount = num($('expense-amount').value);

    if (!date) { App.showToast('Date is required', 'error'); return; }
    if (!category) { App.showToast('Category is required', 'error'); return; }
    if (!description) { App.showToast('Description is required', 'error'); return; }
    if (amount <= 0) { App.showToast('Amount must be greater than 0', 'error'); return; }

    const id = $('expense-id').value;
    const isNew = !id;
    const receiptData = $('expense-receipt-data').value || '';

    const expenseData = {
      id: id || generateId(),
      date,
      category,
      description,
      amount,
      receiptData: null, // Store separately for large data
      receiptName: null,
      createdAt: isNew ? new Date().toISOString() : undefined,
    };

    if (isNew) {
      expenses.push(expenseData);
    } else {
      const idx = expenses.findIndex((e) => String(e.id) === String(id));
      if (idx === -1) return;
      expenseData.createdAt = expenses[idx].createdAt;
      expenses[idx] = expenseData;
    }

    // Store receipt in separate storage
    if (receiptData) {
      receipts[expenseData.id] = receiptData;
    } else {
      delete receipts[expenseData.id];
    }
    App.markReceiptsDirty();

    App.closeModal('modal-expense');
    if (App.saveAndRender()) App.showToast(isNew ? 'Expense added' : 'Expense updated', 'success');
  }

  function deleteExpense(id) {
    const expenses = App.state.expenses;
    const receipts = App.state.receipts;

    const e = expenses.find((ex) => String(ex.id) === String(id));
    if (!e) return;

    App.showConfirm('Delete Expense', 'Delete this expense from ' + formatDate(e.date) + '?', () => {
      App.state.expenses = expenses.filter((ex) => String(ex.id) !== String(id));
      delete receipts[id];
      App.markReceiptsDirty();
      if (App.saveAndRender()) App.showToast('Expense deleted', 'success');
    });
  }

  /** Process file for receipt */
  function processReceiptFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      App.showToast('File too large. Maximum 5MB.', 'error');
      return;
    }

    // Capture which expense modal generation this file belongs to so async
    // results (PDF render, OCR) landing after the modal was closed/reopened
    // for a different expense can be discarded instead of overwriting the
    // wrong form.
    const gen = App.getModalGeneration ? App.getModalGeneration() : null;
    const stale = () => gen != null && App.getModalGeneration && App.getModalGeneration() !== gen;

    const reader = new FileReader();
    reader.onload = function (e) {
      let dataUrl = e.target.result;
      if (stale()) return;

      // PDFs: render page 1 to an image on-device (pdf.js), then continue
      // down the normal image path (compress + OCR + preview thumbnail).
      if (file.type === 'application/pdf' && typeof App.pdfToImage === 'function') {
        App.showToast('Converting PDF on this device…', 'info');
        App.pdfToImage(dataUrl).then((img) => {
          if (stale()) return;
          if (!img) {
            App.showToast('Could not read this PDF — enter details manually', 'warning');
            setReceiptPreview(dataUrl);
            return;
          }
          compressImage(img, (compressed) => {
            if (stale()) return;
            setReceiptPreview(compressed);
            runOcrPrefill(compressed, gen);
          });
        });
        return;
      }

      // Images: always compress on intake (storage + faster OCR), then
      // run on-device OCR to prefill empty fields. Other files: as-is.
      if (file.type.startsWith('image/')) {
        compressImage(dataUrl, (compressed) => {
          if (stale()) return;
          setReceiptPreview(compressed);
          runOcrPrefill(compressed, gen);
        });
      } else {
        setReceiptPreview(dataUrl);
      }
    };
    reader.readAsDataURL(file);
  }

  function compressImage(dataUrl, callback) {
    const img = new Image();
    img.onload = function () {
      const maxDim = 1200;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = dataUrl;
  }

  /** On-device OCR (js/ocr.js): prefill EMPTY expense fields from the
   *  attached receipt. Never overwrites anything the user typed; the user
   *  always reviews and saves manually. The image never leaves the device. */
  function runOcrPrefill(dataUrl, gen) {
    if (typeof App.extractReceiptFields !== 'function') return;
    App.showToast('Reading receipt on this device…', 'info');
    App.extractReceiptFields(dataUrl).then((fields) => {
      if (gen != null && App.getModalGeneration && App.getModalGeneration() !== gen) return; // expense modal closed/reopened since request started
      if (!fields || (!fields.vendor && !fields.date && fields.total == null)) {
        App.showToast('Could not read receipt — please enter details manually', 'warning');
        return;
      }
      const dateEl = $('expense-date');
      const descEl = $('expense-description');
      const amtEl = $('expense-amount');
      const filled = [];
      // Date: the form defaults to today for new expenses; a receipt date
      // is more accurate, so it may replace that untouched default.
      if (fields.date && dateEl && (!dateEl.value || dateEl.value === todayISO())) {
        dateEl.value = fields.date;
        filled.push('date');
      }
      if (fields.vendor && descEl && !descEl.value.trim()) {
        descEl.value = fields.vendor;
        filled.push('vendor');
      }
      if (fields.total != null && amtEl && !amtEl.value) {
        amtEl.value = fields.total.toFixed(2);
        filled.push('total');
      }
      App.showToast(filled.length
        ? 'Extracted ' + filled.join(', ') + ' — please check before saving'
        : 'Receipt read — fields already filled, nothing changed', 'success');
    });
  }

  function setReceiptPreview(dataUrl) {
    $('expense-receipt-data').value = dataUrl;
    const thumb = $('expense-receipt-thumb');
    if (thumb) thumb.src = dataUrl;
    const preview = $('expense-receipt-preview');
    if (preview) preview.hidden = false;
  }

  // Expose to App namespace
  App.renderExpenses = renderExpenses;
  App.openExpenseForm = openExpenseForm;
  App.saveExpense = saveExpense;
  App.deleteExpense = deleteExpense;
  App.processReceiptFile = processReceiptFile;

})();
