let currentUser = null;
const content = document.querySelector('#content');
const navigation = document.querySelector('#navigation');
const dialog = document.querySelector('#contacts');

const filters = {
  activity: [],
  type: [],
  duration: [],
  place: [],
  from: '',
  to: ''
};

let draft = null;
let events = [];
let filterGroups = [];


async function loadData() {
  const [eventsResponse, filtersResponse] = await Promise.all([
    fetch('/api/events'),
    fetch('/api/filter-groups')
  ]);

  if (!eventsResponse.ok || !filtersResponse.ok) {
    throw new Error('Не удалось загрузить данные LETOMEET.');
  }

  events = await eventsResponse.json();
  filterGroups = await filtersResponse.json();
}


function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}


function dateLabel(date) {
  return new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long'
  });
}


function tags(event) {
  return [event.activity, event.type, event.duration, event.place]
    .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('');
}


function filterFields() {
  return filterGroups.map(group =>
    `<fieldset class="filter-group">
      <legend>${escapeHtml(group.label)}</legend>
      <div class="chips">
        ${group.options.map(option =>
          `<label class="chip">
            <input type="checkbox" name="${group.key}" value="${escapeHtml(option)}"
              ${filters[group.key].includes(option) ? 'checked' : ''}>
            ${escapeHtml(option)}
          </label>`
        ).join('')}
      </div>
    </fieldset>`
  ).join('') +
  `<fieldset class="filter-group">
    <legend>Когда</legend>
    <div class="form-grid">
      <label class="field">С даты
        <input type="date" name="from" value="${filters.from}">
      </label>
      <label class="field">По дату
        <input type="date" name="to" value="${filters.to}">
      </label>
    </div>
    <p id="date-error" class="error small" hidden>
      Дата окончания должна быть не раньше начала.
    </p>
  </fieldset>`;
}


function readFilters(form) {
  const data = new FormData(form);

  filterGroups.forEach(group => {
    filters[group.key] = data.getAll(group.key);
  });

  filters.from = data.get('from') || '';
  filters.to = data.get('to') || '';

  const valid = !filters.from || !filters.to || filters.from <= filters.to;
  const dateError = document.querySelector('#date-error');

  if (dateError) dateError.hidden = valid;

  return valid;
}

async function loadUser() {
  try {
    const response = await fetch('/api/auth/me');

    if (!response.ok) {
      currentUser = null;
      return;
    }

    const data = await response.json();
    currentUser = data.user;
  } catch {
    currentUser = null;
  }

  updateAuthPanel();
}

function updateAuthPanel() {
  const panel = document.querySelector('#auth-panel');

  if (!panel) return;

  if (!currentUser) {
    panel.innerHTML = `
      <div class="auth-links">
        <a href="#login">Войти</a>
        <a href="#register">Регистрация</a>
      </div>
    `;

    return;
  }

  panel.innerHTML = `
    <div class="auth-user">
      <span>
        Вы вошли как
        <strong>${escapeHtml(currentUser.username)}</strong>
      </span>

        <a href="#account">Личный кабинет</a>

        ${
          currentUser.role === 'admin'
            ? `<a href="#admin">Админ</a>`
            : ''
        }

        <button id="logout-button" class="plain">
          Выйти
        </button>
    </div>
  `;

  document.querySelector('#logout-button').onclick =
    async () => {
      await fetch('/api/auth/logout', {
        method: 'POST'
      });

      currentUser = null;

      location.hash = 'home';
      render();
      updateAuthPanel();
    };
}

function registerPage(step = 1, email = '') {
  if (step === 1) {
    content.innerHTML = `
      <section class="auth-page">
        <a class="back" href="#home">← На главную</a>

        <h1>Регистрация</h1>

        <form id="register-form">

          <label class="field">
            Имя
            <input
              name="username"
              maxlength="80"
              required
              placeholder="Например, Егор"
            >
          </label>

          <label class="field">
            Почта
            <input
              name="email"
              type="email"
              required
              placeholder="name@student.letovo.ru"
            >
          </label>

          <p class="small muted">
            Используйте школьную почту
            @student.letovo.ru или @letovo.ru.
          </p>

          <p id="auth-error" class="error"></p>

          <button class="primary" type="submit">
            Получить код
          </button>

        </form>

        <p>
          Уже есть аккаунт?
          <a href="#login">Войти</a>
        </p>
      </section>
    `;

    document.querySelector('#register-form').onsubmit =
      async event => {

        event.preventDefault();

        const data = Object.fromEntries(
          new FormData(event.currentTarget)
        );

        const error = document.querySelector('#auth-error');

        try {
          const response = await fetch(
            '/api/auth/register/request',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(data)
            }
          );

          const result = await response.json();

          if (!response.ok) {
            error.textContent =
              result.error || 'Не удалось отправить код.';
            return;
          }

          registerPage(2, data.email);

        } catch {
          error.textContent =
            'Сервер недоступен.';
        }
      };

    return;
  }

  content.innerHTML = `
    <section class="auth-page">
      <a class="back" href="#home">← На главную</a>

      <h1>Подтверждение</h1>

      <p>
        Мы отправили 6-значный код на
        <strong>${escapeHtml(email)}</strong>.
      </p>

      <form id="register-code-form">

        <label class="field">
          Код
          <input
            name="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            required
            placeholder="123456"
          >
        </label>

        <p id="auth-error" class="error"></p>

        <button class="primary" type="submit">
          Создать аккаунт
        </button>

      </form>
    </section>
  `;

  document.querySelector('#register-code-form').onsubmit =
    async event => {

      event.preventDefault();

      const data = Object.fromEntries(
        new FormData(event.currentTarget)
      );

      data.email = email;

      const error = document.querySelector('#auth-error');

      try {
        const response = await fetch(
          '/api/auth/register/verify',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
          }
        );

        const result = await response.json();

        if (!response.ok) {
          error.textContent =
            result.error || 'Неверный код.';
          return;
        }

        currentUser = result.user;

        updateAuthPanel();

        location.hash = 'home';

      } catch {
        error.textContent =
          'Сервер недоступен.';
      }
    };
}

