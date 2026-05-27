import { t } from './i18n.js';
import siteConfig from '@site-config';
import { escapeHtml } from './utils.js';

const TOKEN_KEY = 'sgi_token';

export function isLoggedIn() {
  return !!localStorage.getItem(TOKEN_KEY);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch (e) {
    return null;
  }
}

export function getLoggedInUser() {
  const token = getToken();
  if (!token) return null;
  const payload = parseJwt(token);
  if (!payload) return null;

  // Support both standard JWT and WP JWT Plugin structures
  const id = payload.data?.user?.id || payload.sub || '0';
  const savedName = localStorage.getItem('sgi_user_name');
  const name = savedName || payload.data?.user?.display_name || payload.user_display_name || payload.name || t('account');
  const savedNicename = localStorage.getItem('sgi_user_nicename');
  const nicename = savedNicename || payload.data?.user?.user_nicename || payload.user_nicename || id;
  return { id, name, nicename };
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('sgi_user_name');
  localStorage.removeItem('sgi_user_nicename');
  updateUserIconState();
  window.location.reload(); // Refresh to lock UI back down
}

export async function login(username, password) {
  if (!siteConfig.authUrl) throw new Error('Auth URL not configured');

  const res = await fetch(siteConfig.authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  if (!res.ok) throw new Error('Login failed');

  const data = await res.json();
  if (data.token) {
    localStorage.setItem(TOKEN_KEY, data.token);
    if (data.user_display_name) {
      localStorage.setItem('sgi_user_name', data.user_display_name);
    }
    if (data.user_nicename) {
      localStorage.setItem('sgi_user_nicename', data.user_nicename);
    }
    updateUserIconState();
    return true;
  }
  throw new Error('No token in response');
}

export function initAuth() {
  if (!siteConfig.authUrl) {
    console.info('[Auth] No authUrl configured for this site. Login disabled.');
    return;
  }

  console.log('[Auth] Initializing authentication UI...');

  // 1. Inject the User Icon into the right navigation cluster
  const navRight = document.querySelector('.srd-nav-right');
  if (navRight) {
    const authBtn = document.createElement('button');
    authBtn.id = 'auth-toggle-btn';
    authBtn.className = 'srd-icon-btn';
    authBtn.style.display = 'inline-flex'; // Force display just in case

    authBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (isLoggedIn()) {
        toggleAuthDropdown(authBtn);
      } else {
        requireLogin('login_desc');
      }
    });

    // Insert it safely before the hamburger menu
    const hamburger = navRight.querySelector('.hamburger-btn');

    // Wrap the button and the dropdown to anchor the standard popover correctly
    const wrapper = document.createElement('div');
    wrapper.className = 'auth-nav-wrapper';
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-flex';
    wrapper.style.alignItems = 'center';
    wrapper.appendChild(authBtn);

    const dropdownHtml = `<div id="auth-dropdown" class="srd-popover" style="top: calc(100% + 4px); right: 0;"></div>`;
    wrapper.insertAdjacentHTML('beforeend', dropdownHtml);

    navRight.insertBefore(wrapper, hamburger);
  }

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('auth-dropdown');
    const authBtn = document.getElementById('auth-toggle-btn');
    if (dropdown && dropdown.classList.contains('open') && !dropdown.contains(e.target)) {
      if (!authBtn || !authBtn.contains(e.target)) {
      dropdown.classList.remove('open');
      }
    }
  });

  // Prevent clicks inside the dropdown from closing it
  const dropdown = document.getElementById('auth-dropdown');
  if (dropdown) dropdown.addEventListener('click', (e) => e.stopPropagation());

  // 2. Inject the Login Modal into the DOM
  const loginDescText = String(t('login_desc') || '').replace('{society}', String(t('society_name') || ''));
  const modalHtml = `
    <div id="login-modal" class="srd-modal-overlay">
      <div class="srd-modal">
        <button type="button" class="srd-modal-close" aria-label="Close">&times;</button>
        <h3>${t('login_title')}</h3>
        <p id="login-desc">${loginDescText}</p>
        <div id="login-error" class="login-error" style="display: none;"></div>
        <form id="login-form">
          <div class="input-wrapper" style="margin-bottom: 12px; display: block;">
            <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 0.9em;">${t('username')}</label>
            <input type="text" id="login-user" required style="width: 100%; box-sizing: border-box; padding: 8px;" />
          </div>
          <div class="input-wrapper" style="margin-bottom: 20px; display: block;">
            <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 0.9em;">${t('password')}</label>
            <input type="password" id="login-pass" required style="width: 100%; box-sizing: border-box; padding: 8px;" />
          </div>
          <button type="submit" class="primary-btn" style="width: 100%;">${t('login_submit')}</button>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // 3. Event Listeners for the Modal
  const modal = document.getElementById('login-modal');
  const closeBtn = modal.querySelector('.srd-modal-close');
  const form = document.getElementById('login-form');
  const errorMsg = document.getElementById('login-error');

  closeBtn.addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('login-user').value;
    const pass = document.getElementById('login-pass').value;
    const submitBtn = form.querySelector('button[type="submit"]');

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = t('login_loading');
      errorMsg.style.display = 'none';

      await login(user, pass);

      modal.classList.remove('open');
      form.reset();

      // Reload page to re-render previously blocked UI views
      window.location.reload();
    } catch (err) {
      errorMsg.textContent = t('login_error');
      errorMsg.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = t('login_submit');
    }
  });

  updateUserIconState();
}

export function requireLogin(messageKey = 'login_desc') {
  const modal = document.getElementById('login-modal');
  const desc = document.getElementById('login-desc');
  if (modal && desc) {
    desc.textContent = String(t(messageKey) || '').replace('{society}', String(t('society_name') || ''));
    modal.classList.add('open');
  }
}

function populateAuthDropdown() {
  const dropdown = document.getElementById('auth-dropdown');
  if (!dropdown) return;

  const user = getLoggedInUser();
  if (!user) {
    dropdown.innerHTML = '';
    return;
  }

  dropdown.innerHTML = `
    <div class="auth-user-info">
      <div class="auth-user-name">${escapeHtml(user.name)}</div>
      <div class="auth-user-id">@${escapeHtml(String(user.nicename))}</div>
    </div>
    <a href="#" id="logout-btn" class="auth-dropdown-action">${t('logout')}</a>
  `;

  dropdown.querySelector('#logout-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (confirm(t('logout_confirm'))) logout();
  });
}

function toggleAuthDropdown(authBtn) {
  const dropdown = document.getElementById('auth-dropdown');
  if (dropdown.classList.contains('open')) {
    dropdown.classList.remove('open');
    return;
  }
  populateAuthDropdown();
  dropdown.classList.add('open');
}

function updateUserIconState() {
  const authBtn = document.getElementById('auth-toggle-btn');
  if (!authBtn) return;

  if (isLoggedIn()) {
    authBtn.classList.add('logged-in');
    authBtn.title = t('account');
    authBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg><span class="logged-in-indicator"></span>`;
  } else {
    authBtn.classList.remove('logged-in');
    authBtn.title = t('login');
    // "Log in" user avatar icon
    authBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
  }
}