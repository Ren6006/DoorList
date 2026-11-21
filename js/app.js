const KEY = 'doorlist.v1';
const TIP = 'doorlist.tip';

const NAMES = new Set([
  'home', 'event', 'profile', 'activity', 'events', 'search',
  'guests', 'ticket', 'invite', 'create', 'people', 'person', 'code'
]);

let canStore = true;
try {
  localStorage.setItem(KEY + ':t', '1');
  localStorage.removeItem(KEY + ':t');
} catch (err) {
  canStore = false;
}

let state = load();
let edit = false;
let menu = null;
let editor = null;
let activityTab = 'friends';
let eventsTab = 'upcoming';
let guestTab = 'going';
let viewQuery = '';
let eventQuery = '';
let pendingPath = null;
let inviteBanner = false;
let ticketFace = false;
let bannerTimer = null;
let toastTimer = null;
let qrTimer = null;
let lastQrSecond = null;
let holdTimer = null;
let holdTriggered = false;
let draft = blankDraft();

const app = document.getElementById('app');
const picker = document.getElementById('picker');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

function route() {
  const parts = location.hash.replace(/^#/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const name = NAMES.has(parts[0]) ? parts[0] : 'home';
  return { name, id: parts[1] || null };
}

function go(name, id) {
  menu = null;
  editor = null;
  if (name === 'invite') {
    inviteBanner = true;
    ticketFace = false;
  }
  if (name === 'ticket') ticketFace = true;
  const next = '#' + [name, id].filter((part) => part != null && part !== '').map(encodeURIComponent).join('/');
  if ((location.hash || '#home') === next || (next === '#home' && !location.hash)) {
    if (next === '#home' && !location.hash) render();
    else if (location.hash === next) render();
    else location.hash = next;
  } else {
    location.hash = next;
  }
}

function back() {
  if (location.hash && location.hash !== '#home') history.back();
  else go('home');
}

function load() {
  if (!canStore) return seed();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seed();
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !data.events || !data.people) return seed();
    return data;
  } catch (err) {
    return seed();
  }
}

function persist() {
  if (!canStore) return 'memory';
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return 'ok';
  } catch (err) {
    return 'quota';
  }
}

function getPath(path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), state);
}

function setPath(path, value) {
  const keys = path.split('.');
  let node = state;
  for (let i = 0; i < keys.length - 1; i++) {
    if (node[keys[i]] == null) return false;
    node = node[keys[i]];
  }
  const last = keys[keys.length - 1];
  const prev = node[last];
  node[last] = value;
  const result = persist();
  if (result === 'quota') {
    node[last] = prev;
    showToast('Not enough room to save that on this phone.');
    return false;
  }
  return true;
}

function blankDraft() {
  return {
    title: '',
    host: '',
    when: '',
    listDate: '',
    location: '',
    song: '',
    about: '',
    flyer: ''
  };
}