function loginPage(step = 1, email = '') {
  if (step === 1) {
    content.innerHTML = `
      <section class="auth-page">
        <a class="back" href="#home">← На главную</a>

        <h1>Вход</h1>

        <form id="login-form">

          <label class="field">
            Почта
            <input
              name="email"
              type="email"
              required
              placeholder="name@student.letovo.ru"
            >
          </label>

          <p id="auth-error" class="error"></p>

          <button class="primary" type="submit">
            Получить код
          </button>

        </form>

        <p>
          Нет аккаунта?
          <a href="#register">Зарегистрироваться</a>
        </p>
      </section>
    `;

    document.querySelector('#login-form').onsubmit =
      async event => {

        event.preventDefault();

        const data = Object.fromEntries(
          new FormData(event.currentTarget)
        );

        const error = document.querySelector('#auth-error');

        try {
          const response = await fetch(
            '/api/auth/login/request',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(data)
            }
          );

          const result = await response.json();

          if (!response.ok) {
            error.textContent =
              result.error || 'Не удалось отправить код.';
            return;
          }

          loginPage(2, data.email);

        } catch {
          error.textContent =
            'Сервер недоступен.';
        }
      };

    return;
  }

  content.innerHTML = `
    <section class="auth-page">
      <a class="back" href="#home">← На главную</a>

      <h1>Введите код</h1>

      <p>
        Код отправлен на
        <strong>${escapeHtml(email)}</strong>.
      </p>

      <form id="login-code-form">

        <label class="field">
          Код
          <input
            name="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            required
            placeholder="123456"
          >
        </label>

        <p id="auth-error" class="error"></p>

        <button class="primary" type="submit">
          Войти
        </button>

      </form>
    </section>
  `;

  document.querySelector('#login-code-form').onsubmit =
    async event => {

      event.preventDefault();

      const data = Object.fromEntries(
        new FormData(event.currentTarget)
      );

      data.email = email;

      const error = document.querySelector('#auth-error');

      try {
        const response = await fetch(
          '/api/auth/login/verify',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
          }
        );

        const result = await response.json();

        if (!response.ok) {
          error.textContent =
            result.error || 'Неверный код.';
          return;
        }

        currentUser = result.user;

        updateAuthPanel();

        location.hash = 'home';

      } catch {
        error.textContent =
          'Сервер недоступен.';
      }
    };
}

async function adminPage() {
  if (!currentUser || currentUser.role !== 'admin') {
    content.innerHTML = `
      <section class="empty">
        <h1>Доступ запрещён</h1>
        <p class="muted">
          Эта страница доступна только администраторам.
        </p>
        <a href="#home">На главную</a>
      </section>
    `;

    return;
  }

  content.innerHTML = `
    <section class="admin-page">

      <a class="back" href="#home">
        ← На главную
      </a>

      <h1>Админ-панель</h1>

      <div id="admin-stats" class="admin-stats">
        Загрузка...
      </div>

      <section class="form-section">
        <h2>Пользователи</h2>

        <div id="admin-users">
          Загрузка...
        </div>
      </section>
        <section class="form-section">
          <h2>Модерация мероприятий</h2>

          <div id="admin-events">
            Загрузка...
          </div>
    </section>
  `;

  try {
    const [statsResponse, usersResponse] =
      await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/users')
      ]);

    if (!statsResponse.ok || !usersResponse.ok) {
      throw new Error();
    }

    const stats = await statsResponse.json();
    const users = await usersResponse.json();
    const response = await fetch('/api/admin/events');
    const data = await response.json();

    const eventsContainer =
  document.querySelector('#admin-events');

eventsContainer.innerHTML =
  data.events.length
    ? data.events.map(event => `
        <article class="account-event">

          <div>
            <h3>
              ${escapeHtml(event.title)}
            </h3>

            <p class="meta">
              ${dateLabel(event.date)}
              ·
              ${event.time}–${event.end}
              ·
              ${escapeHtml(event.place)}
              ·
              ${escapeHtml(event.room)}
            </p>

            <p class="muted">
              ${escapeHtml(event.summary)}
            </p>

            <p>
              Статус:
              <strong>${escapeHtml(event.status)}</strong>
            </p>

            ${
              event.moderation_comment
                ? `<p class="error">
                    Комментарий:
                    ${escapeHtml(event.moderation_comment)}
                  </p>`
                : ''
            }
          </div>

          <div class="account-event-actions">
            ${
              event.image_url
                ? `
                  <a
                    class="admin-event-image-link"
                    href="${escapeHtml(event.image_url)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Открыть изображение в полном размере"
                  >
                    <img
                      class="admin-event-image"
                      src="${escapeHtml(event.image_url)}"
                      alt="Обложка мероприятия"
                    >
                  </a>
                `
                : ''
            }
            ${
              event.status !== 'approved'
                ? `
                  <button
                    class="primary"
                    onclick="moderateEvent(${event.id}, 'approve')"
                  >
                    Одобрить
                  </button>
                `
                : ''
            }

            ${
              event.status !== 'rejected'
                ? `
                  <button
                    class="secondary"
                    onclick="
                      moderateEvent(
                        ${event.id},
                        'reject',
                        prompt('Причина отклонения:') || ''
                      )
                    "
                  >
                    Отклонить
                  </button>
                `
                : ''
            }

            ${
              event.status === 'approved'
                ? `
                  <button
                    class="secondary"
                    onclick="moderateEvent(${event.id}, 'unpublish')"
                  >
                    Снять с публикации
                  </button>
                `
                : ''
            }

          </div>

        </article>
      `).join('')
    : '<p class="muted">Мероприятий пока нет.</p>';

    document.querySelector('#admin-stats').innerHTML = `
      <div class="admin-stat">
        <strong>${stats.users}</strong>
        <span>пользователей</span>
      </div>

      <div class="admin-stat">
        <strong>${stats.admins}</strong>
        <span>администраторов</span>
      </div>
    `;

    document.querySelector('#admin-users').innerHTML =
      users.users.length
        ? users.users.map(user => `
            <div class="admin-user">
              <div>
                <strong>
                  ${escapeHtml(user.username)}
                </strong>

                <span class="small muted">
                  ${escapeHtml(user.email)}
                </span>
              </div>

              <span class="tag">
                ${user.role === 'admin'
                  ? 'admin'
                  : 'user'}
              </span>
            </div>
          `).join('')
        : '<p class="muted">Пользователей пока нет.</p>';

  } catch {
    document.querySelector('#admin-users').innerHTML =
      '<p class="error">Не удалось загрузить данные.</p>';
  }
}

