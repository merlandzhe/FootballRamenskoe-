import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, WHATSAPP_URL, PAYMENT_URL, PAYMENT_QR_IMAGE_URL, PAYMENT_BANK_LABEL, PRICE_RUB } from './config.js';
import './style.css';

const configured = SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('YOUR-PROJECT') && SUPABASE_ANON_KEY.length > 30 && !SUPABASE_ANON_KEY.includes('YOUR-SUPABASE');
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = (sel) => document.querySelector(sel);
const state = { event: null, players: [], admin: false, session: null, busy: false };


function upcomingSaturday() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());

  const get = type => parts.find(p => p.type === type).value;
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const weekday = get('weekday');
  const hour = Number(get('hour'));

  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let delta = (6 - days[weekday] + 7) % 7;

  if (delta === 0 && hour >= 23) delta = 7;

  return new Date(year, month - 1, day + delta, 12);
}

function dateKey(date) {
  const y = date.getFullYear(), m = String(date.getMonth()+1).padStart(2,'0'), d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function prettyDate(key) {
  const d = new Date(`${key}T12:00:00`);
  return new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'long', weekday:'long' }).format(d);
}
function escapeHtml(v='') { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function notice(msg, kind='info') {
  const el = $('#notice'); el.textContent = msg; el.className = `notice ${kind}`; el.hidden = false;
  window.setTimeout(() => { el.hidden = true; }, 6000);
}
function statusFor(p) {
  if (p.paid) return ['Оплачено','paid'];
  if (p.claimed) return ['Ожидает проверки','pending'];
  return ['Не оплачено','unpaid'];
}
function renderPlayers() {
  const list = $('#players');
  $('#player-count').textContent = `${state.players.length} ${state.players.length === 1 ? 'участник' : state.players.length > 1 && state.players.length < 5 ? 'участника' : 'участников'}`;
  if (!state.players.length) {
    list.innerHTML = '<div class="empty"><span class="empty-ball">⚽</span><strong>Пока никто не записался</strong><span>Будь первым — добавь своё имя выше.</span></div>';
    return;
  }
  list.innerHTML = state.players.map((p, i) => {
    const [label, cls] = statusFor(p);
    const own = localStorage.getItem(`football-player-${state.event?.id}`) === p.id;
    return `<article class="player">
      <div class="avatar">${escapeHtml((p.name || '?').trim().charAt(0).toLocaleUpperCase('ru-RU'))}</div>
      <div class="player-main"><div class="player-name">${escapeHtml(p.name)}</div><div class="player-sub">Игрок №${i+1}</div></div>
      <span class="status ${cls}">${label}</span>
      ${!p.paid && !p.claimed && own ? `<button class="small-action" data-claim="${p.id}" aria-label="Сообщить об оплате">Я оплатил</button>` : ''}

    </article>`;
  }).join('');
  list.querySelectorAll('[data-claim]').forEach(b => b.addEventListener('click', () => claimPayment(b.dataset.claim)));
}
function renderAdmin() {
  const section = $('#admin-content');
  if (!state.admin) {
    section.innerHTML = `<form id="admin-login" class="admin-login">
      <label for="admin-email">Email организатора</label><input id="admin-email" type="email" autocomplete="username" required placeholder="you@example.com">
      <label for="admin-password">Пароль</label><input id="admin-password" type="password" autocomplete="current-password" required placeholder="Пароль Supabase Auth">
      <button class="btn btn-dark" type="submit">Войти в админ-панель</button>
      <p class="muted tiny">Сначала создай пользователя в Supabase Authentication, затем добавь его email в таблицу admins по инструкции в README.</p>
    </form>`;
    $('#admin-login').addEventListener('submit', adminLogin);
    return;
  }
  const pending = state.players.filter(p => p.claimed && !p.paid);
  section.innerHTML = `<div class="admin-top"><span class="admin-tag">Вы вошли как организатор</span><button id="admin-logout" class="link-btn">Выйти</button></div>
    <div class="admin-stats"><div><span>Участников</span><strong>${state.players.length}</strong></div><div><span>На проверке</span><strong>${pending.length}</strong></div><div><span>Оплачено</span><strong>${state.players.filter(p=>p.paid).length}</strong></div></div>
    <div class="admin-list">${state.players.length ? state.players.map(p => `<div class="admin-row"><div><strong>${escapeHtml(p.name)}</strong><span class="muted tiny">${statusFor(p)[0]}</span></div><div class="admin-actions">${!p.paid ? `<button class="small-action" data-approve="${p.id}">Подтвердить</button>` : ''}${p.paid ? `<button class="small-action neutral" data-unpay="${p.id}">Снять оплату</button>` : ''}<button class="small-action danger" data-delete="${p.id}">Удалить</button></div></div>`).join('') : '<p class="muted">Записей пока нет.</p>'}</div>`;
    section.insertAdjacentHTML('beforeend', `
    <div class="history-section">
      <button id="history-btn" class="btn btn-dark" type="button">
        📅 История предыдущих игр
      </button>
      <div id="history-content"></div>
    </div>
  `);

  $('#history-btn').addEventListener('click', loadGameHistory);
  $('#admin-logout').addEventListener('click', async () => { await supabase.auth.signOut(); state.admin=false; state.session=null; renderAdmin(); });
  section.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => setPaid(b.dataset.approve, true)));
  section.querySelectorAll('[data-unpay]').forEach(b => b.addEventListener('click', () => setPaid(b.dataset.unpay, false)));
  section.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => deletePlayer(b.dataset.delete)));
}
async function loadGameHistory() {
  const container = $('#history-content');
  if (!state.admin || !container) return;

  container.innerHTML = '<p class="muted">Загружаем историю...</p>';

  try {
    const { data: games, error } = await supabase
      .from('football_events')
      .select('id,event_date,price_rub')
      .lt('event_date', state.event.event_date)
      .order('event_date', { ascending: false })
      .limit(30);

    if (error) throw error;

    if (!games?.length) {
      container.innerHTML =
        '<p class="muted">Предыдущих игр пока нет.</p>';
      return;
    }

    const ids = games.map(g => g.id);

    const { data: players, error: playersError } = await supabase
      .from('football_participants')
      .select('id,event_id,name,paid_at')
      .in('event_id', ids);

    if (playersError) throw playersError;

    container.innerHTML = games.map(game => {
      const participants = (players || [])
        .filter(p => p.event_id === game.id);

      const paid = participants.filter(p => !!p.paid_at);
      const price = Number(game.price_rub ?? PRICE_RUB);

      return `
        <details class="history-game">
          <summary>
            <strong>⚽ ${escapeHtml(prettyDate(game.event_date))}</strong>
            <span>${participants.length} игроков</span>
          </summary>

          <div class="history-total">
            Собрано: <strong>${(paid.length * price).toLocaleString('ru-RU')} ₽</strong>
          </div>

          <p class="muted tiny">
            Оплачено: ${paid.length} из ${participants.length}
          </p>

          ${participants.length
            ? participants.map(p => `
              <div class="history-player">
                <span>${escapeHtml(p.name)}</span>
                <span class="${p.paid_at ? 'history-paid' : 'history-unpaid'}">
                  ${p.paid_at ? '✓ Оплачено' : 'Не оплачено'}
                </span>
              </div>
            `).join('')
            : '<p class="muted">Участников нет.</p>'
          }
        </details>
      `;
    }).join('');

  } catch (e) {
    container.textContent =
      'Не удалось загрузить историю: ' + (e.message || e);
  }
}
async function ensureEvent() {
  const key = dateKey(upcomingSaturday());
  let { data, error } = await supabase.from('football_events').select('*').eq('event_date', key).maybeSingle();
  if (error) throw error;
  if (!data) {
    const inserted = await supabase.from('football_events').insert({ event_date:key, start_time:'20:00', end_time:'22:00', price_rub:PRICE_RUB }).select().single();
    if (inserted.error) {
      // Another visitor may have created the event at the same time; fetch it again.
      const retry = await supabase.from('football_events').select('*').eq('event_date',key).single();
      if (retry.error) throw inserted.error;
      data = retry.data;
    } else data = inserted.data;
  }
  state.event = data;
  $('#event-date').textContent = prettyDate(data.event_date);
}
async function refreshPlayers() {
  if (!supabase || !state.event) return;
  const { data, error } = await supabase.from('football_participants').select('id,name,created_at,paid_at').eq('event_id', state.event.id).order('created_at', {ascending:true});
  if (error) throw error;
  const ids = (data || []).map(p => p.id);
  let claims = [];
  if (ids.length) {
    const result = await supabase.from('payment_claims').select('participant_id,status').in('participant_id', ids);
    if (result.error) throw result.error;
    claims = result.data || [];
  }
  const claimMap = new Map(claims.map(c => [c.participant_id, c.status]));
  state.players = (data || []).map(p => ({...p, paid: !!p.paid_at, claimed: claimMap.get(p.id) === 'pending' || claimMap.get(p.id) === 'approved'}));
  renderPlayers();
  if (state.admin) await loadAdminData();
}
async function loadAdminData() {
  const { data, error } = await supabase.from('football_participants').select('id,name,created_at,paid_at').eq('event_id',state.event.id).order('created_at',{ascending:true});
  if (error) throw error;
  const ids = (data||[]).map(p=>p.id);
  let claims=[];
  if(ids.length){const r=await supabase.from('payment_claims').select('participant_id,status').in('participant_id',ids);if(r.error)throw r.error;claims=r.data||[];}
  const cm=new Map(claims.map(c=>[c.participant_id,c.status]));
  state.players=(data||[]).map(p=>({...p,paid:!!p.paid_at,claimed:cm.get(p.id)==='pending'||cm.get(p.id)==='approved'}));
  renderPlayers(); renderAdmin();
}
async function signup(e) {
  e.preventDefault();
  if (!supabase || state.busy) return;
  const name = $('#name').value.trim().replace(/\s+/g,' ');
  if (!name) return;
  state.busy=true; $('#signup-btn').disabled=true;
  try {
    const duplicate = state.players.some(p => p.name.toLocaleLowerCase('ru-RU') === name.toLocaleLowerCase('ru-RU'));
    if (duplicate) { notice('Это имя уже есть в списке. Если это ты, повторно записываться не нужно.','warn'); return; }
    const { data, error } = await supabase.from('football_participants').insert({event_id:state.event.id,name}).select('id').single();
    if (error) throw error;
    localStorage.setItem(`football-player-${state.event.id}`,data.id);
    $('#name').value='';
    notice('Готово! Ты в списке игроков.','success');
    await refreshPlayers();
  } catch(err) { notice(err.message || 'Не удалось записаться. Попробуй ещё раз.','error'); }
  finally { state.busy=false; $('#signup-btn').disabled=false; }
}
async function claimPayment(id) {
  try {
    const {error}=await supabase.from('payment_claims').insert({participant_id:id});
    if(error) throw error;
    notice('Отметили заявку. Организатор проверит перевод и подтвердит оплату.','success');
    await refreshPlayers();
  } catch(e) { notice(e.message || 'Не удалось отправить заявку на проверку.','error'); }
}
async function cancelSignup(id) {
  if(!confirm('Отменить свою запись на эту игру?')) return;
  try {
    const {error}=await supabase.from('football_participants').delete().eq('id',id);
    if(error) throw error;
    localStorage.removeItem(`football-player-${state.event.id}`);
    notice('Запись отменена.','success'); await refreshPlayers();
  } catch(e) { notice(e.message || 'Не удалось отменить запись.','error'); }
}
async function adminLogin(e) {
  e.preventDefault();
  const {error}=await supabase.auth.signInWithPassword({email:$('#admin-email').value.trim(),password:$('#admin-password').value});
  if(error){notice('Не удалось войти. Проверь email и пароль.','error');return;}
  await checkAdmin();
}
async function checkAdmin() {
  const {data:{session}}=await supabase.auth.getSession(); state.session=session;
  if(!session){state.admin=false;renderAdmin();return;}
  const {data,error}=await supabase.from('admins').select('user_id').eq('user_id',session.user.id).maybeSingle();
  state.admin=!!data && !error;
  renderAdmin();
  if(!state.admin) notice('Пользователь вошёл, но не добавлен в таблицу admins. Следуй инструкции README.','warn');
  if(state.admin) await loadAdminData();
}
async function setPaid(id, paid) {
  try {
    const {error}=await supabase.from('football_participants').update({paid_at:paid?new Date().toISOString():null}).eq('id',id);
    if(error) throw error;
    if(paid) {
      const {error:ce}=await supabase.from('payment_claims').update({status:'approved',reviewed_at:new Date().toISOString()}).eq('participant_id',id);
      if(ce) throw ce;
    }
    notice(paid?'Оплата подтверждена.':'Статус оплаты снят.','success'); await refreshPlayers();
  } catch(e){notice(e.message || 'Не удалось изменить оплату.','error');}
}
async function deletePlayer(id) {
  if(!confirm('Удалить участника из списка?'))return;
  try{const {error}=await supabase.from('football_participants').delete().eq('id',id);if(error)throw error;notice('Участник удалён.','success');await refreshPlayers();}
  catch(e){notice(e.message||'Не удалось удалить участника.','error');}
}
function renderConfig() {
  $('#price').textContent = `${PRICE_RUB} ₽`;
  $('#bank-name').textContent = PAYMENT_BANK_LABEL;
  const pay = $('#payment-area');
  if(PAYMENT_QR_IMAGE_URL) pay.innerHTML = `<img class="qr" src="${escapeHtml(PAYMENT_QR_IMAGE_URL)}" alt="QR-код для оплаты по СБП"><p class="muted tiny">После перевода нажми «Я оплатил» рядом со своим именем.</p>`;
  else if(PAYMENT_URL) pay.innerHTML = `<a class="btn btn-bright full" href="${escapeHtml(PAYMENT_URL)}" target="_blank" rel="noopener noreferrer">Перейти к оплате по СБП ↗</a><p class="muted tiny">После перевода вернись на сайт и нажми «Я оплатил» рядом со своим именем.</p>`;
  else pay.innerHTML = `<div class="payment-placeholder"><span>▦</span><strong>Добавим QR-код СБП</strong><p>Нужна официальная ссылка или изображение QR-кода для получения переводов на ОЗОН Банк.</p></div>`;
  if(WHATSAPP_URL) { $('#whatsapp-link').href=WHATSAPP_URL; $('#whatsapp-link').classList.remove('disabled'); $('#whatsapp-link').target='_blank'; $('#whatsapp-link').rel='noopener noreferrer'; }
  else { $('#whatsapp-link').href='#'; $('#whatsapp-link').classList.add('disabled'); $('#whatsapp-link').addEventListener('click',e=>{e.preventDefault();notice('Добавь ссылку на группу WhatsApp в src/config.js.','warn');}); }
}
function showSetup() {
  $('#setup-warning').hidden = configured;
  if(!configured) {
    $('#signup-btn').disabled=true;
    $('#players').innerHTML='<div class="empty"><span class="empty-ball">⚙️</span><strong>Нужно подключить базу данных</strong><span>Открой README.md в архиве и выполни шаги настройки Supabase.</span></div>';
    $('#player-count').textContent='Настройка';
    $('#admin-content').innerHTML='<p class="muted">Админ-панель заработает после настройки Supabase и создания аккаунта организатора.</p>';
  }
}
async function init() {
  renderConfig(); showSetup();
  if(!supabase)return;
  try {
    await ensureEvent(); await refreshPlayers(); await checkAdmin();
    supabase.channel('football-live').on('postgres_changes',{event:'*',schema:'public',table:'football_participants'},()=>refreshPlayers().catch(()=>{})).on('postgres_changes',{event:'*',schema:'public',table:'payment_claims'},()=>refreshPlayers().catch(()=>{})).subscribe();
  } catch(e){notice(`Ошибка подключения к базе: ${e.message || e}`,'error');}
}
$('#signup').addEventListener('submit',signup);
$('#admin-refresh').addEventListener('click',()=>refreshPlayers().catch(e=>notice(e.message,'error')));
init();