function showToast(text) {
  const el = document.getElementById('toast');
  el.hidden = false;
  el.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function person(id) {
  return state.people[id] || { id, name: 'Guest', avatar: '', color: '#444', mutual: '' };
}

function eventById(id) {
  return id ? state.events[id] : null;
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
}

function counts(event) {
  const guests = event.guests || [];
  return {
    going: guests.filter((guest) => guest.status === 'going').length,
    maybe: guests.filter((guest) => guest.status === 'maybe').length,
    invited: guests.filter((guest) => guest.status === 'invited').length
  };
}

function partition() {
  const upcoming = [];
  const previous = [];
  state.eventOrder.forEach((id) => {
    const event = state.events[id];
    if (!event || event.listed === false) return;
    (event.upcoming ? upcoming : previous).push(event);
  });
  return { upcoming, previous };
}

function cssUrl(url) {
  return url ? `url('${url}')` : 'none';
}

function field(path, value, label) {
  const empty = value == null || String(value).trim() === '';
  const shown = empty ? (edit ? 'Add' : '') : value;
  return `<span class="field${edit ? ' is-edit' : ''}${empty ? ' empty' : ''}" data-field="${esc(path)}" data-label="${esc(label || 'Edit')}">${esc(shown)}</span>`;
}

function avatarHTML(p, size, path) {
  const photo = path || `people.${p.id}.avatar`;
  const inner = p.avatar
    ? `<img src="${p.avatar}" alt="" draggable="false">`
    : esc(initials(p.name));
  return `<div class="avatar${edit ? ' is-edit' : ''}" data-photo="${esc(photo)}" style="width:${size}px;height:${size}px;background:${esc(p.color || '#333')};font-size:${Math.max(10, Math.round(size * 0.34))}px">${inner}</div>`;
}

function orgHTML(event, size) {
  const path = `events.${event.id}.hostAvatar`;
  const inner = event.hostAvatar
    ? `<img src="${event.hostAvatar}" alt="" draggable="false">`
    : esc(initials(event.host));
  return `<div class="avatar${edit ? ' is-edit' : ''}" data-photo="${path}" style="width:${size}px;height:${size}px;background:${esc(event.hostColor || '#333')};font-size:${Math.max(9, Math.round(size * 0.36))}px">${inner}</div>`;
}

function activityText(item) {
  const name = person(item.personId).name;
  if (item.kind === 'vouch') return `${name} wants a vouch`;
  if (item.kind === 'going') return `${name} is going`;
  if (item.kind === 'joined') return `${name} joined the list`;
  if (item.kind === 'saved') return 'You saved this event';
  if (item.kind === 'rsvp') return `You RSVP'd ${item.status || 'going'}`;
  if (item.kind === 'vouched') return `You vouched for ${name}`;
  return item.text || name;
}

function vouchCopy(event) {
  const name = person(event.vouchPersonId).name;
  if (event.didVouch) return `You vouched for ${name}`;
  if (event.vouchWide) return `Help ${name} and other friends get on the list!`;
  return `Help ${name} get on the list!`;
}

function ico(paths, size = 22) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const icons = {
  search: (s = 22) => ico('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>', s),
  back: (s = 22) => ico('<path d="M15 5l-7 7 7 7"/>', s),
  close: (s = 20) => ico('<path d="M6 6l12 12M18 6L6 18"/>', s),
  more: (s = 20) => ico('<circle cx="6" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="18" cy="12" r="1" fill="currentColor"/>', s),
  plus: (s = 28) => ico('<path d="M12 5v14M5 12h14"/>', s),
  share: (s = 26) => ico('<path d="M12 16V5"/><path d="M8 8l4-4 4 4"/><path d="M5 14v5h14v-5"/>', s),
  bell: (on, s = 26) => on
    ? `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a5 5 0 0 0-5 5v2.2c0 .7-.2 1.4-.7 2L4.6 14a1 1 0 0 0 .8 1.6h13.2a1 1 0 0 0 .8-1.6l-1.7-1.8c-.5-.6-.7-1.3-.7-2V8a5 5 0 0 0-5-5zm0 18a2.4 2.4 0 0 0 2.3-1.8H9.7A2.4 2.4 0 0 0 12 21z"/></svg>`
    : ico('<path d="M6 9a6 6 0 1 1 12 0c0 7 2 7 2 7H4s2 0 2-7"/><path d="M10 19a2 2 0 0 0 4 0"/>', s),
  home: (on, s = 26) => on
    ? `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z"/></svg>`
    : ico('<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z"/>', s),
  person: (on, s = 26) => on
    ? `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="3.2"/><path d="M5 19.2c1.2-3 3.6-4.5 7-4.5s5.8 1.5 7 4.5"/></svg>`
    : ico('<circle cx="12" cy="8" r="3.2"/><path d="M5 19.2c1.2-3 3.6-4.5 7-4.5s5.8 1.5 7 4.5"/>', s),
  qr: (s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.4"/><rect x="13" y="3" width="8" height="8" rx="1.4"/><rect x="3" y="13" width="8" height="8" rx="1.4"/><rect x="13" y="13" width="3.2" height="3.2" rx=".5"/><rect x="17.8" y="13" width="3.2" height="3.2" rx=".5"/><rect x="13" y="17.8" width="3.2" height="3.2" rx=".5"/><rect x="17.8" y="17.8" width="3.2" height="3.2" rx=".5"/></svg>`,
  refresh: (s = 18) => ico('<path d="M21 12a9 9 0 0 1-15.2 6.5L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.2-6.5L21 8"/><path d="M21 3v5h-5"/>', s),
  flame: (s = 24) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2s1.6 3.2.6 5.2C11.8 8.6 10 9.2 10 11c0 .8.4 1.4.4 1.4S9 11.8 9 10.2C7.2 11.6 6 13.6 6 16a6 6 0 0 0 12 0c0-4.8-6-8.2-6-14z"/></svg>`,
  pin: (s = 16) => ico('<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/>', s),
  clock: (s = 16) => ico('<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>', s),
  cal: (s = 20) => ico('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>', s),
  warn: (s = 20) => ico('<path d="M12 4l8 15H4L12 4z"/><path d="M12 10v4M12 16.5v.5"/>', s),
  crown: (s = 20) => ico('<path d="M4 17l2-9 6 5 6-5 2 9H4z"/><path d="M5 20h14"/>', s),
  plusSmall: (s = 20) => ico('<path d="M12 5v14M5 12h14"/>', s),
  chev: (s = 16) => ico('<path d="M9 6l6 6-6 6"/>', s),
  chat: (s = 22) => ico('<path d="M6 16l-2 4 5-2h7a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v4a4 4 0 0 0 2 4z"/>', s),
  menu: (s = 22) => ico('<path d="M5 7h14M5 12h14M5 17h14"/>', s),
  mute: (s = 16) => ico('<path d="M4 10h3l4-3v10l-4-3H4z"/><path d="M16 10l4 4M20 10l-4 4"/>', s),
  check: (s = 16) => ico('<path d="M5 12l4 4 10-10"/>', s)
};

function dateBadge(event) {
  return `<div class="date-badge"><b>${field(`events.${event.id}.day`, event.day, 'Day')}</b><span class="dow">${field(`events.${event.id}.dow`, event.dow, 'Weekday')}</span></div>`;
}

function render() {
  const prev = document.querySelector('.screen');
  if (prev && prev.dataset.key) scrollMem[prev.dataset.key] = prev.scrollTop;
  const r = route();
  const key = [r.name, r.id || '', activityTab, eventsTab, guestTab].join(':');
  const pad = padClass(r);
  app.innerHTML = `
    ${r.name === 'event' ? eventBackdrop(r.id) : ''}
    <section class="screen ${pad}${r.name === 'event' ? ' clear' : ''}${r.name === 'invite' || r.name === 'ticket' || r.name === 'code' ? ' invite-screen' : ''}" data-key="${esc(key)}">
      ${viewHTML(r)}
    </section>
    ${tabHTML(r)}
    ${actionHTML(r)}
    ${edit ? editBar(r) : ''}
    ${menuHTML()}
    ${editorHTML()}
  `;
  const sc = document.querySelector('.screen');
  if (sc && scrollMem[key] != null) sc.scrollTop = scrollMem[key];
  afterRender(r);
}

const scrollMem = {};

function padClass(r) {
  const base = ['home', 'profile', 'activity'].includes(r.name)
    ? 'pad-tab'
    : (r.name === 'event' ? 'pad-action' : 'pad-plain');
  return edit ? `${base} pad-edit` : base;
}

function eventBackdrop(id) {
  const event = eventById(id);
  if (!event) return '';
  return `<div class="event-bg" style="background-image:${cssUrl(event.flyer)}"></div>`;
}

function viewHTML(r) {
  if (r.name === 'home') return homeHTML();
  if (r.name === 'event') return eventHTML(r.id);
  if (r.name === 'profile') return profileHTML();
  if (r.name === 'activity') return activityHTML();
  if (r.name === 'events') return eventsHTML();
  if (r.name === 'search') return searchHTML();
  if (r.name === 'guests') return guestsHTML(r.id);
  if (r.name === 'ticket' || r.name === 'invite') return inviteHTML(r.id);
  if (r.name === 'code') return ticketHTML('me', false);
  if (r.name === 'create') return createHTML();
  if (r.name === 'people') return peopleHTML();
  if (r.name === 'person') return personHTML(r.id);
  return homeHTML();
}

function homeHTML() {
  const featured = eventById(state.featuredId);
  const heroClass = state.homeBackground ? ' has-bg' : '';
  const heroStyle = state.homeBackground ? ` style="--photo:${cssUrl(state.homeBackground)}"` : '';
  return `
    <header class="home-hero${heroClass}"${heroStyle}>
      <div class="toprow">
        <div class="logo">doorlist</div>
        <div class="top-actions">
          <button class="edit-link${edit ? ' on' : ''}" data-action="toggle-edit">${edit ? 'Done' : 'Edit'}</button>
          <button class="iconbtn" data-action="go" data-name="search" aria-label="Search">${icons.search(24)}</button>
        </div>
      </div>
      ${edit ? `<button class="bg-edit" type="button" data-photo="homeBackground">Change header background</button>${state.homeBackground ? '<button class="linkish" data-action="clear-home-bg" type="button">Remove background</button>' : ''}` : ''}
      <div class="kicker">Coming up!</div>
      ${featured ? featureCard(featured) : ''}
    </header>
    <div class="section-head">
      <button class="section-title" data-action="go" data-name="events">Your events ${icons.chev(18)}</button>
    </div>
    <div class="hscroll">
      ${state.yourEventIds.map((id) => miniCard(eventById(id))).join('')}
    </div>
    ${state.suggestedIds.length ? `
      <div class="section-head">
        <div class="section-title">Suggested friends</div>
        <button class="linkish" data-action="go" data-name="people">Add Friends ${icons.chev(16)}</button>
      </div>
      <div class="hscroll people-row">
        ${state.suggestedIds.map((id) => personChip(id)).join('')}
      </div>` : ''}
  `;
}

function featureCard(event) {
  const faces = (event.faceIds || []).map((id) => avatarHTML(person(id), 32)).join('');
  return `
    <div class="feature${edit ? ' is-edit' : ''}" data-action="go" data-name="event" data-id="${esc(event.id)}" role="link" tabindex="0" style="background-image:${cssUrl(event.flyer)}">
      <div class="photo-hit" data-photo="events.${esc(event.id)}.flyer"></div>
      ${dateBadge(event)}
      <div class="shade"></div>
      <div class="feature-meta">
        <div class="feature-copy">
          <div class="hostline">${orgHTML(event, 18)} ${field(`events.${event.id}.host`, event.host, 'Host')}</div>
          <div class="pile">${faces}</div>
          <h2>${field(`events.${event.id}.title`, event.title, 'Title')}</h2>
          <div class="sub">${field(`events.${event.id}.whenShort`, event.whenShort, 'Time')}</div>
        </div>
      </div>
    </div>
  `;
}

function miniCard(event) {
  if (!event) return '';
  const who = event.hostLabel || event.host;
  return `
    <div class="mini" data-action="go" data-name="event" data-id="${esc(event.id)}" role="link" tabindex="0">
      <div class="thumb${edit ? ' is-edit' : ''}" style="background-image:${cssUrl(event.flyer)}">
        <div class="photo-hit" data-photo="events.${esc(event.id)}.flyer"></div>
        ${dateBadge(event)}
        ${event.startHosting ? `<button class="host-btn" type="button" data-action="start-host" data-id="${esc(event.id)}">${event.hostingLive ? 'Hosting' : 'Start Hosting'}</button>` : ''}
      </div>
      <div class="who">${event.hostLabel ? field(`events.${event.id}.hostLabel`, who, 'Label') : `${orgHTML(event, 16)} ${field(`events.${event.id}.host`, event.host, 'Host')}`}</div>
      <div class="cap">${field(`events.${event.id}.title`, event.title, 'Title')}</div>
    </div>
  `;
}

function personChip(id) {
  const p = person(id);
  const added = state.friendIds.includes(id);
  return `
    <div class="person" data-action="go" data-name="person" data-id="${esc(id)}" role="link" tabindex="0">
      <div class="avatar-wrap">
        ${avatarHTML(p, 72)}
        ${added
          ? '<span class="add-badge done">✓</span>'
          : `<button class="add-badge" type="button" data-action="add-friend" data-id="${esc(id)}" aria-label="Add ${esc(p.name)}">+</button>`}
      </div>
      <div class="pname">${field(`people.${id}.name`, p.name, 'Name')}</div>
      ${p.mutual !== '' && p.mutual != null ? `<div class="mutual">${field(`people.${id}.mutual`, p.mutual, 'Mutuals')} mutual</div>` : ''}
    </div>
  `;
}

function eventHTML(id) {
  const event = eventById(id);
  if (!event) return missing('That event is gone.');
  const c = counts(event);
  const song = (event.song || edit)
    ? `<div class="song"><div class="song-art" style="background-image:${cssUrl(event.flyer)}"></div>${field(`events.${event.id}.song`, event.song, 'Song')}<span class="mute">${icons.mute()}</span></div>`
    : '<div></div>';
  return `
    <div class="event-top">
      <button class="iconbtn frost" type="button" data-action="back" aria-label="Back">${icons.back()}</button>
      ${song}
      <button class="iconbtn frost" type="button" data-action="menu" data-menu="event" data-id="${esc(event.id)}" aria-label="More">${icons.more()}</button>
    </div>
    <h1 class="event-title">${field(`events.${event.id}.title`, event.title, 'Title')}</h1>
    <div class="flyer${edit ? ' is-edit' : ''}" style="background-image:${cssUrl(event.flyer)}">
      <div class="photo-hit" data-photo="events.${esc(event.id)}.flyer"></div>
    </div>
    ${event.vouchPersonId ? `
      <div class="vouch">
        ${avatarHTML(person(event.vouchPersonId), 36)}
        <p>${esc(vouchCopy(event))}</p>
        <button class="go${event.didVouch ? ' done' : ''}" type="button" data-action="vouch" data-id="${esc(event.id)}">${event.didVouch ? 'Vouched' : 'Vouch'}</button>
      </div>` : ''}
    ${event.showGuestList ? `
      <button class="guestcard" type="button" data-action="go" data-name="guests" data-id="${esc(event.id)}">
        <div class="pile">${(event.guests || []).slice(0, 3).map((guest) => avatarHTML(person(guest.personId), 28)).join('')}</div>
        <div class="grow"><b>Guest List</b><span>${c.going} going | ${c.maybe} maybe</span></div>
        <span class="see">See All ${icons.chev(14)}</span>
      </button>` : ''}
    ${event.conflict ? `<button class="info" type="button" data-action="conflict-info"><div class="info-ico">${icons.warn()}</div><div class="info-v">Event conflict</div></button>` : ''}
    ${event.invitedBy ? `<div class="info"><div class="info-ico">${avatarHTML(person(event.invitedBy), 28)}</div><div><div class="info-k">Invited by</div><div class="info-v">${field(`people.${event.invitedBy}.name`, person(event.invitedBy).name, 'Name')}</div></div></div>` : ''}
    <div class="info"><div class="info-ico">${orgHTML(event, 28)}</div><div><div class="info-k">Hosted by</div><div class="info-v">${field(`events.${event.id}.host`, event.host, 'Host')}</div></div></div>
    <button class="info" type="button" data-action="request-cohost"><div class="info-ico">${icons.plusSmall()}</div><div class="info-v">Request co-host</div></button>
    <div class="info"><div class="info-ico">${icons.cal()}</div><div><div class="info-k">Date</div><div class="info-v">${field(`events.${event.id}.when`, event.when, 'Date')}</div></div></div>
    ${(event.location || edit) ? `<div class="info"><div class="info-ico">${icons.pin(20)}</div><div><div class="info-k">Location</div><div class="info-v">${field(`events.${event.id}.location`, event.location, 'Location')}</div></div></div>` : ''}
    ${(event.about || edit) ? `<div class="info"><div class="info-ico">${icons.more()}</div><div style="flex:1"><div class="info-k">About</div><div class="info-v about">${field(`events.${event.id}.about`, event.about, 'About')}</div></div></div>` : ''}
  `;
}

function actionHTML(r) {
  if (r.name !== 'event') return '';
  const event = eventById(r.id);
  if (!event) return '';
  const flameClass = event.myRsvp === 'going' ? 'going' : (event.myRsvp === 'maybe' ? 'maybe' : '');
  return `
    <div class="actionbar">
      <button class="action" type="button" data-action="rsvp" data-id="${esc(event.id)}">
        <span class="bubble flame ${flameClass}">${icons.flame(26)}</span>RSVP
      </button>
      <button class="action share" type="button" data-action="go" data-name="invite" data-id="${esc(event.id)}">
        <span class="bubble">${icons.share(30)}</span>Share
      </button>
      <button class="action" type="button" data-action="go" data-name="ticket" data-id="${esc(event.id)}">
        <span class="bubble">${icons.qr(22)}</span>Tickets
      </button>
    </div>
  `;
}

function profileHTML() {
  const me = person('me');
  return `
    <header class="profile-hero">
      <div class="profile-tools">
        <button class="iconbtn" type="button" data-action="go" data-name="code" aria-label="Your code">${icons.qr(22)}</button>
        <div class="tool-right">
          <button class="iconbtn" type="button" data-action="chat" aria-label="Messages">${icons.chat()}</button>
          <button class="iconbtn" type="button" data-action="menu" data-menu="profile" aria-label="More">${icons.menu()}</button>
        </div>
      </div>
      <div style="display:flex;justify-content:center;margin-top:8px">${avatarHTML(me, 108)}</div>
      <h1>${field('people.me.name', me.name, 'Your name')}</h1>
      <div class="p-actions">
        <button class="pill blue" type="button" data-action="go" data-name="people">Add Friends</button>
        <button class="pill dark" type="button" data-action="go" data-name="events">Calendar</button>
        <button class="squircle" type="button" data-action="share-profile" aria-label="Share profile">${icons.share(18)}</button>
      </div>
      <div class="stats">
        <button class="on" type="button" data-action="go" data-name="people"><b>${state.friendIds.length}</b> Friends</button>
        <div class="stat"><b>0</b> Groups</div>
        <button type="button" data-action="go" data-name="events"><b>${state.eventOrder.length}</b> Events</button>
      </div>
    </header>
    <div class="block-label">Friends</div>
    ${state.friendIds.map((id) => {
      const p = person(id);
      return `<div class="cell" data-action="go" data-name="person" data-id="${esc(id)}" role="link" tabindex="0">
        ${avatarHTML(p, 48)}
        <div class="grow"><b>${field(`people.${id}.name`, p.name, 'Name')}</b><span class="meta">${p.mutual ? `${esc(p.mutual)} mutual` : 'Friend'}</span></div>
        ${icons.chev()}
      </div>`;
    }).join('')}
  `;
}

function activityHTML() {
  const items = state.activity[activityTab] || [];
  return `
    <header class="activity-hero">
      <div class="top">
        <h1>Activity</h1>
        <button class="iconbtn frost" type="button" data-action="go" data-name="people" aria-label="Add friends">${icons.person(false, 22)}</button>
      </div>
      <div class="segment">
        <button type="button" class="${activityTab === 'friends' ? 'on' : ''}" data-action="activity-tab" data-tab="friends">Friends</button>
        <button type="button" class="${activityTab === 'you' ? 'on' : ''}" data-action="activity-tab" data-tab="you">You</button>
      </div>
    </header>
    ${items.length ? items.map((item) => {
      const event = eventById(item.eventId);
      const actor = (item.kind === 'saved' || item.kind === 'rsvp') ? person('me') : person(item.personId);
      return `<div class="cell" data-action="go" data-name="event" data-id="${esc(item.eventId)}" role="link" tabindex="0">
        ${avatarHTML(actor, 46)}
        <div class="grow"><b>${esc(activityText(item))}</b><span class="meta">${esc(event ? event.title : 'Event')} · ${esc(item.time)}</span></div>
        <div class="thumb-sm" style="background-image:${cssUrl(event && event.flyer)}"></div>
      </div>`;
    }).join('') : '<div class="empty">Nothing here yet.</div>'}
  `;
}

function eventsHTML() {
  const parts = partition();
  const list = eventsTab === 'upcoming' ? parts.upcoming : parts.previous;
  let lastDay = '';
  const rows = list.map((event) => {
    const head = event.listDate !== lastDay ? `<div class="day">${field(`events.${event.id}.listDate`, event.listDate, 'Date heading')}</div>` : '';
    lastDay = event.listDate;
    return `${head}
      <div class="cell" data-action="go" data-name="event" data-id="${esc(event.id)}" role="link" tabindex="0">
        <div class="thumb-sm" style="background-image:${cssUrl(event.flyer)}"></div>
        <div class="grow">
          <span class="meta">${field(`events.${event.id}.host`, event.host, 'Host')}</span>
          <b>${field(`events.${event.id}.title`, event.title, 'Title')}</b>
          <span class="meta loc">${icons.clock()} ${field(`events.${event.id}.listWhen`, event.listWhen, 'List time')}</span>
          ${event.location ? `<span class="meta loc">${icons.pin()} ${field(`events.${event.id}.location`, event.location, 'Location')}</span>` : ''}
        </div>
      </div>`;
  }).join('');
  return `
    <div class="navrow">
      <button class="iconbtn frost" type="button" data-action="back" aria-label="Back">${icons.back()}</button>
      <h1>Events</h1>
      <span></span>
    </div>
    <div class="segment">
      <button type="button" class="${eventsTab === 'upcoming' ? 'on' : ''}" data-action="events-tab" data-tab="upcoming">Upcoming (${parts.upcoming.length})</button>
      <button type="button" class="${eventsTab === 'previous' ? 'on' : ''}" data-action="events-tab" data-tab="previous">Previous (${parts.previous.length})</button>
    </div>
    <label class="searchbox">${icons.search(18)}<input id="event-filter" placeholder="Search Events" value="${esc(eventQuery)}"></label>
    ${filterEvents(list, eventQuery, rows)}
  `;
}

function filterEvents(list, query, rowsHTML) {
  const q = query.trim().toLowerCase();
  if (!q) return rowsHTML || '<div class="empty">No events.</div>';
  const matched = list.filter((event) =>
    event.title.toLowerCase().includes(q) ||
    event.host.toLowerCase().includes(q) ||
    (event.location || '').toLowerCase().includes(q)
  );
  if (!matched.length) return '<div class="empty">No events match.</div>';
  return matched.map((event) => `
    <div class="cell" data-action="go" data-name="event" data-id="${esc(event.id)}" role="link" tabindex="0">
      <div class="thumb-sm" style="background-image:${cssUrl(event.flyer)}"></div>
      <div class="grow">
        <span class="meta">${esc(event.host)}</span>
        <b>${esc(event.title)}</b>
        <span class="meta">${esc(event.listWhen || event.when)}</span>
      </div>
    </div>
  `).join('');
}

function searchHTML() {
  return `
    <div class="navrow">
      <button class="iconbtn" type="button" data-action="back" aria-label="Back">${icons.back()}</button>
      <label class="searchbox" style="margin:0">${icons.search(18)}<input id="q" placeholder="Search events and people..." value="${esc(viewQuery)}"></label>
      <span></span>
    </div>
    <p class="hint">Search is limited to your events, groups, and mutuals. Looking for someone else? Have a friend share the link.</p>
    <div id="results">${searchResults(viewQuery)}</div>
  `;
}

function searchResults(query) {
  const q = query.trim().toLowerCase();
  const events = state.eventOrder.map((id) => state.events[id]).filter(Boolean).filter((event) =>
    !q || event.title.toLowerCase().includes(q) || event.host.toLowerCase().includes(q)
  );
  const people = Object.values(state.people).filter((p) => p.id !== 'me' && (!q || p.name.toLowerCase().includes(q)));
  const create = `
    <div class="cell" data-action="create-from-search" role="link" tabindex="0">
      ${avatarHTML(person('me'), 48)}
      <div class="grow"><b>${q ? esc(query.trim()) : 'Type to create'}</b><span class="meta">Tap to finish creating event</span></div>
      ${icons.chev()}
    </div>`;
  const eventRows = events.map((event) => `
    <div class="cell" data-action="go" data-name="event" data-id="${esc(event.id)}" role="link" tabindex="0">
      <div class="thumb-sm" style="background-image:${cssUrl(event.flyer)}"></div>
      <div class="grow"><b>${esc(event.title)}</b><span class="meta">${esc(event.listWhen || event.when)}</span></div>
    </div>`).join('');
  const peopleRows = people.map((p) => `
    <div class="cell" data-action="go" data-name="person" data-id="${esc(p.id)}" role="link" tabindex="0">
      ${avatarHTML(p, 48)}
      <div class="grow"><b>${esc(p.name)}</b><span class="meta">${p.mutual ? `${esc(p.mutual)} mutual` : 'Person'}</span></div>
    </div>`).join('');
  if (q && !events.length && !people.length) return `${create}<div class="empty">Nothing matches.</div>`;
  return create + eventRows + peopleRows;
}

function guestsHTML(id) {
  const event = eventById(id);
  if (!event) return missing('That guest list is gone.');
  const tabs = ['going', 'maybe', 'invited'];
  const rows = (event.guests || [])
    .map((guest, index) => ({ guest, index }))
    .filter(({ guest }) => guestTab === 'all' || guest.status === guestTab);
  const c = counts(event);
  return `
    <div class="navrow">
      <button class="iconbtn frost" type="button" data-action="back" aria-label="Back">${icons.back()}</button>
      <h1>Guest list</h1>
      <span></span>
    </div>
    <p class="hint" style="text-align:center">${c.going} going · ${c.maybe} maybe · ${c.invited} invited</p>
    <div class="segment">
      ${tabs.map((tab) => `<button type="button" class="${guestTab === tab ? 'on' : ''}" data-action="guest-tab" data-tab="${tab}">${tab[0].toUpperCase()}${tab.slice(1)}</button>`).join('')}
    </div>
    ${rows.length ? rows.map(({ guest, index }) => `
      <div class="cell">
        ${avatarHTML(person(guest.personId), 48)}
        <div class="grow" data-action="go" data-name="person" data-id="${esc(guest.personId)}" role="link" tabindex="0">
          <b>${field(`people.${guest.personId}.name`, person(guest.personId).name, 'Name')}</b>
          <span class="meta">${guest.vouched ? 'Vouched' : 'On this list'}</span>
        </div>
        <div class="row-actions">
          <button class="status ${esc(guest.status)}" type="button" data-action="cycle-status" data-path="events.${esc(event.id)}.guests.${index}.status">${esc(guest.status[0].toUpperCase() + guest.status.slice(1))}</button>
          ${edit ? `<button class="mini-x" type="button" data-action="delete-guest" data-id="${esc(event.id)}" data-index="${index}" aria-label="Remove">×</button>` : ''}
        </div>
      </div>
    `).join('') : '<div class="empty">Nobody in this tab.</div>'}
    ${edit ? `<button class="primary" type="button" style="width:calc(100% - 32px);margin:12px 16px" data-action="add-guest" data-id="${esc(event.id)}">Add invited guest</button>` : `<p class="hint">Turn on Edit to add people and change photos.</p>`}
  `;
}

function peopleHTML() {
  const ids = [...state.suggestedIds, ...state.friendIds.filter((id) => !state.suggestedIds.includes(id))];
  return `
    <div class="navrow">
      <button class="iconbtn frost" type="button" data-action="back" aria-label="Back">${icons.back()}</button>
      <h1>Add friends</h1>
      <span></span>
    </div>
    ${ids.map((id) => {
      const p = person(id);
      const added = state.friendIds.includes(id);
      return `<div class="cell">
        ${avatarHTML(p, 48)}
        <div class="grow" data-action="go" data-name="person" data-id="${esc(id)}"><b>${field(`people.${id}.name`, p.name, 'Name')}</b><span class="meta">${p.mutual ? `${esc(p.mutual)} mutual` : 'Suggested'}</span></div>
        ${added
          ? '<span class="status going">Added</span>'
          : `<button class="go" type="button" data-action="add-friend" data-id="${esc(id)}">Add</button>`}
      </div>`;
    }).join('') || '<div class="empty">You are caught up.</div>'}
  `;
}

function personHTML(id) {
  const p = state.people[id];
  if (!p) return missing('That person is gone.');
  const events = state.eventOrder.map((eventId) => state.events[eventId]).filter((event) =>
    event && (event.guests || []).some((guest) => guest.personId === id)
  );
  return `
    <div class="navrow">
      <button class="iconbtn frost" type="button" data-action="back" aria-label="Back">${icons.back()}</button>
      <h1>Profile</h1>
      <span></span>
    </div>
    <div style="display:flex;justify-content:center;margin-top:12px">${avatarHTML(p, 108)}</div>
    <h1 class="event-title">${field(`people.${id}.name`, p.name, 'Name')}</h1>
    <p class="hint" style="text-align:center">${state.friendIds.includes(id) ? 'Friends' : 'Not on your friends list yet'}${p.mutual ? ` · ${esc(p.mutual)} mutual` : ''}</p>
    <div class="block-label">On these lists</div>
    ${events.length ? events.map((event) => {
      const guest = event.guests.find((item) => item.personId === id);
      return `<div class="cell" data-action="go" data-name="event" data-id="${esc(event.id)}">
        <div class="thumb-sm" style="background-image:${cssUrl(event.flyer)}"></div>
        <div class="grow"><b>${esc(event.title)}</b><span class="meta">${esc(guest.status)}</span></div>
      </div>`;
    }).join('') : '<div class="empty">Not on a list yet.</div>'}
  `;
}

function ticketHTML(id, live) {
  const event = live ? eventById(id) : null;
  if (live && !event) return missing('That ticket is gone.');
  const title = live ? event.title : person('me').name;
  const subtitle = live ? 'Live ticket' : 'Friend code';
  return `
    <div class="ticket">
      <div class="navrow" style="padding-left:0;padding-right:0">
        <button class="iconbtn frost" type="button" data-action="back" aria-label="Close">${icons.close()}</button>
        <h1></h1><span></span>
      </div>
      <div class="eyebrow">${subtitle}</div>
      <h1>${esc(title)}</h1>
      <div class="qr-wrap">
        <div class="qr-ring" id="qr-ring" style="--p:0">
          <div class="qr-card"><img id="qr-img" alt="Ticket code"></div>
        </div>
      </div>
      <p class="who-big">${esc(person('me').name)}</p>
      ${live
        ? '<p class="refresh">Refreshes every second · <span class="mono" id="qr-clock">--:--:--</span></p><p class="fine">A screenshot will not get someone in. The code changes every second while this ticket is open.</p>'
        : '<p class="fine">Friends can scan this code to find you. It stays the same.</p>'}
    </div>
  `;
}

function inviteHTML(id) {
  const event = eventById(id);
  if (!event) return missing('That invite is gone.');
  const face = ticketFace ? ' is-qr' : '';
  const card = (labelPath, label, subtitle, send, who) => `
    <article class="invite-card${face}">
      <img class="invite-img face-photo" alt="" draggable="false" src="${event.flyer || ''}" data-photo="events.${esc(event.id)}.flyer">
      <div class="gleam face-photo"></div>
      <div class="invite-fade face-photo"></div>
      <button class="send-invite face-photo" type="button" data-action="share-native" data-id="${esc(event.id)}">${icons.share(16)} ${send}</button>
      <div class="ticket-face">
        <canvas class="ticket-qr" data-who="${who}" aria-label="Live ticket"></canvas>
        <button class="ticket-portrait" type="button" ${who === 'me' ? 'data-photo="people.me.avatar"' : ''} aria-label="Photo on ticket"></button>
      </div>
      <div class="invite-name">
        <b>${labelPath ? field(labelPath, label, 'Name on invite') : esc(label)}</b>
        <span>${subtitle}</span>
      </div>
      <button class="qr-fab" type="button" data-action="flip-ticket" aria-label="${ticketFace ? 'Show invite' : 'Show ticket'}">
        <span class="icon-qr">${icons.qr(16)}</span>
        <span class="icon-flip">${icons.refresh(18)}</span>
      </button>
    </article>`;
  return `
    <div class="banner${inviteBanner ? '' : ' hide'}" id="invite-banner">
      <i>×</i>
      <div><b>Invite not transferable</b><span>This is a direct invite</span></div>
    </div>
    <div class="invite-top">
      <button class="iconbtn frost" type="button" data-action="back" aria-label="Close">${icons.close()}</button>
      <button class="event-pill" type="button" data-action="go" data-name="event" data-id="${esc(event.id)}">
        <span class="dotimg" style="background-image:${cssUrl(event.flyer)}"></span>
        <span>${esc(event.title)}</span>
      </button>
      <button class="iconbtn frost" type="button" data-action="menu" data-menu="invite" data-id="${esc(event.id)}" aria-label="More">${icons.more()}</button>
    </div>
    <div class="invite-stage">
      <div class="carousel" id="carousel">
        ${card('people.me.name', person('me').name, 'Your invite', 'Send this Invite', 'me')}
        <article class="invite-card plus-card">
          <canvas class="plus-qr" aria-hidden="true"></canvas>
          <div class="plus-copy">
            <b>Request +1 Invite</b>
            <span>Hosts will be notified to review your request</span>
          </div>
          <button class="plus-orb" type="button" data-action="request-plus" data-id="${esc(event.id)}" aria-label="Request plus one">+</button>
        </article>
      </div>
      <div class="dots"><span class="dot on"></span><span class="dot"></span></div>
    </div>
  `;
}

function createHTML() {
  const preview = draft.flyer ? ` style="background-image:${cssUrl(draft.flyer)}"` : '';
  return `
    <div class="navrow">
      <button class="iconbtn frost" type="button" data-action="back" aria-label="Back">${icons.back()}</button>
      <h1>Create event</h1>
      <span></span>
    </div>
    <div class="form">
      <div class="flyer-pick" data-photo="draft.flyer"${preview}><span>${draft.flyer ? 'Change flyer' : 'Upload flyer'}</span></div>
      ${draftField('title', 'Title', draft.title)}
      ${draftField('host', 'Host', draft.host)}
      ${draftField('when', 'Date and time', draft.when)}
      ${draftField('listDate', 'Date heading', draft.listDate)}
      ${draftField('location', 'Location', draft.location)}
      ${draftField('song', 'Song', draft.song)}
      <label>About<textarea data-draft="about" rows="4">${esc(draft.about)}</textarea></label>
      <button class="primary" type="button" data-action="save-draft">Create event</button>
    </div>
  `;
}

function draftField(key, label, value) {
  return `<label>${label}<input data-draft="${key}" value="${esc(value)}" placeholder="${esc(label)}"></label>`;
}

function missing(text) {
  return `<div class="navrow"><button class="iconbtn frost" type="button" data-action="back">${icons.back()}</button><h1>doorlist</h1><span></span></div><div class="empty">${esc(text)}</div>`;
}

function tabHTML(r) {
  if (!['home', 'profile', 'activity'].includes(r.name)) return '';
  const item = (name, icon, label) => `<button class="tab${r.name === name ? ' on' : ''}" type="button" data-action="go" data-name="${name}" aria-label="${label}">${icon}</button>`;
  return `<nav class="tabbar"><div class="tabs">
      ${item('home', icons.home(r.name === 'home'), 'Home')}
      ${item('activity', icons.bell(r.name === 'activity'), 'Activity')}
      ${item('profile', icons.person(r.name === 'profile'), 'Profile')}
    </div><button class="plus" type="button" data-action="menu" data-menu="plus" aria-label="Create">${icons.plus()}</button></nav>`;
}

function editBar(r) {
  const bottom = ['home', 'profile', 'activity'].includes(r.name)
    ? 'calc(86px + env(safe-area-inset-bottom))'
    : (r.name === 'event' ? 'calc(124px + env(safe-area-inset-bottom))' : 'calc(14px + env(safe-area-inset-bottom))');
  return `<div class="editbar" style="bottom:${bottom}"><p>Tap any photo or underlined label.</p><button type="button" data-action="toggle-edit">Done</button></div>`;
}

function menuHTML() {
  if (!menu) return '';
  const buttons = menu.items.map((item) =>
    `<button class="rowbtn${item.danger ? ' danger' : ''}" type="button" data-action="${esc(item.action)}" data-name="${esc(item.name || '')}" data-id="${esc(item.id || '')}" data-menu="${esc(item.menu || '')}">${esc(item.label)}</button>`
  ).join('');
  return `<div class="backdrop" data-action="close-menu"></div><div class="sheet"><div class="group">${buttons}</div><button class="rowbtn cancel" type="button" data-action="close-menu">Cancel</button></div>`;
}

function editorHTML() {
  if (!editor) return '';
  return `<div class="backdrop" data-action="close-editor"></div>
    <div class="sheet editor-sheet">
      <div class="sheet-label">${esc(editor.label)}</div>
      <textarea id="editor-input"></textarea>
      <button class="primary" type="button" data-action="save-editor">Save</button>
    </div>`;
}

function openMenu(kind, id) {
  const editLabel = edit ? 'Done editing' : 'Edit photos & text';
  if (kind === 'plus') {
    menu = { items: [
      { label: 'Create event', action: 'go', name: 'create' },
      { label: 'Add friends', action: 'go', name: 'people' }
    ] };
  } else if (kind === 'profile') {
    menu = { items: [
      { label: editLabel, action: 'toggle-edit' },
      { label: 'Your events', action: 'go', name: 'events' },
      { label: 'Reset demo', action: 'reset', danger: true }
    ] };
  } else if (kind === 'event') {
    menu = { items: [
      { label: editLabel, action: 'toggle-edit' },
      { label: 'Guest list', action: 'go', name: 'guests', id },
      { label: 'Tickets', action: 'go', name: 'ticket', id },
      { label: 'Share invite', action: 'go', name: 'invite', id }
    ] };
  } else if (kind === 'invite') {
    menu = { items: [
      { label: editLabel, action: 'toggle-edit' },
      { label: 'Show ticket', action: 'show-ticket', id },
      { label: 'Invite not transferable', action: 'show-banner' }
    ] };
  }
  render();
}

function afterRender(r) {
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute('content', (r.name === 'home' || r.name === 'profile' || r.name === 'activity') ? '#1c64b0' : '#000000');
  const input = document.getElementById('editor-input');
  if (input && editor) {
    input.value = editor.value == null ? '' : String(editor.value);
    input.focus();
  }
  const carousel = document.getElementById('carousel');
  if (carousel) {
    carousel.addEventListener('scroll', () => {
      const cards = [...carousel.querySelectorAll('.invite-card')];
      const mid = carousel.scrollLeft + carousel.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      cards.forEach((card, index) => {
        const dist = Math.abs(card.offsetLeft + card.offsetWidth / 2 - mid);
        if (dist < bestDist) { bestDist = dist; best = index; }
      });
      document.querySelectorAll('.dot').forEach((dot, index) => dot.classList.toggle('on', index === best));
    }, { passive: true });
  }
  if (r.name === 'invite' && inviteBanner) flashBanner();
  mountQR();
  const q = document.getElementById('q');
  if (q && r.name === 'search') q.focus();
}

function flashBanner() {
  const el = document.getElementById('invite-banner');
  if (!el) return;
  el.classList.remove('hide');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    el.classList.add('hide');
    inviteBanner = false;
  }, 2200);
}