async function moderateEvent(eventId, action, comment = "") {
    const response = await fetch(
        `/api/admin/events/${eventId}/${action}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                comment: comment
            })
        }
    );

    const data = await response.json();

    if (!response.ok) {
        alert(data.error || "Ошибка");
        return;
    }

    await adminPage();
}

async function accountPage() {
  if (!currentUser) {
    content.innerHTML = `
      <section class="empty">
        <h1>Личный кабинет</h1>
        <p class="muted">
          Чтобы открыть личный кабинет, необходимо войти.
        </p>
        <a href="#login">Войти</a>
      </section>
    `;

    return;
  }

  content.innerHTML = `
    <section class="account-page">

      <a class="back" href="#home">
        ← На главную
      </a>

      <h1>Личный кабинет</h1>

      <section class="form-section">
        <h2>Профиль</h2>

        <div class="account-info">
          <p>
            <strong>Имя</strong><br>
            ${escapeHtml(currentUser.username)}
          </p>

          <p>
            <strong>Почта</strong><br>
            ${escapeHtml(currentUser.email)}
          </p>

          <p>
            <strong>Роль</strong><br>
            ${currentUser.role === 'admin'
              ? 'Администратор'
              : 'Ученик'}
          </p>
        </div>
      </section>

      <section class="form-section">
        <h2>Мои мероприятия</h2>

        <div id="my-events">
          Загрузка...
        </div>
      </section>

      <section class="form-section">
        <h2>Мои записи</h2>

        <div id="my-registrations">
          Загрузка...
        </div>
      </section>

    </section>
  `;

  try {
    const [myEvents, registrations] = await Promise.all([
      getMyEvents(),
      getMyRegistrations()
    ]);

    const eventsContainer =
      document.querySelector('#my-events');

    const registrationsContainer =
      document.querySelector('#my-registrations');


    // ==========================================
    // МОИ МЕРОПРИЯТИЯ
    // ==========================================

    if (!myEvents.length) {
      eventsContainer.innerHTML = `
        <div class="empty">
          <h3>Пока нет мероприятий</h3>

          <p class="muted">
            Вы ещё не создали ни одного мероприятия.
          </p>

          <a href="#create">
            Создать мероприятие
          </a>
        </div>
      `;
    } else {
      eventsContainer.innerHTML = myEvents.map(event => `
        <article class="account-event">

          <div>
            <h3>
              ${escapeHtml(event.title)}
            </h3>

            <p class="meta">
              <span>
                ${dateLabel(event.date)}
                ·
                ${event.time}–${event.end}
              </span>

              <span>
                ${escapeHtml(event.place)}
                ·
                ${escapeHtml(event.room)}
              </span>
            </p>

            <p class="muted">
              ${escapeHtml(event.summary)}
            </p>

            <p class="muted">
              Участников: ${event.count}
            </p>
          </div>

          <div class="account-event-actions">
            <a
              class="primary"
              href="#event/${event.id}"
            >
              Открыть
            </a>
          </div>

        </article>
      `).join('');
    }


    // ==========================================
    // МОИ ЗАПИСИ
    // ==========================================

    if (!registrations.length) {
      registrationsContainer.innerHTML = `
        <div class="empty">
          <h3>Пока нет записей</h3>

          <p class="muted">
            Вы ещё не записались ни на одно мероприятие.
          </p>

          <a href="#catalog">
            Посмотреть каталог
          </a>
        </div>
      `;
    } else {
      registrationsContainer.innerHTML = registrations.map(event => `
        <article class="account-event">

          <div>
            <h3>
              ${escapeHtml(event.title)}
            </h3>

            <p class="meta">
              <span>
                ${dateLabel(event.date)}
                ·
                ${event.time}–${event.end}
              </span>

              <span>
                ${escapeHtml(event.place)}
                ·
                ${escapeHtml(event.room)}
              </span>
            </p>

            <p class="muted">
              ${escapeHtml(event.summary)}
            </p>
          </div>

          <div class="account-event-actions">
            <a
              class="primary"
              href="#event/${event.id}"
            >
              Открыть
            </a>

            <button
              class="secondary"
              data-leave-event="${event.id}"
            >
              Отменить запись
            </button>
          </div>

        </article>
      `).join('');

      document
        .querySelectorAll('[data-leave-event]')
        .forEach(button => {

          button.onclick = async () => {
            const eventId =
              Number(button.dataset.leaveEvent);

            const success =
              await leaveEvent(eventId);

            if (!success) {
              return;
            }

            await accountPage();
          };
        });
    }

  } catch (error) {
    console.error(error);

    document.querySelector('#my-events').innerHTML = `
      <p class="error">
        Не удалось загрузить ваши мероприятия.
      </p>
    `;

    document.querySelector('#my-registrations').innerHTML = `
      <p class="error">
        Не удалось загрузить ваши записи.
      </p>
    `;
  }
}

function clearFilters() {
  filterGroups.forEach(group => {
    filters[group.key] = [];
  });

  filters.from = '';
  filters.to = '';
  render();
}


function homePage() {
  content.innerHTML = `
    <section class="home" aria-label="Главная">
      <div class="home-choices">
        <a class="home-choice" href="#filters">
          <span>Каталог событий</span>
          <span class="arrow" aria-hidden="true">↓</span>
        </a>
        <a class="home-choice" href="#create">
          <span>Добавить своё<br>событие</span>
          <span class="arrow" aria-hidden="true">↓</span>
        </a>
      </div>
    </section>`;
}


function filtersPage() {
  content.innerHTML = `
    <section class="filter-page">
      <a class="back" href="#home">← На главную</a>
      <h1>Куда вы хотите?</h1>
      <form id="filter-form">
        ${filterFields()}
        <div class="actions">
          <button class="primary" type="submit">Показать события</button>
          <button id="reset" type="button" class="plain">Сбросить фильтры</button>
        </div>
      </form>
    </section>`;

  document.querySelector('#filter-form').onsubmit = event => {
    event.preventDefault();
    if (readFilters(event.currentTarget)) {
      location.hash = 'catalog';
    }
  };

  document.querySelector('#reset').onclick = clearFilters;
}


function filteredEvents() {
  return events
    .filter(event =>
      filterGroups.every(group =>
        !filters[group.key].length ||
        filters[group.key].includes(event[group.key])
      ) &&
      (!filters.from || event.date >= filters.from) &&
      (!filters.to || event.date <= filters.to)
    )
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}


function updateList() {
  const list = filteredEvents();
  const results = document.querySelector('#results');

  results.innerHTML = `
    <div class="list-heading">
      <p>Найдено: ${list.length}</p>
      <span class="small muted">По дате ↑</span>
    </div>
    ${
      list.length
        ? list.map(event => {
            const allowedColors = [
              'cream', 'blue', 'green',
              'lavender', 'peach', 'pink', 'dark'
            ];

            const color = allowedColors.includes(event.card_color)
              ? event.card_color
              : 'cream';

            let emoji = event.card_emoji;

            if (!emoji) {
              const category = [
                event.activity,
                event.type
              ].join(' ').toLowerCase();

              if (category.includes('спорт')) emoji = '🏀';
              else if (category.includes('кино') || category.includes('фильм') || category.includes('просмотр')) emoji = '🎬';
              else if (category.includes('игр')) emoji = '🎮';
              else if (category.includes('музык')) emoji = '🎵';
              else if (category.includes('it') || category.includes('программ')) emoji = '💻';
              else if (category.includes('искусств')) emoji = '🎨';
              else if (category.includes('литератур')) emoji = '📚';
              else if (category.includes('наук') || category.includes('учеб') || category.includes('олимп')) emoji = '🧠';
              else emoji = '✨';
            }

            return `
              <a
                href="#event/${event.id}"
                class="event-row event-card event-card-${color}"
              >
                <div class="event-row-content">
                  ${
                    event.image_url
                      ? `<img
                          class="event-row-image"
                          src="${escapeHtml(event.image_url)}"
                          alt=""
                        >`
                      : ''
                  }

                  <div class="event-row-info">
                    <div class="event-card-title">
                      <span class="event-card-emoji">${escapeHtml(emoji)}</span>
                      <h2>${escapeHtml(event.title)}</h2>
                    </div>

                    ${
                      event.tagline
                        ? `<p class="event-card-tagline">${escapeHtml(event.tagline)}</p>`
                        : ''
                    }

                    <p>${escapeHtml(event.summary)}</p>

                    <div class="meta">
                      <span>${dateLabel(event.date)} · ${event.time}–${event.end}</span>
                      <span>${escapeHtml(event.room)}</span>
                      ${event.regular ? '<span>Еженедельно</span>' : ''}
                    </div>

                    <div class="chips">${tags(event)}</div>

                    <div class="meta">
                      <span>Организатор: ${escapeHtml(event.organizer)}</span>
                      <span>Участников: ${event.count}</span>
                    </div>
                  </div>
                </div>
              </a>
            `;
          }).join('')
        : `
          <div class="empty">
            <h2>Пока ничего не нашлось</h2>
            <p class="muted">Попробуйте выбрать меньше фильтров или другой диапазон дат.</p>
            <button id="empty-reset">Сбросить фильтры</button>
          </div>
        `
    }`;

  const reset = document.querySelector('#empty-reset');
  if (reset) reset.onclick = clearFilters;
}



function catalogPage() {
  content.innerHTML = `
    <div class="heading">
      <h1>Каталог событий</h1>
      <span class="small muted">События LETOMEET</span>
    </div>

    <div class="catalog-layout">
      <aside class="sidebar">
        <form id="filter-form">
          ${filterFields()}
          <button class="plain" type="button" id="reset">Сбросить фильтры</button>
        </form>
      </aside>

      <section id="results" aria-label="События" aria-live="polite"></section>
    </div>`;

  document.querySelector('#filter-form').onchange = event => {
    if (readFilters(event.currentTarget)) updateList();
  };

  document.querySelector('#filter-form').onsubmit = event => {
    event.preventDefault();
  };

  document.querySelector('#reset').onclick = clearFilters;
  updateList();
}


function contactLinks(event) {
  return `
    ${
      event.chat
        ? `<a class="contact" href="${escapeHtml(event.chat)}" target="_blank" rel="noopener noreferrer">Чат события ↗</a>`
        : '<p class="contact muted">Чат события: ссылка пока не добавлена</p>'
    }
    ${
      event.contact
        ? `<a class="contact" href="${escapeHtml(event.contact)}" target="_blank" rel="noopener noreferrer">Написать организатору ↗</a>`
        : '<p class="contact muted">ЛС организатора: ссылка пока не добавлена</p>'
    }`;
}

async function joinEvent(eventId) {
  const response = await fetch(`/api/events/${eventId}/join`, {
    method: 'POST'
  });

  const data = await response.json();

  if (!response.ok) {
    alert(data.error || 'Не удалось записаться');
    return false;
  }

  return true;
}

async function leaveEvent(eventId) {
  const response = await fetch(`/api/events/${eventId}/join`, {
    method: 'DELETE'
  });

  const data = await response.json();

  if (!response.ok) {
    alert(data.error || 'Не удалось отменить запись');
    return false;
  }

  return true;
}

async function getMyRegistrations() {
  const response = await fetch('/api/me/registrations');

  if (!response.ok) {
    throw new Error('Не удалось загрузить записи');
  }

  const data = await response.json();

  return data.events || [];
}
async function getMyEvents() {
  const response = await fetch('/api/me/events');

  if (!response.ok) {
    throw new Error('Не удалось загрузить мои мероприятия');
  }

  const data = await response.json();

  return data.events || [];
}

async function eventPage(event, preview = false) {
  if (!event) {
    content.innerHTML = '<h1>Событие не найдено</h1><a href="#catalog">Вернуться в каталог</a>';
    return;
  }

  const published = event.status === "approved";
  content.innerHTML = `
    <a class="back" href="${preview ? '#create' : '#catalog'}">
      ← ${preview ? 'Вернуться к форме' : 'В каталог'}
    </a>

    ${preview ? '<p class="notice">Предпросмотр заявки. Она ещё не отправлена и не опубликована.</p>' : ''}
    ${!preview && !published ? `<section class="notice" role="status">
      <h2>${event.status === 'rejected' ? 'Заявка отклонена' : 'Событие сохранено — ожидает одобрения'}</h2>
      <p>Пока событие не опубликовано, оно не отображается в каталоге и на карте. Запись и комментарии станут доступны после одобрения администратором.</p>
      ${event.moderation_comment ? `<p>Комментарий администратора: ${escapeHtml(event.moderation_comment)}</p>` : ''}
      <a href="#account">Мои события</a>
      ${currentUser?.role === 'admin' ? ' · <a href="#admin">Открыть модерацию</a>' : ''}
      <button type="button" class="secondary" id="refresh-event-status">Обновить статус</button>
    </section>` : ''}


    <article class="detail">
  ${
    event.image_url
      ? `<img
          class="event-detail-image"
          src="${escapeHtml(event.image_url)}"
          alt="Обложка мероприятия"
        >`
      : ''
  }

      <h1>${escapeHtml(event.title)}</h1>

      <div class="meta">
        <span>${dateLabel(event.date)} · ${event.time}–${event.end}</span>
        <span>${escapeHtml(event.place)} · ${escapeHtml(event.room)}</span>
        ${event.regular ? '<span>Каждую неделю</span>' : ''}
      </div>

      <div class="detail-grid">
        <div>
          <p class="description">${escapeHtml(event.description)}</p>

          ${
            (preview || !published)
              ? ''
              : `<div class="join-line">
                <button id="join" class="primary">
                    Я пойду
                </button>

                <button id="leave" class="secondary" style="display: none;">
                    Отменить запись
                </button>

                <span id="count" class="small">
                    Участников: ${event.count}
                </span>
            </div>`
          }
        </div>

        <aside class="detail-side">
          <h2>Теги</h2>
          <div class="chips">${tags(event)}</div>

          <h2>Контакты</h2>
          <p>Организатор: ${escapeHtml(event.organizer)}</p>
          ${contactLinks(event)}
        </aside>
      </div>
    </article>`;

    if (!preview && !published) {
      document.querySelector('#refresh-event-status').onclick = render;
    }
    if (!preview && published) {
      await commentsPanel(event.id);
      const joinButton = document.querySelector('#join');
      const leaveButton = document.querySelector('#leave');

      if (!currentUser) {
        joinButton.textContent = 'Войти, чтобы записаться';

        joinButton.onclick = () => {
          location.hash = 'login';
        };

        return;
      }

      const registrations = await getMyRegistrations();

      let isJoined = registrations.some(
        registeredEvent => registeredEvent.id === event.id
      );

  if (isJoined) {
    joinButton.textContent = 'Вы идёте · открыть контакты';
    leaveButton.style.display = 'inline-block';
  }

  // Кнопка "Я пойду"
  joinButton.onclick = async () => {
    // Если уже записан — открываем контакты
    if (isJoined) {
      document.querySelector('#dialog-links').innerHTML =
        contactLinks(event);

      dialog.showModal();
      return;
    }

    const success = await joinEvent(event.id);

    if (!success) {
      return;
    }

    isJoined = true;

    joinButton.textContent = 'Вы идёте · открыть контакты';
    leaveButton.style.display = 'inline-block';

    event.count += 1;

    document.querySelector('#count').textContent =
      'Участников: ' + event.count;

    document.querySelector('#dialog-links').innerHTML =
      contactLinks(event);

    dialog.showModal();
  };

  // Кнопка "Отменить запись"
  leaveButton.onclick = async () => {
    const success = await leaveEvent(event.id);

    if (!success) {
      return;
    }

    isJoined = false;

    joinButton.textContent = 'Я пойду';
    leaveButton.style.display = 'none';

    event.count -= 1;

    document.querySelector('#count').textContent =
      'Участников: ' + event.count;
  };
}
}


function selectField(key, label, options) {
  return `
    <label class="field">
      ${escapeHtml(label)}
      <select name="${key}" required>
        <option value="">Выберите</option>
        ${options.map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}
      </select>
    </label>`;
}



function createPage() {
  if (!currentUser) {
    content.innerHTML = `
      <section class="empty">
        <h1>Добавить событие</h1>

        <p class="muted">
          Чтобы создать мероприятие, необходимо войти в аккаунт.
        </p>

        <a href="#login">Войти</a>
      </section>
    `;

    return;
  }

  const groupsWithoutPlace = filterGroups.filter(
    group => group.key !== 'place'
  );

  const placeGroup = filterGroups.find(
    group => group.key === 'place'
  );

  content.innerHTML = `
    <section class="event-form">
      <a class="back" href="#home">← На главную</a>
      <h1>Добавить своё событие</h1>

      <form id="event-form">
        <div class="form-grid">

          <label class="field full">
            Название мероприятия
            <input
              name="title"
              required
              maxlength="120"
              placeholder="Например, Вечер настольных игр"
            >
          </label>

          <div class="field full">
              Оформление карточки

              <div class="card-design-options">
                <fieldset class="color-picker">
                  <legend>Цвет карточки</legend>
                  <div class="color-swatches">
                    ${[['cream','Кремовый'],['blue','Голубой'],['green','Зелёный'],['lavender','Лавандовый'],['peach','Персиковый'],['pink','Розовый'],['dark','Тёмный']].map(([value,label]) => `
                      <label class="color-option">
                        <input type="radio" name="card_color" value="${value}" ${value==='cream'?'checked':''}>
                        <span class="color-swatch event-card-${value}" aria-hidden="true"></span>
                        <span>${label}</span>
                      </label>`).join('')}
                  </div>
                  <div id="card-color-preview" class="card-color-preview event-card-cream">
                    <strong>Так будет выглядеть карточка</strong>
                    <p class="small">Выбранный цвет: <span id="card-color-name">Кремовый</span></p>
                  </div>
                </fieldset>

                <label class="field">
                  Эмодзи
                  <select name="card_emoji">
                    <option value="">Автоматически</option>
                    <option value="🎓">🎓 Образование</option>
                    <option value="🎬">🎬 Кино</option>
                    <option value="🎮">🎮 Игры</option>
                    <option value="🏀">🏀 Спорт</option>
                    <option value="🎵">🎵 Музыка</option>
                    <option value="💻">💻 IT</option>
                    <option value="🎨">🎨 Искусство</option>
                    <option value="🧠">🧠 Интеллект</option>
                    <option value="📚">📚 Литература</option>
                    <option value="⚽">⚽ Футбол</option>
                    <option value="🏆">🏆 Соревнования</option>
                    <option value="🎤">🎤 Выступления</option>
                  </select>
                </label>
              </div>
            </div>

            <label class="field full">
              Короткий слоган
              <input
                name="tagline"
                maxlength="80"
                placeholder="Например, вечер, который нельзя пропустить"
              >
              <span class="small muted">Необязательно, максимум 80 символов.</span>
            </label>

          <label class="field full">
            Краткое описание
            <input
              name="summary"
              required
              maxlength="180"
              placeholder="Коротко: что будет происходить"
            >
          </label>

          <label class="field full">
            Описание
            <textarea
              name="description"
              required
              maxlength="4000"
              placeholder="Что будете делать, кому можно прийти и что взять с собой?"
            ></textarea>
          </label>

          <div class="field full">
            <label for="event-image">Обложка мероприятия — необязательно</label>
            <input id="event-image" type="file" name="image" accept="image/jpeg,image/png,image/webp" aria-describedby="image-help image-status">
            <span id="image-help" class="small muted">JPG, PNG или WEBP · до 4 МБ · до 20 мегапикселей. Любые пропорции; рекомендуем 1600 × 900 пикселей (16:9). HEIC и SVG не поддерживаются. На карточке края могут обрезаться.</span>
            <div id="image-preview-panel" hidden>
              <img id="image-preview" class="upload-preview" alt="Предпросмотр обложки">
              <button type="button" class="secondary" id="remove-image">Убрать фото</button>
            </div>
            <span id="image-status" class="small" role="status"></span>
          </div>

        </div>

        <section class="form-section">
          <h2>Когда и где</h2>

          <div class="form-grid">
            <label class="field">
              Дата
              <input type="date" name="date" required>
            </label>

            <label class="field">
              Повторение
              <select name="regular">
                <option value="false">Один раз</option>
                <option value="true">Каждую неделю</option>
              </select>
            </label>

            <label class="field">
              Начало
              <input type="time" name="time" required>
            </label>

            <label class="field">
              Окончание
              <input type="time" name="end" required>
            </label>

            ${selectField('place', 'Место', placeGroup.options)}

            <label class="field">
              Где именно
              <input
                name="room"
                required
                maxlength="100"
                placeholder="Кабинет, гостиная, этаж"
              >
            </label>
          </div>
        </section>

        <section class="form-section">
          <h2>Теги</h2>

          <div class="form-grid">
            ${groupsWithoutPlace.map(
              group => selectField(group.key, group.label, group.options)
            ).join('')}
          </div>
        </section>

        <section class="form-section">
          <h2>Контакты</h2>

          <div class="form-grid">
            <label class="field full">
              Имя организатора
              <input name="organizer" required maxlength="80">
            </label>

            <label class="field">
              Ссылка на чат события
              <input
                type="url"
                name="chat"
                placeholder="https://t.me/…"
              >
            </label>

            <label class="field">
              Ссылка на ЛС организатора
              <input
                type="url"
                name="contact"
                placeholder="https://t.me/…"
              >
            </label>
          </div>
        </section>

        <p class="error" id="form-error" role="alert"></p>

        <button class="primary" type="submit">
          Создать событие
        </button>
      </form>
    </section>
  `;

  const form = document.querySelector('#event-form');
  const roomInput = form.elements.room;
  if (roomInput) {
    roomInput.setAttribute('list', 'school-rooms');
    const list = document.createElement('datalist'); list.id = 'school-rooms';
    form.append(list);
    fetch('/static/maps/rooms.json').then(r => r.json()).then(rooms => {
      list.innerHTML = rooms.filter(r => !/^(h|std|TR)/.test(r.name)).map(r => `<option value="${escapeHtml(r.name)}">Этаж ${r.floor}</option>`).join('');
    }).catch(() => {});
  }


  if (draft) {
    Object.keys(draft).forEach(key => {
      if (key !== 'image' && form.elements[key]) form.elements[key].value = String(draft[key]);
    });
  }

  const colorLabels = {cream:'Кремовый',blue:'Голубой',green:'Зелёный',lavender:'Лавандовый',peach:'Персиковый',pink:'Розовый',dark:'Тёмный'};
  function updateColorPreview() {
    const value = form.elements.card_color.value;
    const preview = form.querySelector('#card-color-preview');
    preview.className = `card-color-preview event-card-${value}`;
    form.querySelector('#card-color-name').textContent = colorLabels[value];
  }
  form.querySelectorAll('[name="card_color"]').forEach(input => input.addEventListener('change', updateColorPreview));
  updateColorPreview();

  const imageInput = form.elements.image;
  const imagePanel = form.querySelector('#image-preview-panel');
  const imagePreview = form.querySelector('#image-preview');
  const imageStatus = form.querySelector('#image-status');
  let photoVersion = 0;
  let photoInvalid = false;
  let photoChecking = false;
  form.querySelector('#remove-image').onclick = () => {
    photoVersion++; imageInput.value = ''; imagePreview.removeAttribute('src');
    imagePanel.hidden = true; imageStatus.textContent = ''; photoInvalid = false; photoChecking = false;
  };
  imageInput.onchange = async () => {
    const version = ++photoVersion;
    imagePreview.removeAttribute('src'); imagePanel.hidden = true;
    photoInvalid = false; photoChecking = false; imageStatus.textContent = '';
    const file = imageInput.files[0];
    if (!file) return;
    imagePanel.hidden = false; // Keep removal available even for invalid files.
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) {
      imageStatus.textContent = 'Выберите JPG, PNG или WEBP. HEIC и SVG не поддерживаются.'; photoInvalid = true; return;
    }
    if (file.size > 4 * 1024 * 1024) {
      imageStatus.textContent = 'Файл больше 4 МБ. Уменьшите его или уберите фото.'; photoInvalid = true; return;
    }
    photoChecking = true; imageStatus.textContent = 'Проверяем фото…';
    try {
      const dataUrl = await new Promise((resolve,reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
      });
      const size = await new Promise((resolve,reject) => {
        const img = new Image(); img.onload = () => resolve([img.naturalWidth,img.naturalHeight]); img.onerror = reject; img.src = dataUrl;
      });
      if (version !== photoVersion) return;
      if (size[0]*size[1] > 20000000) {
        photoInvalid = true; imageStatus.textContent = 'Больше 20 мегапикселей. Уменьшите разрешение или уберите фото.'; return;
      }
      imagePreview.src = dataUrl;
      imageStatus.textContent = `${file.name} · ${size[0]} × ${size[1]} · ${(file.size/1024/1024).toFixed(2)} МБ`;
    } catch(e) {
      if (version !== photoVersion) return;
      photoInvalid = true; imageStatus.textContent = 'Не удалось прочитать фото. Выберите другой файл или уберите его.';
    } finally { if (version === photoVersion) photoChecking = false; }
  };

  form.oninput = () => {
    const formData = new FormData(form);
    formData.delete('image');

    draft = Object.fromEntries(formData);
  };

  form.onsubmit = async event => {
    event.preventDefault();

    const data = Object.fromEntries(new FormData(form));

    const imageFile = data.image;
    delete data.image;

    const error = document.querySelector('#form-error');

    if (photoChecking || photoInvalid) {
      error.textContent = photoChecking ? 'Дождитесь проверки фото.' : 'Исправьте ошибку фото или нажмите «Убрать фото».';
      return;
    }
    // Проверка размера изображения
    if (imageFile && imageFile.size > 4 * 1024 * 1024) {
      error.textContent = 'Изображение должно быть не больше 4 МБ.';
      return;
    }

    // Проверка времени
    if (data.end <= data.time) {
      error.textContent = 'Окончание должно быть позже начала. Укажите время в пределах одного дня.';
      return;
    }

    // Проверка ссылок
    for (const key of ['chat', 'contact']) {
      if (!data[key]) continue;

      try {
        const url = new URL(data[key]);

        if (!['https:', 'http:'].includes(url.protocol)) {
          error.textContent = 'Ссылки должны начинаться с https:// или http://.';
          return;
        }
      } catch {
        error.textContent = 'Проверьте ссылки на чат и ЛС организатора.';
        return;
      }
    }

    // Проверка текстовых полей
    for (const key of [
      'title',
      'summary',
      'description',
      'room',
      'organizer'
    ]) {
      data[key] = data[key].trim();

      if (!data[key]) {
        error.textContent = 'Заполните текстовые поля: одних пробелов недостаточно.';
        return;
      }
    }

    // Загрузка изображения
    let imageUrl = null;

    if (imageFile && imageFile.size > 0) {
      const imageData = new FormData();
      imageData.append('image', imageFile);

      try {
        const uploadResponse = await fetch('/api/upload-image', {
          method: 'POST',
          body: imageData
        });

        const uploadResult = await uploadResponse.json();

        if (!uploadResponse.ok) {
          error.textContent = uploadResult.error || 'Не удалось загрузить изображение.';
          return;
        }

        imageUrl = uploadResult.image_url;

      } catch {
        error.textContent = 'Не удалось загрузить изображение. Проверьте соединение с сервером.';
        return;
      }
    }

    // Подготовка данных мероприятия
    const payload = {
      ...data,
      regular: data.regular === 'true',
      image_url: imageUrl
    };

    // Отправка мероприятия на сервер
    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        error.textContent = result.error || 'Не удалось создать событие.';
        return;
      }

      draft = null;
      location.hash = `event/${result.id}`;

    } catch (requestError) {
      error.textContent = 'Сервер недоступен. Запустите Flask-приложение.';
    }
  };
}



async function render() {
  if (dialog.open) dialog.close();

  const route = location.hash.slice(1) || (location.pathname === '/map' ? 'map' : 'home');
  navigation.hidden = route === 'home';

  navigation.querySelectorAll('a').forEach(link => {
    link.removeAttribute('aria-current');

    if (link.hash === '#' + route) {
      link.setAttribute('aria-current', 'page');
    }
  });

  if (route === 'home') {
    homePage();

  } else if (route === 'filters') {
    filtersPage();

  } else if (route === 'catalog') {
    try { await loadData(); } catch (error) {
      content.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
      return;
    }
    catalogPage();

  } else if (route === 'map') {
    await mapPage();

  } else if (route === 'create') {
    createPage();

  } else if (route === 'preview' && draft) {
    eventPage(
      {...draft, regular: draft.regular === 'true'},
      true
    );

  } else if (route.startsWith('event/')) {
    const id = Number(route.split('/')[1]);

    let event;
    try {
      const response = await fetch(`/api/events/${id}`, {cache:'no-store'});
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        content.innerHTML = `<p class="error" role="alert">${escapeHtml(result.error || 'Не удалось открыть событие. Проверьте вход в аккаунт и попробуйте снова.')}</p><a href="#account">Мои события</a>`;
        return;
      }
      event = await response.json();
    } catch {
      content.innerHTML = '<p class="error" role="alert">Не удалось загрузить событие. Проверьте соединение и обновите страницу.</p>';
      return;
    }

    await eventPage(event);

  } else if (route === 'login') {
    loginPage();

  } else if (route === 'register') {
    registerPage();

    } else if (route === 'admin') {
      await adminPage();

    } else if (route === 'account') {
      await accountPage();

  } else {
    content.innerHTML =
      '<h1>Страница не найдена</h1><a href="#home">На главную</a>';
  }

  window.scrollTo(0, 0);
}


document.querySelector('#close-dialog').onclick = () => dialog.close();
document.querySelector('#done-dialog').onclick = () => dialog.close();

dialog.onclick = event => {
  if (event.target === dialog) {
    const box = dialog.getBoundingClientRect();

    if (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    ) {
      dialog.close();
    }
  }
};


window.addEventListener('hashchange', render);


(async function init() {
  try {
    await loadUser();
    await loadData();
    await render();
  } catch (error) {
    content.innerHTML = `
      <section class="empty">
        <h1>LETOMEET</h1>
        <p class="error">
          ${escapeHtml(error.message)}
        </p>
        <p>Проверь, что Flask-сервер запущен.</p>
      </section>`;
  }
})();


async function commentsPanel(eventId) {
  const panel = document.createElement('section');
  panel.className = 'comments-panel';
  document.querySelector('.detail').append(panel);
  panel.innerHTML = `<h2>Комментарии</h2><div class="comment-list"></div>
    ${currentUser ? '<form class="comment-form"><label class="field">Ваш комментарий<textarea name="body" maxlength="2000" required></textarea></label><button class="primary">Отправить</button></form>' : '<p><a href="#login">Войдите</a>, чтобы оставить комментарий.</p>'}<p role="status" class="error"></p>`;
  const status = panel.querySelector('[role=status]');
  async function refresh() {
    const response = await fetch(`/api/events/${eventId}/comments`);
    if (!response.ok) throw new Error('Не удалось загрузить комментарии');
    const rows = await response.json();
    panel.querySelector('.comment-list').innerHTML = rows.length ? rows.map(c => `<article class="comment"><strong>${escapeHtml(c.author)}</strong><p>${escapeHtml(c.body)}</p><small>${escapeHtml(new Date(c.created_at).toLocaleString('ru'))}</small>${c.can_delete ? `<button class="plain" data-delete="${c.id}">Удалить</button>` : ''}</article>`).join('') : '<p class="muted">Пока нет комментариев.</p>';
  }
  panel.onclick = async e => {
    const id = e.target.dataset.delete;
    if (!id) return;
    try {
      const r = await fetch(`/api/comments/${id}`, {method:'DELETE'});
      if (!r.ok) throw new Error('Не удалось удалить комментарий');
      await refresh();
    } catch (e) { status.textContent = e.message; }
  };
  const form = panel.querySelector('form');
  if (form) form.onsubmit = async e => {
    e.preventDefault();
    const button = form.querySelector('button'); button.disabled = true;
    try {
      const r = await fetch(`/api/events/${eventId}/comments`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({body:form.elements.body.value})});
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      form.reset(); status.textContent = ''; await refresh();
    } catch(e) { status.textContent = e.message; }
    finally { button.disabled = false; }
  };
  try { await refresh(); } catch(e) { status.textContent = e.message; }
}

async function mapPage() {
  content.innerHTML = `<a class="back" href="#catalog">← В каталог</a><h1>Карта событий</h1>
    <p class="muted">Выберите этаж и событие. Точки указаны по номеру кабинета из школьного навигатора.</p>
    <label class="field">Этаж<select id="map-floor">${[0,1,2,3].map(n => `<option value="${n}" ${n===2?'selected':''}>${n}</option>`).join('')}</select></label>
    <div class="map-zoom-controls" role="group" aria-label="Масштаб карты">
      <button type="button" class="secondary" id="map-zoom-out" aria-label="Уменьшить карту">−</button>
      <label for="map-zoom">Масштаб</label><input id="map-zoom" type="range" min="50" max="300" step="25" value="100">
      <output id="map-zoom-label" for="map-zoom">100%</output>
      <button type="button" class="secondary" id="map-zoom-in" aria-label="Увеличить карту">+</button>
      <button type="button" class="secondary" id="map-zoom-reset">По ширине</button>
    </div>
    <p class="small muted">Увеличьте карту и прокручивайте её по горизонтали и вертикали.</p>
    <div class="map-layout"><div class="map-scroll" tabindex="0" role="region" aria-label="План школы, прокручиваемая область"><div class="school-map"><img alt="План этажа школы"/><div class="map-pins"></div></div></div><div id="map-events"></div></div><p id="map-message" role="status"></p>`;
  try {
    const [roomResponse, eventResponse] = await Promise.all([fetch('/static/maps/rooms.json'), fetch('/api/events')]);
    if (!roomResponse.ok || !eventResponse.ok) throw new Error('Не удалось загрузить карту');
    const rooms = await roomResponse.json(), mapEvents = await eventResponse.json();
    const normalize = name => String(name).trim().toLowerCase().replace(/^с(?=\d)/, 'c');
    const findRoom = event => rooms.find(r => normalize(r.name) === normalize(event.room));
    const image = content.querySelector('.school-map img');
    const pins = content.querySelector('.map-pins');
    const select = content.querySelector('#map-floor');
    const zoom = content.querySelector('#map-zoom');
    const mapCanvas = content.querySelector('.school-map');
    const scroll = content.querySelector('.map-scroll');
    function applyZoom(value) {
      const next = Math.max(50, Math.min(300, value));
      const centerX = (scroll.scrollLeft + scroll.clientWidth/2) / mapCanvas.offsetWidth;
      const centerY = (scroll.scrollTop + scroll.clientHeight/2) / (mapCanvas.offsetHeight || 1);
      zoom.value = next;
      mapCanvas.style.width = `${next}%`;
      content.querySelector('#map-zoom-label').textContent = `${next}%`;
      content.querySelector('#map-zoom-out').disabled = next === 50;
      content.querySelector('#map-zoom-in').disabled = next === 300;
      scroll.scrollLeft = centerX * mapCanvas.offsetWidth - scroll.clientWidth/2;
      scroll.scrollTop = centerY * mapCanvas.offsetHeight - scroll.clientHeight/2;
    }
    zoom.oninput = () => applyZoom(Number(zoom.value));
    content.querySelector('#map-zoom-in').onclick = () => applyZoom(Number(zoom.value)+25);
    content.querySelector('#map-zoom-out').onclick = () => applyZoom(Number(zoom.value)-25);
    content.querySelector('#map-zoom-reset').onclick = () => { applyZoom(100); scroll.scrollTop = 0; scroll.scrollLeft = 0; };
    function draw() {
      const floor = Number(select.value);
      const visible = mapEvents.filter(e => findRoom(e)?.floor === floor);
      image.onload = () => {
        pins.innerHTML = visible.map((e,i) => {
          const r = findRoom(e);
          return `<a class="map-pin" href="#event/${e.id}" title="${escapeHtml(e.title)}" style="left:${100*r.x/r.reference_width}%;top:${100*r.y/r.reference_height}%">${i+1}</a>`;
        }).join('');
      };
      pins.innerHTML = '';
      image.src = `/static/maps/floor_${floor}.png`;
      image.onerror = () => { content.querySelector('#map-message').textContent = 'Не удалось загрузить план этажа.'; };
      const unplaced = mapEvents.filter(e => !findRoom(e));
      const link = e => `<p><a href="#event/${e.id}">${escapeHtml(e.title)}</a><br><small>${escapeHtml(e.room)} · ${escapeHtml(e.date)} ${escapeHtml(e.time)}</small></p>`;
      content.querySelector('#map-events').innerHTML = `<h2>На этаже</h2>${visible.length ? visible.map((e,i)=>`<div>${i+1}. ${link(e)}</div>`).join('') : '<p>Нет событий на этом этаже.</p>'}<h2>Без точки на карте</h2>${unplaced.length ? unplaced.map(link).join('') : '<p>Все события размещены.</p>'}`;
    }
    select.onchange = draw; draw();
  } catch(e) { content.querySelector('#map-message').textContent = e.message; }
}
