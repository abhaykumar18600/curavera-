(async function () {
  var API_HOST = window.location.hostname || 'localhost';
  var API_PROTOCOL = window.location.protocol === 'https:' ? 'https:' : 'http:';
  var API_URL = 'https://curavera-web-page.onrender.com';
  document.body.style.visibility = 'hidden';

  var authResponse;
  try {
    authResponse = await fetch(API_URL + '/api/auth/me', { credentials: 'include' });
  } catch (error) {
    window.location.replace('login.html');
    return;
  }
  if (!authResponse.ok) {
    window.location.replace('login.html');
    return;
  }
  var authData = await authResponse.json().catch(function () { return {}; });
  if (!authData.success || !authData.data) {
    window.location.replace('login.html');
    return;
  }
  var currentUser = authData.data;
  document.body.style.visibility = 'visible';

  // ====== CONFIG ======
  var ADMIN_URL = API_URL + '/api/admin/appointments';
  var UPLOAD_URL = API_URL + '/api/upload/image';
  var PHOTO_KEY = 'mc_profile_photo_url';
  var MAX_IMAGE_MB = 5;
  var ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

  var root = document.getElementById('mc-app');
  var apptBody = document.getElementById('mc-appt-body');
  var patBody = document.getElementById('mc-pat-body');
  var accountBody = document.getElementById('mc-account-body');
  var all = [];
  var currentFilter = 'all';
  var currentDateFilter = '';
  var showHidden = false;
  var currentPage = 1;
  var appointmentsPerPage = 10;
  var pagination = document.getElementById('mc-appt-pagination');

  // ====== helpers ======
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    var t = document.getElementById('mc-toast');
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.style.display = 'none'; }, 3000);
  }
  async function authApi(path, opts) {
    opts = opts || {};
    var res = await fetch(API_URL + '/api/auth/' + path, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.success) throw new Error(data.message || 'Request failed');
    return data;
  }
  async function api(path, opts) {
    opts = opts || {};
    var isFormData = opts.body && typeof FormData !== 'undefined' && opts.body instanceof FormData;
    var res = await fetch(ADMIN_URL + path, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: opts.body && !isFormData ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? (isFormData ? opts.body : JSON.stringify(opts.body)) : undefined
    });
    if (res.status === 401 || res.status === 403) {
      window.location.replace('login.html');
      throw new Error('Your session is no longer authorized. Please log in again.');
    }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.success) throw new Error(data.message || 'Request failed');
    return data;
  }
  function fmtDate(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m) return esc(ymd);
    var mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m[2] - 1];
    return m[3] + ' ' + mon + ' ' + m[1];
  }
  function initials(n) {
    var p = String(n).trim().split(/\s+/);
    return ((p[0] || '')[0] + ((p.length > 1 ? p[p.length - 1][0] : (p[0] || '')[1]) || '')).toUpperCase();
  }
  var COLORS = ['purple', 'pink', 'blue', 'green', 'orange', 'red'];
  function color(n) {
    var h = 0;
    String(n).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    return COLORS[h % COLORS.length];
  }
  function bucket(s) { return s === 'contacted' ? 'pending' : s; } // dashboard mein 3 tabs hi hain
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  document.getElementById('mc-account-name').textContent = currentUser.name;
  document.getElementById('mc-profile-img').alt = 'Profile photo of ' + currentUser.name;
  document.getElementById('mc-account-role').textContent =
    currentUser.role === 'admin' ? 'Clinic administrator' : 'Doctor';
  document.getElementById('mc-name').value = currentUser.name || '';
  document.getElementById('mc-email').value = currentUser.email || '';
  document.getElementById('mc-phone').value = currentUser.phone || '';
  document.getElementById('mc-spec').value = currentUser.specialization || '';
  if (currentUser.photoUrl) applyPhoto(currentUser.photoUrl);

  var accountReview = document.getElementById('mc-account-review');
  if (currentUser.role === 'admin') {
    accountReview.hidden = false;
    loadPendingAccounts();
  }

  async function loadPendingAccounts() {
    try {
      var result = await authApi('pending-accounts');
      if (!result.data.length) {
        accountBody.innerHTML = '<tr><td class="mc-table__td" colspan="5">No pending signup requests.</td></tr>';
        return;
      }
      accountBody.innerHTML = result.data.map(function (account) {
        return '<tr class="mc-table__row" data-account-id="' + esc(account._id) + '">' +
          '<td class="mc-table__td">' + esc(account.name) + '</td>' +
          '<td class="mc-table__td">' + esc(account.email) + '<span class="mc-cell-sub">' + esc(account.phone) + '</span></td>' +
          '<td class="mc-table__td">' + esc(account.registrationNumber) + '</td>' +
          '<td class="mc-table__td">' + esc(new Date(account.createdAt).toLocaleDateString('en-IN')) + '</td>' +
          '<td class="mc-table__td"><button type="button" class="mc-btn mc-btn--primary mc-approve-account" data-account-approve>Approve</button></td>' +
          '</tr>';
      }).join('');
    } catch (error) {
      accountBody.innerHTML = '<tr><td class="mc-table__td" colspan="5">' + esc(error.message) + '</td></tr>';
    }
  }

  accountBody.addEventListener('click', async function (event) {
    var button = event.target.closest('[data-account-approve]');
    if (!button) return;
    var row = button.closest('[data-account-id]');
    button.disabled = true;
    try {
      await authApi('accounts/' + encodeURIComponent(row.dataset.accountId) + '/approve', { method: 'PATCH' });
      toast('Doctor account approved');
      await loadPendingAccounts();
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
  });

  document.getElementById('mc-logout').addEventListener('click', async function () {
    this.disabled = true;
    try {
      await authApi('logout', { method: 'POST' });
      window.location.replace('login.html');
    } catch (error) {
      this.disabled = false;
      toast(error.message);
    }
  });

  // ====== render appointments ======
  function render() {
    var q = document.getElementById('mc-appt-search').value.trim().toLowerCase();
    var appointmentRecords = all.filter(function (a) {
      return a.recordType !== 'patient' &&
        (showHidden ? Boolean(a.hiddenAt) : !a.hiddenAt) &&
        (!currentDateFilter || a.date === currentDateFilter);
    });

    ['pending', 'confirmed', 'cancelled'].forEach(function (k) {
      document.getElementById('mc-count-' + k).textContent =
        appointmentRecords.filter(function (a) { return bucket(a.status) === k; }).length;
    });
    document.getElementById('mc-count-all').textContent = appointmentRecords.length;

    var list = appointmentRecords.filter(function (a) {
      if (currentFilter !== 'all' && bucket(a.status) !== currentFilter) return false;
      if (!q) return true;
      return (a.name + ' ' + a.phone + ' ' + (a.email || '')).toLowerCase().indexOf(q) !== -1;
    });

    var pageCount = Math.max(1, Math.ceil(list.length / appointmentsPerPage));
    currentPage = Math.min(currentPage, pageCount);
    var startIndex = (currentPage - 1) * appointmentsPerPage;
    var pageList = list.slice(startIndex, startIndex + appointmentsPerPage);

    pagination.innerHTML =
      '<span class="mc-pagination__summary">Showing ' +
      (list.length ? (startIndex + 1) + '–' + Math.min(startIndex + appointmentsPerPage, list.length) : '0') +
      ' of ' + list.length + ' requests</span>' +
      '<div class="mc-pagination__controls">' +
        '<button type="button" class="mc-pagination__button" data-page-action="previous"' +
          (currentPage === 1 ? ' disabled' : '') + '>Previous</button>' +
        '<span class="mc-pagination__page">Page ' + currentPage + ' of ' + pageCount + '</span>' +
        '<button type="button" class="mc-pagination__button" data-page-action="next"' +
          (currentPage === pageCount ? ' disabled' : '') + '>Next</button>' +
      '</div>';

    if (!list.length) {
      apptBody.innerHTML = '<tr><td class="mc-table__td" colspan="11">No appointment requests found.</td></tr>';
      return;
    }

    apptBody.innerHTML = pageList.map(function (a, i) {
      return '<tr class="mc-table__row" data-id="' + esc(a._id) + '">' +
        '<td class="mc-table__td">' + (startIndex + i + 1) + '</td>' +
        '<td class="mc-table__td" colspan="2"><div class="mc-cell-user"><span class="mc-avatar mc-avatar--' + color(a.name) + '">' + esc(initials(a.name)) + '</span>' + esc(a.name) + '</div></td>' +
        '<td class="mc-table__td">' + esc(a.phone) + (a.email ? '<span class="mc-cell-sub">' + esc(a.email) + '</span>' : '') + '</td>' +
        '<td class="mc-table__td">' + esc(a.mode) + '</td>' +
        '<td class="mc-table__td">' + fmtDate(a.date) + '<span class="mc-cell-sub">' + esc(a.time) + '</span></td>' +
        '<td class="mc-table__td">' + esc(a.consultType) + '</td>' +
        '<td class="mc-table__td">' + (a.status === 'confirmed' && a.age != null ? esc(a.age) : '—') + '</td>' +
        '<td class="mc-table__td">' + (a.status === 'confirmed' && a.gender ? esc(a.gender) : '—') + '</td>' +
        '<td class="mc-table__td"><span class="mc-status mc-status--' + esc(bucket(a.status)) + '">' + esc(cap(a.status)) + '</span></td>' +
        '<td class="mc-table__td"><div class="mc-actions">' +
          '<button type="button" class="mc-iconbtn mc-iconbtn--view" data-act="view" aria-label="View"><svg class="mc-iconbtn__icon"><use href="#mc-i-eye"/></svg></button>' +
          '<button type="button" class="mc-iconbtn mc-iconbtn--accept" data-act="confirmed" aria-label="Confirm"><svg class="mc-iconbtn__icon"><use href="#mc-i-check"/></svg></button>' +
          '<button type="button" class="mc-iconbtn mc-iconbtn--reject" data-act="cancelled" aria-label="Cancel"><svg class="mc-iconbtn__icon"><use href="#mc-i-x"/></svg></button>' +
          '<button type="button" class="mc-iconbtn mc-iconbtn--hide" data-act="hidden" aria-label="' + (a.hiddenAt ? 'Restore' : 'Hide') + '">' + (a.hiddenAt ? 'Restore' : 'Hide') + '</button>' +
        '</div></td></tr>';
    }).join('');
  }

  // ====== render patients (phone ke hisab se group) ======
  function renderPatients() {
    var q = document.getElementById('mc-pat-search').value.trim().toLowerCase();
    var map = Object.create(null);
    all.forEach(function (a) {
      var key = a.phone.replace(/\D/g, '');
      var p = map[key] || (map[key] = {
        name: a.name,
        phone: a.phone,
        email: a.email,
        reportTargetId: a.email ? a._id : '',
        age: null,
        gender: '',
        visits: 0,
        last: ''
      });
      if (!p.email && a.email) p.email = a.email;
      if (!p.reportTargetId && a.email) p.reportTargetId = a._id;
      if (a.status === 'confirmed') {
        if (p.age == null && a.age != null) p.age = a.age;
        if (!p.gender && a.gender) p.gender = a.gender;
        p.visits++;
      }
      if (a.date > p.last) p.last = a.date;
    });
    var list = Object.keys(map).map(function (k) { return map[k]; }).filter(function (p) {
      return !q || (p.name + ' ' + p.phone + ' ' + (p.email || '')).toLowerCase().indexOf(q) !== -1;
    });
    if (!list.length) {
      patBody.innerHTML = '<tr><td class="mc-table__td" colspan="9">No patients found.</td></tr>';
      return;
    }
    patBody.innerHTML = list.map(function (p, i) {
      return '<tr class="mc-table__row"><td class="mc-table__td">' + (i + 1) + '</td>' +
        '<td class="mc-table__td" colspan="2"><div class="mc-cell-user"><span class="mc-avatar mc-avatar--' + color(p.name) + '">' + esc(initials(p.name)) + '</span>' + esc(p.name) + '</div></td>' +
        '<td class="mc-table__td">' + esc(p.phone) + (p.email ? '<span class="mc-cell-sub">' + esc(p.email) + '</span>' : '') + '</td>' +
        '<td class="mc-table__td">' + esc(p.age == null ? '—' : p.age) + '</td>' +
        '<td class="mc-table__td">' + esc(p.gender || '—') + '</td>' +
        '<td class="mc-table__td">' + p.visits + '</td>' +
        '<td class="mc-table__td">' + fmtDate(p.last) + '</td>' +
        '<td class="mc-table__td">' + (p.reportTargetId
          ? '<button type="button" class="mc-btn mc-btn--ghost" data-patient-report="' + esc(p.reportTargetId) + '">Email report</button>'
          : '—') + '</td></tr>';
    }).join('');
  }

  // ====== load data ======
  async function load() {
    try {
      var res = await api(showHidden ? '?showHidden=true' : '');
      all = res.data;
      render(); renderPatients();
    } catch (e) {
      var msg = (e.message === 'Failed to fetch') ? 'Cannot reach backend at ' + API_URL : e.message;
      apptBody.innerHTML = '<tr><td class="mc-table__td" colspan="9">' + esc(msg) + '</td></tr>';
      patBody.innerHTML = apptBody.innerHTML;
    }
  }

  // ====== view modal ======
  function openModal(a) {
    document.getElementById('mc-modal-title').textContent =
      a.recordType === 'patient' ? 'Patient details' : 'Appointment details';
    var rows = [
      ['Name', a.name], ['Phone', a.phone], ['Email', a.email || '—'], ['Mode', a.mode],
      ['Age', a.status === 'confirmed' && a.age != null ? a.age : '—'],
      ['Gender', a.status === 'confirmed' ? (a.gender || '—') : '—'],
      ['Consult area', a.consultType], ['Preferred date', fmtDate(a.date)], ['Preferred time', a.time],
      ['Status', cap(a.status)], ['Note', a.message || '—'],
      ['Received', new Date(a.createdAt).toLocaleString('en-IN')]
    ];
    document.getElementById('mc-modal-body').innerHTML = rows.map(function (r) {
      return '<div class="mc-modal__row"><span class="mc-modal__label">' + esc(r[0]) + '</span><span class="mc-modal__value">' + esc(r[1]) + '</span></div>';
    }).join('');
    var reportButton = document.getElementById('mc-report-download');
    reportButton.hidden = !a.reportPublicId;
    reportButton.dataset.appointmentId = a._id;
    var reportFile = document.getElementById('mc-report-file');
    var reportRecipient = document.getElementById('mc-report-recipient');
    var reportSendButton = document.getElementById('mc-report-send');
    reportRecipient.value = a.email || '';
    reportFile.value = '';
    reportFile.disabled = false;
    reportSendButton.dataset.appointmentId = a._id;
    reportSendButton.disabled = false;
    document.getElementById('mc-modal').classList.add('mc-modal--open');
  }
  document.getElementById('mc-report-download').addEventListener('click', async function () {
    var button = this;
    var reportWindow = window.open('about:blank', '_blank');
    if (!reportWindow) {
      toast('Allow pop-ups to download this private report.');
      return;
    }
    button.disabled = true;
    try {
      var result = await api('/' + encodeURIComponent(button.dataset.appointmentId) + '/report');
      reportWindow.location = result.downloadUrl;
    } catch (error) {
      reportWindow.close();
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('mc-report-send').addEventListener('click', async function () {
    var button = this;
    var fileInput = document.getElementById('mc-report-file');
    var recipientInput = document.getElementById('mc-report-recipient');
    if (!recipientInput.checkValidity()) {
      recipientInput.reportValidity();
      return;
    }
    var file = fileInput.files[0];
    if (!file) {
      toast('Choose a report to email.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast('The report must be 10 MB or smaller.');
      return;
    }
    if (['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) === -1) {
      toast('Choose a PDF, JPG, PNG or WEBP report.');
      return;
    }
    var formData = new FormData();
    formData.append('report', file);
    formData.append('email', recipientInput.value.trim());
    button.disabled = true;
    try {
      var result = await api('/' + encodeURIComponent(button.dataset.appointmentId) + '/send-report', {
        method: 'POST',
        body: formData
      });
      fileInput.value = '';
      toast(result.message);
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('mc-modal-close').addEventListener('click', function () {
    document.getElementById('mc-modal').classList.remove('mc-modal--open');
  });
  document.getElementById('mc-modal').addEventListener('click', function (e) {
    if (e.target.id === 'mc-modal') e.target.classList.remove('mc-modal--open');
  });

  // ====== actions (view / confirm / cancel) ======
  apptBody.addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var id = btn.closest('tr').dataset.id;
    var item = all.find(function (x) { return x._id === id; });
    if (!item) return;

    if (btn.dataset.act === 'view') return openModal(item);

    btn.disabled = true;
    try {
      if (btn.dataset.act === 'hidden') {
        var hiddenResult = await api('/' + encodeURIComponent(id) + '/hidden', {
          method: 'PATCH',
          body: { hidden: !item.hiddenAt }
        });
        item.hiddenAt = hiddenResult.data.hiddenAt;
        if (!showHidden && item.hiddenAt) {
          all = all.filter(function (appointment) { return appointment._id !== id; });
        }
        render();
        toast(item.hiddenAt ? 'Request hidden from the list' : 'Request restored');
        return;
      }
      var res = await api('/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        body: { status: btn.dataset.act }
      });
      item.status = res.data.status;
      render(); renderPatients();
      toast(res.data.emailSent === true
        ? 'Appointment confirmed; slip emailed.'
        : (res.data.emailMessage || ('Marked as ' + item.status)));
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });

  // ====== page switch ======
  root.querySelectorAll('[data-mc-page]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      root.querySelectorAll('.mc-nav__item').forEach(function (b) { b.classList.remove('mc-nav__item--active'); });
      root.querySelectorAll('.mc-page').forEach(function (p) { p.classList.remove('mc-page--active'); });
      btn.classList.add('mc-nav__item--active');
      root.querySelector('#mc-page-' + btn.dataset.mcPage).classList.add('mc-page--active');
    });
  });

  // ====== filter tabs + search ======
  root.querySelectorAll('[data-mc-filter]').forEach(function (tab) {
    tab.addEventListener('click', function () {
      root.querySelectorAll('.mc-tab').forEach(function (t) { t.classList.remove('mc-tab--active'); });
      tab.classList.add('mc-tab--active');
      currentFilter = tab.dataset.mcFilter;
      currentPage = 1;
      render();
    });
  });
  pagination.addEventListener('click', function (e) {
    var button = e.target.closest('[data-page-action]');
    if (!button || button.disabled) return;
    currentPage += button.dataset.pageAction === 'next' ? 1 : -1;
    render();
  });
  document.getElementById('mc-appt-search').addEventListener('input', function () {
    currentPage = 1;
    render();
  });
  document.getElementById('mc-pat-search').addEventListener('input', renderPatients);
  patBody.addEventListener('click', function (event) {
    var button = event.target.closest('[data-patient-report]');
    if (!button) return;
    var patientRecord = all.find(function (record) {
      return record._id === button.dataset.patientReport;
    });
    if (patientRecord) openModal(patientRecord);
  });
  var dateFilterInput = document.getElementById('mc-date-filter');
  var dateFilterLabel = document.getElementById('mc-today');
  var dateClearButton = document.getElementById('mc-date-clear');
  document.getElementById('mc-today-btn').addEventListener('click', function () {
    if (typeof dateFilterInput.showPicker === 'function') dateFilterInput.showPicker();
    else {
      dateFilterInput.focus();
      dateFilterInput.click();
    }
  });
  dateFilterInput.addEventListener('change', function () {
    currentDateFilter = dateFilterInput.value;
    dateFilterLabel.textContent = currentDateFilter ? fmtDate(currentDateFilter) : 'Filter by date';
    dateClearButton.hidden = !currentDateFilter;
    currentPage = 1;
    render();
  });
  dateClearButton.addEventListener('click', function () {
    currentDateFilter = '';
    dateFilterInput.value = '';
    dateFilterLabel.textContent = 'Filter by date';
    dateClearButton.hidden = true;
    currentPage = 1;
    render();
  });
  document.getElementById('mc-show-hidden').addEventListener('change', function () {
    showHidden = this.checked;
    currentPage = 1;
    load();
  });

  // ====== profile photo upload (backend: POST /api/upload/image) ======
  var photoBtn = document.getElementById('mc-photo-btn');
  var photoFile = document.getElementById('mc-photo-file');
  var photoImg = document.getElementById('mc-photo-img');
  var topImg = document.getElementById('mc-profile-img');
  var pendingPhotoUrl = currentUser.photoUrl || '';

  function isSafeUrl(u) { return /^https?:\/\//i.test(String(u || '')); }

  function applyPhoto(src) {
    photoImg.src = src;
    topImg.src = src;
  }

  async function uploadImage(file) {
    var formData = new FormData();
    formData.append('image', file); // backend field name: "image"

    var res = await fetch(UPLOAD_URL, {
      method: 'POST',
      credentials: 'include',
      body: formData // Content-Type browser khud set karta hai
    });

    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.message || 'Upload failed');
    if (!isSafeUrl(data.imageUrl)) throw new Error('Server did not return an image URL');
    return data; // { imageUrl, publicId }
  }

  photoBtn.addEventListener('click', function () { photoFile.click(); });

  photoFile.addEventListener('change', async function () {
    var file = photoFile.files[0];
    if (!file) return;

    if (ALLOWED_TYPES.indexOf(file.type) === -1) {
      toast('Only PNG, JPG or WEBP images allowed');
      photoFile.value = '';
      return;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      toast('Image must be under ' + MAX_IMAGE_MB + ' MB');
      photoFile.value = '';
      return;
    }

    var previousSrc = photoImg.src;
    var localPreview = URL.createObjectURL(file);
    applyPhoto(localPreview); // upload hone tak turant preview
    photoBtn.disabled = true;
    toast('Uploading...');

    try {
      var data = await uploadImage(file);
      applyPhoto(data.imageUrl);
      pendingPhotoUrl = data.imageUrl;
      toast('Photo uploaded. Save Changes to update your profile.');
    } catch (err) {
      applyPhoto(previousSrc); // fail hua to purani photo wapas
      toast(err.message === 'Failed to fetch' ? 'Cannot reach backend at ' + API_URL : err.message);
    } finally {
      URL.revokeObjectURL(localPreview);
      photoBtn.disabled = false;
      photoFile.value = '';
    }
  });

  document.getElementById('mc-profile-save').addEventListener('click', async function () {
    var button = this;
    var nameInput = document.getElementById('mc-name');
    var emailInput = document.getElementById('mc-email');
    var phoneInput = document.getElementById('mc-phone');
    var specializationInput = document.getElementById('mc-spec');
    if (![nameInput, emailInput, phoneInput].every(function (input) { return input.checkValidity(); })) {
      [nameInput, emailInput, phoneInput].find(function (input) { return !input.checkValidity(); }).reportValidity();
      return;
    }
    button.disabled = true;
    try {
      var result = await authApi('profile', {
        method: 'PATCH',
        body: {
          name: nameInput.value.trim(),
          email: emailInput.value.trim(),
          phone: phoneInput.value.trim(),
          specialization: specializationInput.value.trim(),
          photoUrl: pendingPhotoUrl
        }
      });
      currentUser = result.data;
      document.getElementById('mc-account-name').textContent = currentUser.name;
      document.getElementById('mc-profile-img').alt = 'Profile photo of ' + currentUser.name;
      if (currentUser.photoUrl) applyPhoto(currentUser.photoUrl);
      toast('Profile changes saved to your account.');
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });

  
// ====== Add Patient ======
var addModal = document.getElementById('mc-add-modal');
var addForm = document.getElementById('mc-add-form');
var addSubmit = document.getElementById('mc-add-submit');
var addDate = document.getElementById('mc-add-date');
var addTime = document.getElementById('mc-add-time');

function updateAddTimePeriods() {
  var today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  var sameDay = addDate.value === today;
  var hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23'
  }).format(new Date()));
  Array.prototype.forEach.call(addTime.options, function (option) {
    option.disabled = sameDay &&
      ((option.value === 'Morning' && hour >= 12) ||
       (option.value === 'Afternoon' && hour >= 17));
  });
  if (addTime.selectedOptions[0] && addTime.selectedOptions[0].disabled) {
    addTime.value = 'No preference';
  }
}

function openAdd() {
  addForm.reset();
  var today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  addDate.min = today;
  addDate.value = today;
  updateAddTimePeriods();
  addModal.classList.add('mc-modal--open');
  document.getElementById('mc-add-name').focus();
}
addDate.addEventListener('change', updateAddTimePeriods);
function closeAdd() { addModal.classList.remove('mc-modal--open'); }

document.getElementById('mc-add-patient').addEventListener('click', openAdd);
addModal.addEventListener('click', function (e) { if (e.target === addModal) closeAdd(); });
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && addModal.classList.contains('mc-modal--open')) closeAdd();
});

addForm.addEventListener('submit', async function (e) {
  e.preventDefault();
  if (!addForm.checkValidity()) { addForm.reportValidity(); return; }

  var d = new FormData(addForm);
  var body = {
    mode: d.get('mode'),
    name: String(d.get('name')).trim(),
    phone: String(d.get('phone')).trim(),
    age: Number(d.get('age')),
    gender: d.get('gender'),
    email: String(d.get('email') || '').trim(),
    consultType: d.get('consultType'),
    date: d.get('date'),
    time: d.get('time') || 'No preference',
    message: String(d.get('message') || '').trim()
  };

  addSubmit.disabled = true;
  addSubmit.textContent = 'Saving...';
  try {
    await api('', { method: 'POST', body: body });   // POST /api/admin/appointments
    closeAdd();
    await load();                                     // list refresh
    root.querySelector('[data-mc-page="patients"]').click();
    toast('Patient added');
  } catch (err) {
    toast(err.message);
  } finally {
    addSubmit.disabled = false;
    addSubmit.textContent = 'Add Patient';
  }
});
  // ====== aaj ki date button par ======
  document.getElementById('mc-today').textContent =
    new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

  load();
  setInterval(load, 60000); // har 60 sec mein auto refresh
})();