function mountQR() {
  const live = document.querySelector('.invite-card.is-qr .ticket-qr, .plus-qr, #qr-img');
  if (!live) { stopQR(); return; }
  drawQR(true);
  if (!qrTimer) qrTimer = setInterval(() => drawQR(false), 200);
}

function stopQR() {
  if (qrTimer) clearInterval(qrTimer);
  qrTimer = null;
  lastQrSecond = null;
}

function drawQR(force) {
  if (typeof qrcode !== 'function') return;
  const canvases = [...document.querySelectorAll('.invite-card.is-qr .ticket-qr')];
  const ghosts = [...document.querySelectorAll('.plus-qr')];
  const img = document.getElementById('qr-img');
  if (!canvases.length && !ghosts.length && !img) return;
  const now = Date.now();
  const second = Math.floor(now / 1000);
  if (!force && second === lastQrSecond) return;
  lastQrSecond = second;
  const eventId = route().id || 'me';
  canvases.forEach((canvas) => {
    const who = canvas.dataset.who || 'me';
    paintTicket(canvas, `doorlist:ticket:${eventId}:${who}:${second}`, who);
  });
  ghosts.forEach((canvas) => paintGhost(canvas, `doorlist:plus:${eventId}:${second}`));
  if (img) {
    const qr = qrcode(0, 'M');
    qr.addData(`doorlist:user:${person('me').id}:${person('me').name}`);
    qr.make();
    img.src = qr.createDataURL(6, 2);
  }
}

