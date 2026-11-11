/**
 * login.js — Logika halaman login.
 *
 * Sengaja dipisah dari login.html agar patuh CSP produksi
 * (`script-src 'self'` memblokir <script> inline).
 */

import { auth, setToken } from './api.js';

const form = document.getElementById('loginForm');
const btn = document.getElementById('loginBtn');
const errBox = document.getElementById('loginError');

/** Tampilkan pesan error di kotak atas form. */
function showError(message) {
  errBox.textContent = message;
  errBox.hidden = false;
}

/** Kembalikan tombol ke keadaan normal. */
function resetButton() {
  btn.disabled = false;
  btn.textContent = 'Masuk';
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  errBox.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Memproses…';

  try {
    const data = await auth.login(
      document.getElementById('username').value.trim(),
      document.getElementById('password').value
    );
    setToken(data.token);
    location.replace('index.html');
  } catch (err) {
    showError(err.message || 'Login gagal.');
    resetButton();
  }
});
