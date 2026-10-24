import { apiFetch, sessionReady } from './session.js';
const $ = (id) => document.getElementById(id);
const form = $('user-form');
let users = [], editingId = null, currentUser;
async function request(url, options) {
  const response = await apiFetch(url, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || 'Não foi possível concluir a operação.');
  return data;
}
function render() {
  const query = $('user-search').value.trim().toLocaleLowerCase('pt-BR');
  const matching = users.filter((user) => `${user.name} ${user.email}`.toLocaleLowerCase('pt-BR').includes(query));
  $('user-list').replaceChildren();
  $('user-count').textContent = `${matching.length} usuário(s)`;
  for (const user of matching) {
    const row = document.createElement('tr');
    const identity = document.createElement('td');
    const name = document.createElement('strong'); name.textContent = user.name + (user.id === currentUser.id ? ' (você)' : '');
    const email = document.createElement('small'); email.textContent = user.email; identity.append(name, email);
    const role = document.createElement('td'); role.textContent = user.role === 'administrador' ? 'Administrador' : 'Cliente';
    const active = document.createElement('td'); active.textContent = user.active ? 'Ativo' : 'Bloqueado';
    const actions = document.createElement('td');
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Editar';
    edit.setAttribute('aria-label', `Editar ${user.name}`); edit.addEventListener('click', () => open(user));
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Excluir';
    remove.className = 'users-danger'; remove.disabled = user.id === currentUser.id;
    remove.setAttribute('aria-label', `Excluir ${user.name}`);
    remove.addEventListener('click', async () => {
      if (!confirm(`Excluir o usuário “${user.name}”? Seu acesso será encerrado.`)) return;
      remove.disabled = true;
      try { await request(`/api/users/${user.id}`, { method: 'DELETE' }); await load(); $('users-status').textContent = 'Usuário excluído.'; }
      catch (error) { $('users-status').textContent = error.message; remove.disabled = false; }
    });
    actions.append(edit, remove); row.append(identity, role, active, actions); $('user-list').append(row);
  }
  if (!matching.length) { const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 4; cell.textContent = 'Nenhum usuário encontrado.'; row.append(cell); $('user-list').append(row); }
}
async function load() {
  users = (await request('/api/users')).items; render(); $('users-status').textContent = '';
}
function open(user) {
  editingId = user?.id ?? null; form.reset();
  $('user-dialog-title').textContent = user ? 'Editar usuário' : 'Novo usuário';
  for (const field of ['name', 'email', 'role']) form.elements[field].value = user?.[field] ?? (field === 'role' ? 'cliente' : '');
  form.elements.active.checked = user?.active ?? true;
  form.elements.password.required = !user;
  $('password-label').textContent = user ? 'Nova senha (opcional)' : 'Senha';
  $('user-form-status').textContent = ''; $('user-dialog').showModal(); form.elements.name.focus();
}
function close() { $('user-dialog').close(); form.reset(); }
$('new-user').addEventListener('click', () => open());
$('close-user').addEventListener('click', close); $('cancel-user').addEventListener('click', close);
$('user-dialog').addEventListener('close', () => form.reset());
$('user-search').addEventListener('input', render);
$('reload-users').addEventListener('click', () => load().catch((error) => { $('users-status').textContent = error.message; }));
form.addEventListener('submit', async (event) => {
  event.preventDefault(); $('save-user').disabled = true; $('user-form-status').textContent = 'Salvando…';
  const payload = { name: form.elements.name.value, email: form.elements.email.value, role: form.elements.role.value,
    active: form.elements.active.checked, password: form.elements.password.value };
  try {
    await request(editingId ? `/api/users/${editingId}` : '/api/users', { method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (editingId === currentUser.id && (payload.password || payload.email.trim().toLowerCase() !== currentUser.email
      || payload.role !== currentUser.role || !payload.active)) { location.assign('/login'); return; }
    close(); await load(); $('users-status').textContent = 'Usuário salvo.';
  } catch (error) { $('user-form-status').textContent = error.message; }
  finally { $('save-user').disabled = false; }
});
async function initialize() {
  try {
    currentUser = (await sessionReady).user;
    if (currentUser.role !== 'administrador') throw new Error('Acesso exclusivo para administradores.');
    await load(); $('new-user').disabled = false;
  } catch (error) { $('users-status').textContent = error.message; }
}
const initialLoad = initialize();
globalThis.appLoading?.track(initialLoad);