function paintTicket(canvas, payload, who) {
  const qr = qrcode(0, 'H');
  qr.addData(payload);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 2;
  const size = 720;
  const cell = size / (count + quiet * 2);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  const origin = quiet * cell;
  ctx.fillStyle = '#111';
  [[0, 0], [count - 7, 0], [0, count - 7]].forEach(([row, col]) => {
    finder(ctx, origin + col * cell, origin + row * cell, cell);
  });
  const cx = size / 2;
  const cy = size / 2;
  const hole = size * 0.155;
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col) || inFinder(row, col, count)) continue;
      const x = origin + col * cell + cell / 2;
      const y = origin + row * cell + cell / 2;
      if ((x - cx) ** 2 + (y - cy) ** 2 < (hole + cell) ** 2) continue;
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.beginPath();
  ctx.arc(cx, cy, hole, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  stampPortrait(ctx, cx, cy, hole * 0.86, who);
}

function paintGhost(canvas, payload) {
  const qr = qrcode(0, 'H');
  qr.addData(payload);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 2;
  const size = 720;
  const cell = size / (count + quiet * 2);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const origin = quiet * cell;
  const ink = 'rgba(255,255,255,0.07)';
  [[0, 0], [count - 7, 0], [0, count - 7]].forEach(([row, col]) => {
    ghostFinder(ctx, origin + col * cell, origin + row * cell, cell);
  });
  ctx.fillStyle = ink;
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col) || inFinder(row, col, count)) continue;
      const x = origin + col * cell + cell / 2;
      const y = origin + row * cell + cell / 2;
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function ghostFinder(ctx, x, y, cell) {
  const s = cell * 7;
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = Math.max(2, cell * 0.7);
  roundRect(ctx, x + cell * 0.45, y + cell * 0.45, s - cell * 0.9, s - cell * 0.9, cell * 1.2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  roundRect(ctx, x + cell * 2.2, y + cell * 2.2, s - cell * 4.4, s - cell * 4.4, cell * 0.55);
  ctx.fill();
}

function inFinder(row, col, count) {
  return (row < 7 && col < 7) || (row < 7 && col >= count - 7) || (row >= count - 7 && col < 7);
}

function finder(ctx, x, y, cell) {
  const s = cell * 7;
  ctx.fillStyle = '#111';
  roundRect(ctx, x, y, s, s, cell * 0.9);
  ctx.fill();
  ctx.fillStyle = '#fff';
  roundRect(ctx, x + cell, y + cell, s - cell * 2, s - cell * 2, cell * 0.45);
  ctx.fill();
  ctx.fillStyle = '#111';
  roundRect(ctx, x + cell * 2, y + cell * 2, s - cell * 4, s - cell * 4, cell * 0.4);
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

const portraits = {};

function stampPortrait(ctx, cx, cy, radius, who) {
  const me = who === 'me';
  const p = me ? person('me') : { name: state.plusOneName || 'Guest', avatar: '', color: '#6d28d9' };
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = p.color || '#6d28d9';
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.fillStyle = '#fff';
  ctx.font = `800 ${Math.round(radius * 0.7)}px -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials(p.name), cx, cy + radius * 0.04);
  ctx.restore();
  const url = p.avatar || '';
  if (!url) return;
  const cached = portraits[url];
  if (cached) {
    drawCover(ctx, cached, cx, cy, radius);
    return;
  }
  const img = new Image();
  img.onload = () => {
    portraits[url] = img;
    if (document.querySelector('.invite-card.is-qr')) drawQR(true);
  };
  img.src = url;
}

function drawCover(ctx, img, cx, cy, radius) {
  const side = radius * 2;
  const scale = Math.max(side / img.width, side / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
}

function applyTicketFace() {
  document.querySelectorAll('.invite-card').forEach((card) => card.classList.toggle('is-qr', ticketFace));
  document.querySelectorAll('.qr-fab').forEach((button) => {
    button.setAttribute('aria-label', ticketFace ? 'Show invite' : 'Show ticket');
  });
  lastQrSecond = null;
  if (ticketFace) mountQR();
  else stopQR();
}

function onClick(event) {
  if (holdTriggered) {
    holdTriggered = false;
    event.preventDefault();
    return;
  }
  const draftPhoto = event.target.closest('[data-photo="draft.flyer"]');
  if (draftPhoto) {
    openCustom(draftPhoto);
    return;
  }
  const actionEl = event.target.closest('[data-action]');
  const custom = event.target.closest('[data-field],[data-photo]');
  if (edit && custom && (!actionEl || actionEl.contains(custom))) {
    openCustom(custom);
    return;
  }
  if (!actionEl || !app.contains(actionEl)) return;
  doAction(actionEl);
}

function doAction(el) {
  const action = el.dataset.action;
  const id = el.dataset.id || null;
  if (action === 'go') go(el.dataset.name, id);
  else if (action === 'flip-ticket') { ticketFace = !ticketFace; applyTicketFace(); }
  else if (action === 'request-plus') showToast('Hosts will be notified to review your request.');
  else if (action === 'show-ticket') {
    menu = null;
    ticketFace = true;
    if (route().name === 'invite' || route().name === 'ticket') render();
    else go('ticket', id);
  }
  else if (action === 'back') back();
  else if (action === 'toggle-edit') { edit = !edit; menu = null; render(); }
  else if (action === 'menu') openMenu(el.dataset.menu, id);
  else if (action === 'close-menu') { menu = null; render(); }
  else if (action === 'close-editor') { editor = null; render(); }
  else if (action === 'save-editor') saveEditor();
  else if (action === 'reset') resetDemo();
  else if (action === 'vouch') vouch(id);
  else if (action === 'rsvp') cycleRsvp(id);
  else if (action === 'start-host') startHost(id);
  else if (action === 'share-native') shareInvite(id);
  else if (action === 'share-profile') shareProfile();
  else if (action === 'add-friend') addFriend(id);
  else if (action === 'cycle-status') cycleStatus(el.dataset.path);
  else if (action === 'add-guest') addGuest(id);
  else if (action === 'delete-guest') deleteGuest(id, Number(el.dataset.index));
  else if (action === 'activity-tab') { activityTab = el.dataset.tab; render(); }
  else if (action === 'events-tab') { eventsTab = el.dataset.tab; eventQuery = ''; render(); }
  else if (action === 'guest-tab') { guestTab = el.dataset.tab; render(); }
  else if (action === 'request-cohost') showToast('Co-host request sent.');
  else if (action === 'conflict-info') showToast('This overlaps another event on your calendar.');
  else if (action === 'chat') showToast('Messages are a preview in this copy.');
  else if (action === 'clear-home-bg') { setPath('homeBackground', ''); render(); }
  else if (action === 'show-banner') { menu = null; inviteBanner = true; render(); }
  else if (action === 'create-from-search') {
    draft = blankDraft();
    draft.title = viewQuery.trim();
    draft.host = person('me').name;
    go('create');
  } else if (action === 'save-draft') saveDraft();
}

function openCustom(el) {
  if (el.dataset.photo) {
    pendingPath = el.dataset.photo;
    picker.click();
    return;
  }
  if (el.dataset.field) {
    editor = {
      path: el.dataset.field,
      label: el.dataset.label || 'Edit',
      value: getPath(el.dataset.field) ?? ''
    };
    menu = null;
    render();
  }
}

function saveEditor() {
  const input = document.getElementById('editor-input');
  if (!editor || !input) return;
  setPath(editor.path, input.value.trim());
  editor = null;
  showToast('Saved.');
  render();
}

function vouch(id) {
  const event = eventById(id);
  if (!event || event.didVouch) return;
  event.didVouch = true;
  const guest = (event.guests || []).find((item) => item.personId === event.vouchPersonId);
  if (guest) {
    guest.vouched = true;
    if (guest.status === 'invited') guest.status = 'going';
  }
  state.activity.you.unshift({ kind: 'vouched', personId: event.vouchPersonId, eventId: id, time: 'Just now' });
  state.activity.you = state.activity.you.slice(0, 20);
  persist();
  showToast(`Vouched for ${person(event.vouchPersonId).name}.`);
  render();
}

function cycleRsvp(id) {
  const event = eventById(id);
  if (!event) return;
  const order = [null, 'going', 'maybe'];
  const next = order[(order.indexOf(event.myRsvp || null) + 1) % order.length];
  event.myRsvp = next;
  event.guests = (event.guests || []).filter((guest) => guest.personId !== 'me');
  if (next) event.guests.unshift({ personId: 'me', status: next, vouched: true });
  state.activity.you.unshift({ kind: 'rsvp', eventId: id, status: next || 'cleared', time: 'Just now' });
  state.activity.you = state.activity.you.slice(0, 20);
  persist();
  showToast(next === 'going' ? "You're going." : next === 'maybe' ? "You're a maybe." : 'RSVP cleared.');
  render();
}

function startHost(id) {
  const event = eventById(id);
  if (!event) return;
  event.hostingLive = !event.hostingLive;
  persist();
  showToast(event.hostingLive ? "You're live. Guests can use their tickets." : 'Hosting paused.');
  render();
}

async function shareInvite(id) {
  const event = eventById(id);
  if (!event) return;
  const text = `${person('me').name} invited you to ${event.title}`;
  const url = `${location.origin}${location.pathname}#event/${encodeURIComponent(id)}`;
  if (navigator.share) {
    try { await navigator.share({ title: event.title, text, url }); }
    catch (err) { if (err && err.name !== 'AbortError') showToast('Could not open the share sheet.'); }
  } else {
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      showToast('Invite copied.');
    } catch (err) {
      showToast(text);
    }
  }
}

async function shareProfile() {
  const text = `Add ${person('me').name} on doorlist`;
  if (navigator.share) {
    try { await navigator.share({ title: person('me').name, text, url: location.href }); }
    catch (err) { /* dismissed */ }
  } else showToast(text);
}

function addFriend(id) {
  if (!state.friendIds.includes(id)) state.friendIds.push(id);
  persist();
  showToast(`Friend request sent to ${person(id).name}.`);
  render();
}

function cycleStatus(path) {
  if (!path) return;
  const order = ['invited', 'going', 'maybe'];
  const current = getPath(path) || 'invited';
  setPath(path, order[(order.indexOf(current) + 1) % order.length]);
  render();
}

function addGuest(eventId) {
  const event = eventById(eventId);
  if (!event) return;
  const id = 'p' + uid();
  state.people[id] = { id, name: 'New guest', avatar: '', color: '#6366f1', mutual: '' };
  event.guests.push({ personId: id, status: 'invited', vouched: false });
  persist();
  guestTab = 'invited';
  editor = { path: `people.${id}.name`, label: 'Guest name', value: 'New guest' };
  render();
}

function deleteGuest(eventId, index) {
  const event = eventById(eventId);
  if (!event || !event.guests[index]) return;
  event.guests.splice(index, 1);
  persist();
  render();
}

function saveDraft() {
  document.querySelectorAll('[data-draft]').forEach((el) => { draft[el.dataset.draft] = el.value; });
  const title = draft.title.trim();
  if (!title) { showToast('Add a title first.'); return; }
  const id = 'e' + Date.now().toString(36);
  const when = draft.when.trim() || 'Date to be announced';
  state.events[id] = {
    id,
    title,
    host: draft.host.trim() || person('me').name,
    hostColor: '#2f6bff',
    hostAvatar: '',
    day: '21',
    dow: 'SAT',
    when,
    whenShort: when,
    listWhen: when,
    listDate: draft.listDate.trim() || 'Upcoming',
    location: draft.location.trim(),
    about: draft.about.trim(),
    song: draft.song.trim(),
    flyer: draft.flyer || titlePoster(title),
    upcoming: true,
    listed: true,
    conflict: false,
    showGuestList: true,
    startHosting: false,
    hostingLive: false,
    vouchPersonId: '',
    didVouch: false,
    invitedBy: 'me',
    faceIds: [],
    guests: []
  };
  state.eventOrder.unshift(id);
  state.yourEventIds.unshift(id);
  draft = blankDraft();
  persist();
  showToast('Event created.');
  go('event', id);
}

function resetDemo() {
  state = seed();
  draft = blankDraft();
  edit = false;
  menu = null;
  editor = null;
  persist();
  showToast('Demo reset.');
  if (location.hash && location.hash !== '#home') location.hash = '#home';
  else render();
}

async function compress(file, max, quality) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const url = drawBitmap(bitmap, max, quality);
      bitmap.close?.();
      return url;
    } catch (err) { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('unreadable'));
      img.src = url;
    });
    return drawBitmap(image, max, quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawBitmap(source, max, quality) {
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function bind() {
  app.addEventListener('click', onClick);
  app.addEventListener('input', (event) => {
    const draftEl = event.target.closest('[data-draft]');
    if (draftEl) draft[draftEl.dataset.draft] = event.target.value;
    if (event.target.id === 'q') {
      viewQuery = event.target.value;
      const box = document.getElementById('results');
      if (box) box.innerHTML = searchResults(viewQuery);
    }
    if (event.target.id === 'event-filter') {
      eventQuery = event.target.value;
      render();
      const again = document.getElementById('event-filter');
      if (again) {
        again.focus();
        const end = again.value.length;
        again.setSelectionRange(end, end);
      }
    }
  });
  app.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('[data-action]') && !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
      event.preventDefault();
      onClick(event);
    }
  });
  app.addEventListener('contextmenu', (event) => {
    const target = event.target.closest('[data-photo],[data-field]');
    if (!target) return;
    event.preventDefault();
    openCustom(target);
  });
  app.addEventListener('pointerdown', (event) => {
    const target = event.target.closest('[data-photo],[data-field]');
    if (!target || event.target.closest('[data-photo="draft.flyer"]')) return;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      holdTriggered = true;
      openCustom(target);
    }, 550);
  });
  app.addEventListener('pointerup', () => clearTimeout(holdTimer));
  app.addEventListener('pointermove', () => clearTimeout(holdTimer));
  app.addEventListener('pointercancel', () => clearTimeout(holdTimer));
  picker.addEventListener('change', async () => {
    const file = picker.files && picker.files[0];
    const path = pendingPath;
    picker.value = '';
    pendingPath = null;
    if (!file || !path) return;
    const avatar = path.endsWith('.avatar') || path.endsWith('hostAvatar');
    try {
      let url = await compress(file, avatar ? 640 : 1400, 0.82);
      if (path === 'draft.flyer') {
        draft.flyer = url;
        render();
        return;
      }
      const ok = setPath(path, url);
      if (!ok) {
        url = await compress(file, avatar ? 480 : 1000, 0.6);
        if (!setPath(path, url)) return;
      }
      showToast('Photo updated.');
      render();
    } catch (err) {
      showToast('Could not use that photo.');
    }
  });
  window.addEventListener('hashchange', () => {
    const next = route();
    if (next.name === 'ticket') ticketFace = true;
    else if (next.name === 'invite') ticketFace = false;
    menu = null;
    editor = null;
    render();
  });
}

