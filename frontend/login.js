(function () {
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function show(id) {
    $$('.cv-view').forEach(function (v) { v.classList.toggle('cv-is-active', v.id === id); });
    $$('.cv-msg').forEach(function (m) { m.textContent = ''; m.className = 'cv-msg'; });
    if (id === 'cv-forgot-form') {
      $('#cv-forgot-form').reset();
      $('#cv-forgot-step1').hidden = false;
      $('#cv-forgot-step2').hidden = true;
      $('#cv-forgot-sub').textContent = 'Enter the email address linked to your account. We will send a 6-digit reset code.';
    }
    try { history.replaceState(null, '', '#' + id.replace('cv-', '').replace('-form', '')); } catch (e) {}
  }
  function say(form, text, ok) {
    var m = form.querySelector('.cv-msg');
    m.textContent = text;
    m.className = 'cv-msg' + (ok ? ' cv-is-ok' : '');
  }
  var API_URL = 'https://curavera-web-page.onrender.com';
  async function authRequest(path, body) {
    var response = await fetch(API_URL + '/api/auth/' + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var result = await response.json().catch(function () { return {}; });
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Authentication request failed.');
    }
    return result;
  }
  var isMail = function (v) { return /^\S+@\S+\.\S+$/.test(v); };
  var isPhone = function (v) { return /^[6-9]\d{9}$/.test(v.trim()); };
  var val = function (id) { return $('#' + id).value; };

  $$('[data-cv-go]').forEach(function (el) {
    el.addEventListener('click', function () { show('cv-' + el.getAttribute('data-cv-go') + '-form'); });
  });
  $$('.cv-eye').forEach(function (b) {
    b.addEventListener('click', function () {
      var i = b.parentNode.querySelector('.cv-input');
      i.type = i.type === 'password' ? 'text' : 'password';
    });
  });

  $('#cv-login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var id = val('cv-login-id').trim();
    if (!isMail(id) && !isPhone(id)) return say(this, 'Enter a valid email or 10-digit Indian mobile number starting with 6, 7, 8 or 9.');
    if (val('cv-login-pass').length < 8) return say(this, 'Password must be at least 8 characters.');
    var form = this;
    var submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    say(form, 'Signing in…');
    try {
      await authRequest('login', { identity: id, password: val('cv-login-pass') });
      say(form, 'Login successful. Opening your dashboard…', true);
      window.location.replace('medicare.html');
    } catch (error) {
      say(form, error.message || 'Could not log in. Please try again.');
    } finally {
      submit.disabled = false;
    }
  });

  $('#cv-signup-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (val('cv-signup-name').trim().length < 3) return say(this, 'Enter your full name.');
    if (!isMail(val('cv-signup-email').trim())) return say(this, 'Enter a valid email address.');
    if (!isPhone(val('cv-signup-phone'))) return say(this, 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.');
    if (val('cv-signup-reg').trim().length < 4) return say(this, 'Enter your medical registration number.');
    if (val('cv-signup-pass').length < 8) return say(this, 'Password must be at least 8 characters.');
    if (val('cv-signup-pass') !== val('cv-signup-confirm')) return say(this, 'Passwords do not match.');
    if (!$('#cv-signup-terms').checked) return say(this, 'Accept the terms to continue.');
    var form = this;
    var submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    say(form, 'Creating account…');
    try {
      var registeredEmail = val('cv-signup-email').trim();
      var result = await authRequest('signup', {
        name: val('cv-signup-name').trim(),
        email: registeredEmail,
        phone: val('cv-signup-phone').trim(),
        registrationNumber: val('cv-signup-reg').trim(),
        password: val('cv-signup-pass')
      });
      form.reset();
      show('cv-login-form');
      $('#cv-login-id').value = registeredEmail;
      say($('#cv-login-form'), result.message, true);
    } catch (error) {
      say(form, error.message || 'Could not create your account.');
    } finally {
      submit.disabled = false;
    }
  });

  $('#cv-forgot-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var form = this;
    var step1 = $('#cv-forgot-step1');
    var step2 = $('#cv-forgot-step2');
    var submit = (step2.hidden ? step1 : step2).querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      if (step2.hidden) {
        var email = val('cv-forgot-id').trim().toLowerCase();
        if (!isMail(email)) {
          say(form, 'Enter a valid email address.');
          return;
        }
        var result = await authRequest('forgot-password', { email: email });
        step1.hidden = true;
        step2.hidden = false;
        $('#cv-forgot-sub').textContent = 'If an account exists for this email, a code has been sent. The code expires in 10 minutes.';
        say(form, result.message, true);
        return;
      }

      var code = val('cv-forgot-code').trim();
      var password = val('cv-forgot-newpass');
      if (!/^\d{6}$/.test(code)) {
        say(form, 'Enter the 6-digit code from your email.');
        return;
      }
      if (password.length < 8 || password.length > 128) {
        say(form, 'Password must be 8–128 characters.');
        return;
      }
      if (password !== val('cv-forgot-confirm')) {
        say(form, 'Passwords do not match.');
        return;
      }

      var emailForLogin = val('cv-forgot-id').trim().toLowerCase();
      var reset = await authRequest('reset-password', {
        email: emailForLogin,
        code: code,
        password: password
      });
      form.reset();
      step1.hidden = false;
      step2.hidden = true;
      $('#cv-forgot-sub').textContent = 'Enter the email address linked to your account. We will send a 6-digit reset code.';
      show('cv-login-form');
      $('#cv-login-id').value = emailForLogin;
      say($('#cv-login-form'), reset.message, true);
    } catch (error) {
      say(form, error.message || 'Password reset failed. Please try again.');
    } finally {
      submit.disabled = false;
    }
  });

  var h = location.hash.slice(1);
  if (h === 'signup' || h === 'forgot') show('cv-' + h + '-form');

  fetch(API_URL + '/api/auth/me', { credentials: 'include' }).then(function (response) {
    if (response.ok) window.location.replace('medicare.html');
  }).catch(function () {
    say($('#cv-login-form'), 'Cannot reach the login service. Check that the backend is running.');
  });
})();
