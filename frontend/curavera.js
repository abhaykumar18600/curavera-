(() => {
  const ICON_MENU = '<svg class="cv-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16" /> <path d="M4 12h16" /> <path d="M4 19h16" /></svg>', ICON_X = '<svg class="cv-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18" /> <path d="m6 6 12 12" /></svg>';
  // Card images: try the online image first; if it fails, use the local fallback (data-cv-fallback)
  document.addEventListener('error', e => {
    const t = e.target;
    if (t.tagName === 'IMG' && t.dataset.cvFallback && !t.dataset.cvTried) { t.dataset.cvTried = '1'; t.src = t.dataset.cvFallback; }
  }, true);

  const $ = id => document.getElementById(id);
  const burger = $('cv-burger'), menu = $('cv-menu');
  const setMenu = open => { menu.classList.toggle('cv-menu--open', open); burger.setAttribute('aria-expanded', String(open)); burger.innerHTML = open ? ICON_X : ICON_MENU; };
  burger.addEventListener('click', () => setMenu(!menu.classList.contains('cv-menu--open')));
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenu(false)));

  const WA_NUMBER = '91 8354032138'; // your WhatsApp number (with country code, without +)
  const waUrl = t => `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(t)}`;
  document.querySelectorAll('[data-cv-wa]').forEach(el => { el.href = waUrl('Hello Doctor, I would like to book an appointment.'); });
  $('cv-year').textContent = new Date().getFullYear();

  const dateInput = $('cv-date');
  const dateValueInIndia = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const today = dateValueInIndia();
  dateInput.min = today;
  const timeSelect = $('cv-preferred-time');
  const updateTimePeriods = () => {
    const sameDay = dateInput.value === dateValueInIndia();
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23'
    }).format(new Date()));
    Array.prototype.forEach.call(timeSelect.options, option => {
      option.disabled = sameDay &&
        ((option.value === 'morning' && hour >= 12) ||
         (option.value === 'afternoon' && hour >= 17));
    });
    if (timeSelect.selectedOptions[0] && timeSelect.selectedOptions[0].disabled) {
      timeSelect.value = 'No preference';
    }
  };
  dateInput.addEventListener('change', updateTimePeriods);
  updateTimePeriods();
  window.setInterval(updateTimePeriods, 60000);

  const modal = $('cv-modal');
  const closeModal = () => { modal.classList.remove('cv-modal--open'); document.body.style.overflow = ''; };
  document.querySelectorAll('[data-cv-open]').forEach(btn => btn.addEventListener('click', () => {
    modal.classList.add('cv-modal--open'); document.body.style.overflow = 'hidden'; $('cv-modal-go').focus();
    const m = btn.dataset.mode;
    if (m) { const r = document.querySelector(`input[name=mode][value="${m}"]`); if (r) r.checked = true; }
  }));
  ['cv-modal-close', 'cv-modal-dismiss', 'cv-modal-go'].forEach(id => $(id).addEventListener('click', closeModal));
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  const form = $('cv-form'), status = $('cv-status');
  const submitButton = form.querySelector('button[type="submit"]');
  const originalSubmitButtonHTML = submitButton.innerHTML;
  const API_HOST = window.location.hostname || 'localhost';
  const API_PROTOCOL = window.location.protocol === 'https:' ? 'https:' : 'http:';
  const API_URL = API_PROTOCOL + '//' + API_HOST + ':5000';

  const showFormStatus = (message, type) => {
    status.textContent = message;
    status.className = `cv-status cv-status--show cv-status--${type}`;
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    status.className = 'cv-status';
    dateInput.min = dateValueInIndia();
    updateTimePeriods();

    if (!form.checkValidity()) {
      form.reportValidity();
      showFormStatus('Please complete the required fields.', 'error');
      return;
    }
    const d = new FormData(form);
    const preferredTime = String(d.get('preferredTime') || '').trim();
    const report = $('cv-report').files[0];
    if (report && report.size > 10 * 1024 * 1024) {
      showFormStatus('The report must be 10 MB or smaller.', 'error');
      return;
    }
    if (report && !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(report.type)) {
      showFormStatus('Upload a PDF, JPG, PNG or WEBP report.', 'error');
      return;
    }
    const appointmentData = {
      mode: String(d.get('mode') || '').trim(),
      name: String(d.get('name') || '').trim(),
      phone: String(d.get('phone') || '').trim(),
      age: Number(d.get('age')),
      gender: String(d.get('gender') || '').trim(),
      email: String(d.get('email') || '').trim(),
      consultType: String(d.get('consultType') || '').trim(),
      date: String(d.get('date') || '').trim(),
      time: preferredTime === 'morning' ? 'Morning' :
        preferredTime === 'afternoon' ? 'Afternoon' :
        preferredTime === 'evening' ? 'Evening' : 'No preference',
      message: String(d.get('message') || '').trim(),
      consent: d.get('consent') === 'true'
    };

    const first = appointmentData.name.split(/\s+/)[0] || 'there';

    if (!appointmentData.consent) {
      showFormStatus('Please accept the consent statement before submitting.', 'error');
      return;
    }

    // Keep WhatsApp as an optional alternative contact method.
    $('cv-wa-form').href = waUrl(
      `Appointment request (${appointmentData.mode})\n` +
      `Name: ${appointmentData.name}\n` +
      `Phone: ${appointmentData.phone}\n` +
      `Area: ${appointmentData.consultType}\n` +
      `Date: ${appointmentData.date}\n` +
      `Time: ${appointmentData.time}\n` +
      `Note: ${appointmentData.message || '-'}`
    );

    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';

    try {
      const requestData = new FormData();
      Object.keys(appointmentData).forEach(key => requestData.append(key, String(appointmentData[key])));
      if (report) requestData.append('report', report);
      const response = await fetch(`${API_URL}/api/appointments`, {
        method: 'POST',
        body: requestData
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.message || 'Unable to submit your request.');
      }

      showFormStatus(
        `Thanks, ${first}. Your request is with the clinic for review. If approved, the appointment slip will be emailed to you. Submission does not confirm the appointment.`,
        'success'
      );

      form.reset();
      dateInput.min = dateValueInIndia();
      updateTimePeriods();

    } catch (error) {
      console.error('Appointment submission failed:', error);
      showFormStatus(
        error.message || 'Could not connect to the appointment server. Please try again.',
        'error'
      );
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = originalSubmitButtonHTML;
    }
  });
})();