function makePoster(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 800;
  const g = canvas.getContext('2d');
  const rounded = () => {};
  if (kind === 'theta') {
    for (let i = 0; i < 14; i++) {
      g.fillStyle = i % 2 ? '#f4efe6' : '#8d1530';
      g.fillRect(0, i * 58, 800, 58);
    }
    g.fillStyle = '#10284a';
    g.fillRect(0, 0, 340, 250);
    g.fillStyle = '#f4efe6';
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) g.fillRect(28 + x * 50, 28 + y * 52, 8, 8);
    g.fillStyle = 'rgba(255,255,255,.94)';
    g.fillRect(36, 300, 728, 150);
    g.fillStyle = '#161616';
    g.font = '800 78px Georgia, serif';
    g.fillText('DARTY', 64, 400);
    g.fillStyle = '#8d1530';
    g.fillText('TIME', 470, 400);
    g.fillStyle = '#003262';
    g.font = 'italic 700 110px Georgia, serif';
    g.fillText('Cal', 70, 620);
    g.fillStyle = '#8C1515';
    g.font = '800 120px Georgia, serif';
    g.fillText('S', 620, 640);
  } else if (kind === 'zbt') {
    const grad = g.createLinearGradient(0, 0, 800, 800);
    grad.addColorStop(0, '#102a6b');
    grad.addColorStop(1, '#07101f');
    g.fillStyle = grad;
    g.fillRect(0, 0, 800, 800);
    g.fillStyle = '#f5c451';
    g.font = '800 84px Georgia, serif';
    g.fillText('BIG GAME', 60, 330);
    g.fillStyle = '#fff';
    g.font = '800 72px Georgia, serif';
    g.fillText('TAILGATE', 60, 420);
    g.fillStyle = '#93c5fd';
    g.font = '700 36px Georgia, serif';
    g.fillText('SATURDAY  12:30', 60, 490);
    g.fillStyle = '#1d4ed8';
    g.fillRect(60, 560, 230, 110);
    g.fillStyle = '#fff';
    g.font = '800 58px Georgia, serif';
    g.fillText('ZBT', 100, 632);
  } else if (kind === 'nightmare') {
    const grad = g.createLinearGradient(0, 0, 0, 800);
    grad.addColorStop(0, '#14081f');
    grad.addColorStop(1, '#050208');
    g.fillStyle = grad;
    g.fillRect(0, 0, 800, 800);
    g.fillStyle = '#c4b5fd';
    g.beginPath();
    g.arc(620, 150, 70, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#050208';
    g.beginPath();
    g.arc(650, 140, 58, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d8b4fe';
    g.font = '800 78px Georgia, serif';
    g.fillText('NIGHTMARE', 50, 430);
    g.fillStyle = '#a855f7';
    for (let i = 0; i < 8; i++) g.fillRect(70 + (i % 4) * 170, 560 + Math.floor(i / 4) * 80, 18, 18);
  } else if (kind === 'kdr') {
    const grad = g.createLinearGradient(0, 0, 800, 800);
    grad.addColorStop(0, '#fb7185');
    grad.addColorStop(0.5, '#7c3aed');
    grad.addColorStop(1, '#1e1b4b');
    g.fillStyle = grad;
    g.fillRect(0, 0, 800, 800);
    g.fillStyle = '#111827';
    g.beginPath();
    g.moveTo(80, 620); g.lineTo(180, 340); g.lineTo(280, 620); g.fill();
    g.beginPath();
    g.moveTo(240, 620); g.lineTo(360, 280); g.lineTo(500, 620); g.fill();
    g.fillStyle = '#fff';
    g.font = '800 72px Georgia, serif';
    g.fillText('2016', 70, 180);
    g.font = '800 58px Georgia, serif';
    g.fillText('THROWBACK', 70, 260);
  } else if (kind === 'boo') {
    g.fillStyle = '#1c1008';
    g.fillRect(0, 0, 800, 800);
    g.fillStyle = '#f97316';
    g.font = '800 140px Georgia, serif';
    g.fillText('BOO', 160, 430);
    g.fillStyle = '#fdba74';
    g.font = '700 36px Georgia, serif';
    g.fillText('HALLOWEEN', 230, 500);
  } else if (kind === 'oxside') {
    g.fillStyle = '#6b1020';
    g.fillRect(0, 0, 800, 800);
    g.fillStyle = '#f8f1e7';
    g.font = '800 84px Georgia, serif';
    g.fillText('OXSIDE', 150, 420);
  } else {
    g.fillStyle = '#1e293b';
    g.fillRect(0, 0, 800, 800);
    g.fillStyle = '#e2e8f0';
    g.font = '800 64px Georgia, serif';
    g.fillText('PREGAME', 150, 400);
    g.font = '700 28px Georgia, serif';
    g.fillText('TAP TO CREATE', 230, 460);
  }
  rounded();
  return canvas.toDataURL('image/jpeg', 0.72);
}

function titlePoster(title) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 800;
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 800, 800);
  grad.addColorStop(0, '#1d4ed8');
  grad.addColorStop(1, '#111827');
  g.fillStyle = grad;
  g.fillRect(0, 0, 800, 800);
  g.fillStyle = '#fff';
  g.font = '800 64px Georgia, serif';
  const words = title.split(/\s+/);
  let line = '';
  let y = 300;
  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > 680 && line) {
      g.fillText(line, 60, y);
      line = word;
      y += 78;
    } else line = test;
  });
  if (line) g.fillText(line, 60, y);
  return canvas.toDataURL('image/jpeg', 0.72);
}

