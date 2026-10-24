import { apiFetch, sessionReady } from './session.js';
import { commercialPayload, localDateTime, quotaDescription, roleNames } from './superadmin-model.js';

const $ = id => document.getElementById(id);
const form = $('user-form');
const fields = form.elements;
const dialog = $('user-dialog');
let users = [], currentUser, editing = null, saving = false, loading = false, detailVersion = 0;
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
$('expiry-help').textContent = `Horário deste dispositivo (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Sem data, o acesso não expira. Alterar a validade encerra as sessões atuais.`;

async function request(url, options = {}) {
  const response = await apiFetch(url, { ...options, cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || 'Não foi possível concluir a operação.');
  return data;
}
function cell(text, label) {
  const td = document.createElement('td'); td.textContent = text;
  if (label) td.dataset.label = label;
  return td;
}
function render() {
  const query = $('user-search').value.trim().toLocaleLowerCase('pt-BR');
  const matching = users.filter(user => `${user.name} ${user.email}`.toLocaleLowerCase('pt-BR').includes(query));
  $('user-list').replaceChildren();
  $('user-count').textContent = `${matching.length} usuário(s)`;
  for (const user of matching) {
    const row = document.createElement('tr');
    const identity = cell('');
    const name = document.createElement('strong'); name.textContent = user.name + (user.id === currentUser.id ? ' (você)' : '');
    const email = document.createElement('small'); email.textContent = user.email; identity.append(name, email);
    const actions = cell('');
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Gerenciar';
    edit.setAttribute('aria-label', `Gerenciar ${user.name}`); edit.addEventListener('click', () => open(user));
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Excluir'; remove.className = 'users-danger';
    remove.disabled = user.id === currentUser.id; remove.setAttribute('aria-label', `Excluir ${user.name}`);
    remove.addEventListener('click', async () => {
      if (!confirm(`Excluir “${user.name}”? A conta, as sessões e o histórico de consumo serão removidos. Esta ação não pode ser desfeita.`)) return;
      remove.disabled = true;
      try {
        await request(`/api/users/${user.id}`, { method: 'DELETE' });
        users = users.filter(item => item.id !== user.id); render();
        $('users-status').textContent = 'Usuário excluído.';
      } catch (error) { $('users-status').textContent = error.message; remove.disabled = false; }
    });
    actions.append(edit, remove);
    row.append(identity, cell(roleNames[user.role] || user.role, 'Perfil'), cell(user.active ? 'Ativo' : 'Desativado', 'Cadastro'),
      cell(user.artwork_limit === null ? 'Ilimitado' : `${user.artwork_limit} / ${user.artwork_limit_period === 'monthly' ? 'mês' : 'pacote total'}`, 'Limite de artes'),
      cell(user.access_expires_at ? dateFormat.format(new Date(user.access_expires_at)) : 'Sem expiração', 'Expiração'), actions);
    $('user-list').append(row);
  }
  if (!matching.length) { const row = document.createElement('tr'); const td = cell('Nenhum usuário encontrado.'); td.colSpan = 6; row.append(td); $('user-list').append(row); }
}
async function load() {
  if (loading) return;
  loading = true; $('reload-users').disabled = true; $('users-status').textContent = 'Carregando usuários…';
  try { users = (await request('/api/users')).items; render(); $('users-status').textContent = ''; }
  catch (error) { $('users-status').textContent = error.message; }
  finally { loading = false; $('reload-users').disabled = false; }
}
function syncConditions() {
  fields.artwork_limit.disabled = fields.limit_mode.value === 'unlimited';
  fields.artwork_limit.required = !fields.artwork_limit.disabled;
  fields.access_expires_at.disabled = !fields.expires.checked;
  fields.access_expires_at.required = fields.expires.checked;
}
function fillCommercial(user) {
  fields.limit_mode.value = user?.artwork_limit == null ? 'unlimited' : user.artwork_limit_period;
  fields.artwork_limit.value = user?.artwork_limit ?? 100;
  fields.expires.checked = Boolean(user?.access_expires_at);
  fields.access_expires_at.value = localDateTime(user?.access_expires_at);
  syncConditions();
}
async function open(user) {
  const version = ++detailVersion;
  editing = user ? { ...user } : null; form.reset();
  $('user-dialog-title').textContent = user ? 'Gerenciar usuário' : 'Novo usuário';
  for (const field of ['name', 'email', 'role']) fields[field].value = user?.[field] ?? (field === 'role' ? 'cliente' : '');
  fields.active.checked = user?.active ?? true; fields.password.required = !user;
  $('password-label').textContent = user ? 'Nova senha (opcional)' : 'Senha';
  fillCommercial(user);
  $('user-form-status').textContent = '';
  $('quota-summary').textContent = user ? 'Consultando consumo e condições atuais…' : 'O consumo começa em zero para uma nova conta.';
  $('user-fields').disabled = Boolean(user); $('save-user').disabled = Boolean(user);
  dialog.showModal();
  if (!user) { fields.name.focus(); return; }
  try {
    const quota = await request(`/api/users/${user.id}/commercial`);
    if (version !== detailVersion) return;
    editing = { ...user, access_expires_at: quota.access_expires_at, artwork_limit: quota.artwork_limit, artwork_limit_period: quota.artwork_limit_period };
    fillCommercial(editing); $('quota-summary').textContent = quotaDescription(quota);
    $('user-fields').disabled = false; $('save-user').disabled = false; fields.name.focus();
  } catch (error) { if (version === detailVersion) $('user-form-status').textContent = `${error.message} Feche e abra novamente para tentar outra vez.`; }
}
function close() { if (!saving) dialog.close(); }
dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
dialog.addEventListener('close', () => { detailVersion++; editing = null; form.reset(); });
$('new-user').addEventListener('click', () => open());
$('close-user').addEventListener('click', close); $('cancel-user').addEventListener('click', close);
$('user-search').addEventListener('input', () => { if (currentUser) render(); });
$('reload-users').addEventListener('click', load);
fields.limit_mode.addEventListener('change', syncConditions); fields.expires.addEventListener('change', syncConditions);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || $('save-user').disabled || !form.reportValidity()) return;
  let payload;
  try {
    payload = { name: fields.name.value, email: fields.email.value, role: fields.role.value, active: fields.active.checked, password: fields.password.value,
      ...commercialPayload({ mode: fields.limit_mode.value, limit: fields.artwork_limit.value, expires: fields.expires.checked, expiration: fields.access_expires_at.value }, editing) };
  } catch (error) { $('user-form-status').textContent = error.message; return; }
  if (editing?.id === currentUser.id && payload.artwork_limit !== null
    && !confirm('Você está definindo um limite para sua própria conta. Ao atingir esse limite, novos logins serão bloqueados. Continuar?')) return;
  saving = true; $('user-fields').disabled = true;
  for (const id of ['save-user', 'cancel-user', 'close-user']) $(id).disabled = true;
  $('user-form-status').textContent = 'Salvando…';
  try {
    const saved = await request(editing ? `/api/users/${editing.id}` : '/api/users', {
      method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (editing?.id === currentUser.id && (payload.password || saved.email !== currentUser.email
      || saved.role !== currentUser.role || !saved.active || saved.access_expires_at !== currentUser.access_expires_at)) {
      location.assign('/login'); return;
    }
    users = editing ? users.map(user => user.id === saved.id ? saved : user) : [...users, saved];
    if (saved.id === currentUser.id) currentUser = saved;
    render(); dialog.close(); $('users-status').textContent = 'Usuário salvo.';
  } catch (error) { $('user-form-status').textContent = error.message; }
  finally {
    fields.password.value = ''; saving = false; $('user-fields').disabled = false;
    for (const id of ['save-user', 'cancel-user', 'close-user']) $(id).disabled = false;
  }
});
async function initialize() {
  try {
    currentUser = (await sessionReady).user;
    if (currentUser.role !== 'superadministrador') throw new Error('Acesso exclusivo para superadministradores.');
    await load(); $('new-user').disabled = false;
  } catch (error) { $('users-status').textContent = error.message; }
}
globalThis.appLoading?.track(initialize());
