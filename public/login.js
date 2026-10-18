'use strict';
document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err');
  err.hidden = true;
  try {
    await api('POST', '/api/login', { password: document.getElementById('pw').value });
    location.href = '/';
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});