function seed() {
  const posters = {
    theta: makePoster('theta'),
    zbt: makePoster('zbt'),
    nightmare: makePoster('nightmare'),
    kdr: makePoster('kdr'),
    boo: makePoster('boo'),
    oxside: makePoster('oxside'),
    prezbt: makePoster('pre')
  };
  const people = {
    me: { id: 'me', name: 'Angela Zhao', avatar: '', color: '#7c3aed', mutual: '' },
    jasper: { id: 'jasper', name: 'Jasper', avatar: '', color: '#2563eb', mutual: 6 },
    lucia: { id: 'lucia', name: 'Lucia', avatar: '', color: '#db2777', mutual: 4 },
    paulina: { id: 'paulina', name: 'Paulina', avatar: '', color: '#2563eb', mutual: 8 },
    karina: { id: 'karina', name: 'Karina', avatar: '', color: '#f97316', mutual: 5 },
    atran: { id: 'atran', name: 'Angela Tran', avatar: '', color: '#a16207', mutual: 3 },
    kenya: { id: 'kenya', name: 'Kenya Rose', avatar: '', color: '#0f766e', mutual: 8 },
    roberto: { id: 'roberto', name: 'Roberto Jap', avatar: '', color: '#1d4ed8', mutual: 11 },
    alicia: { id: 'alicia', name: 'Alicia Rodriguez', avatar: '', color: '#be185d', mutual: 7 },
    adelyn: { id: 'adelyn', name: 'Adelyn Qian', avatar: '', color: '#7c3aed', mutual: 9 },
    aluo: { id: 'aluo', name: 'Angela Luo', avatar: '', color: '#0e7490', mutual: 2 },
    mina: { id: 'mina', name: 'Mina Cho', avatar: '', color: '#65a30d', mutual: 4 },
    noah: { id: 'noah', name: 'Noah Kim', avatar: '', color: '#b45309', mutual: 6 }
  };
  const guest = (personId, status) => ({ personId, status, vouched: status === 'going' });
  return {
    version: 1,
    homeBackground: '',
    plusOneName: 'Plus one',
    featuredId: 'theta',
    yourEventIds: ['prezbt', 'zbt'],
    friendIds: ['roberto', 'alicia', 'adelyn', 'aluo', 'mina', 'noah'],
    suggestedIds: ['paulina', 'karina', 'atran', 'kenya'],
    eventOrder: ['zbt', 'theta', 'kdr', 'nightmare', 'boo', 'oxside'],
    people,
    activity: {
      friends: [
        { kind: 'vouch', personId: 'jasper', eventId: 'theta', time: '2m' },
        { kind: 'going', personId: 'lucia', eventId: 'zbt', time: '18m' },
        { kind: 'going', personId: 'kenya', eventId: 'nightmare', time: '1d' },
        { kind: 'joined', personId: 'mina', eventId: 'theta', time: '3d' }
      ],
      you: [
        { kind: 'saved', eventId: 'theta', time: '1h' },
        { kind: 'rsvp', eventId: 'zbt', status: 'going', time: 'Yesterday' }
      ]
    },
    events: {
      theta: {
        id: 'theta', title: 'Theta Chi Big Game Darty', host: 'Theta Chi', hostColor: '#003262', hostAvatar: '',
        day: '21', dow: 'SAT', when: 'Today at 12:00 PM', whenShort: '12:00PM | Theta Chi',
        listWhen: 'Open to see date', listDate: 'Saturday, November 21', location: 'Theta Chi',
        about: 'Flag up, music on, doors at noon. Big Game pregame at the house.',
        song: 'Take U Jengi', flyer: posters.theta, upcoming: true, listed: true, conflict: true,
        showGuestList: false, startHosting: false, hostingLive: false, vouchPersonId: 'jasper',
        vouchWide: false, didVouch: false, invitedBy: '', faceIds: ['mina', 'roberto', 'kenya'],
        guests: [guest('jasper', 'invited'), guest('mina', 'going'), guest('kenya', 'maybe'), guest('roberto', 'going')]
      },
      prezbt: {
        id: 'prezbt', title: 'Pre-ZBT Big Game Tailgate', host: 'You', hostLabel: 'Tap to Create', hostColor: '#334155', hostAvatar: '',
        day: '21', dow: 'SAT', when: 'Today at 10:00 AM', whenShort: '10:00AM',
        listWhen: 'Today at 10:00 AM', listDate: 'Saturday, November 21', location: '',
        about: 'Warm up before the tailgate. Hit Start Hosting when the door is open.',
        song: '', flyer: posters.prezbt, upcoming: true, listed: false, conflict: false,
        showGuestList: true, startHosting: true, hostingLive: false, vouchPersonId: '',
        didVouch: false, invitedBy: '', faceIds: [], guests: []
      },
      zbt: {
        id: 'zbt', title: 'ZBT Big Game Tailgate', host: 'ZBT', hostColor: '#1d4ed8', hostAvatar: '',
        day: '21', dow: 'SAT', when: 'Nov 21 12:30 PM', whenShort: '12:30PM | ZBT',
        listWhen: 'Nov 21 12:30 PM', listDate: 'Saturday, November 21', location: '2721 Channing Way',
        about: 'Channing Way. Games on, doors open, kickoff watch at 12:30.',
        song: 'California Drinking', flyer: posters.zbt, upcoming: true, listed: true, conflict: false,
        showGuestList: true, startHosting: false, hostingLive: false, vouchPersonId: 'lucia',
        vouchWide: true, didVouch: false, invitedBy: '', faceIds: ['lucia', 'karina', 'atran'],
        guests: [guest('lucia', 'invited'), guest('karina', 'going'), guest('atran', 'going'), guest('noah', 'maybe'), guest('paulina', 'invited')]
      },
      kdr: {
        id: 'kdr', title: 'KDR 2016 Throwback', host: 'Kappa Delta Rho', hostColor: '#db2777', hostAvatar: '',
        day: '7', dow: 'SAT', when: 'Nov 7 9:30 PM', whenShort: '9:30PM | KDR',
        listWhen: 'Nov 7 9:30 PM', listDate: 'Saturday, November 7', location: '2739 Channing Way',
        about: 'Neon, palms, and a playlist stuck in 2016.',
        song: '', flyer: posters.kdr, upcoming: false, listed: true, conflict: false,
        showGuestList: true, startHosting: false, hostingLive: false, vouchPersonId: '',
        didVouch: false, invitedBy: 'mina', faceIds: [],
        guests: [guest('noah', 'going'), guest('mina', 'going'), guest('paulina', 'maybe')]
      },
      nightmare: {
        id: 'nightmare', title: 'ΠΛΦ Nightmare', host: 'Pi Lambda Phi', hostColor: '#7e22ce', hostAvatar: '',
        day: '30', dow: 'FRI', when: 'Oct 30 10:00 PM', whenShort: '10:00PM | ΠΛΦ',
        listWhen: 'Oct 30 10:00 PM', listDate: 'Friday, October 30', location: 'Pi Lambda Phi',
        about: 'Costumes, low light, and a long guest list.',
        song: 'Pursuit of Happiness', flyer: posters.nightmare, upcoming: false, listed: true, conflict: false,
        showGuestList: true, startHosting: false, hostingLive: false, vouchPersonId: '',
        didVouch: false, invitedBy: 'kenya', faceIds: [],
        guests: [guest('kenya', 'going'), guest('alicia', 'going'), guest('adelyn', 'maybe'), guest('aluo', 'going'), guest('mina', 'invited'), guest('roberto', 'going')]
      },
      boo: {
        id: 'boo', title: 'Boo-cec x PBL Halloween', host: 'Evangeline Lim', hostColor: '#ea580c', hostAvatar: '',
        day: '29', dow: 'THU', when: 'Oct 29 10:00 PM', whenShort: '10:00PM',
        listWhen: 'Oct 29 10:00 PM', listDate: 'Thursday, October 29', location: '',
        about: 'Halloween block party with the neighbors.',
        song: '', flyer: posters.boo, upcoming: false, listed: true, conflict: false,
        showGuestList: true, startHosting: false, hostingLive: false, vouchPersonId: '',
        didVouch: false, invitedBy: 'adelyn', faceIds: [],
        guests: [guest('adelyn', 'going'), guest('alicia', 'maybe')]
      },
      oxside: {
        id: 'oxside', title: 'Oxside', host: 'Theta Chi', hostColor: '#9f1239', hostAvatar: '',
        day: '3', dow: 'SAT', when: 'Oct 3 9:00 PM', whenShort: '9:00PM | Theta Chi',
        listWhen: 'Oct 3 9:00 PM', listDate: 'Saturday, October 3', location: 'Theta Chi',
        about: 'Earlier this fall at the house.',
        song: '', flyer: posters.oxside, upcoming: false, listed: true, conflict: false,
        showGuestList: false, startHosting: false, hostingLive: false, vouchPersonId: '',
        didVouch: false, invitedBy: '', faceIds: [],
        guests: [guest('alicia', 'maybe'), guest('roberto', 'going')]
      }
    }
  };
}

if (route().name === 'ticket') ticketFace = true;
bind();
render();
if (canStore && !localStorage.getItem(TIP)) {
  localStorage.setItem(TIP, '1');
  setTimeout(() => showToast('Tap Edit to upload photos and rewrite any label. It stays on this phone.'), 700);
}
if (location.hostname.endsWith('github.io') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}
