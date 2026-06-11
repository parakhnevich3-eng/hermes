const deliveryData = window.perchiniDeliveryData;
const { restaurant, categories, items, starterCartItemIds, upsellItemIds } =
  deliveryData;

let activeCategory = deliveryData.initialCategoryId || categories[0]?.id;
let mode = 'list';
let orderMode = 'delivery';
const cart = Object.fromEntries(starterCartItemIds.map(id => [id, 1]));

const rub = value => `${value.toLocaleString('ru-RU')} ₽`;
const escapeHtml = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    char =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[char]),
  );

document.querySelector(
  '.address',
).textContent = `${restaurant.city}, ${restaurant.address}`;
document.querySelector(
  '#screen-menu .screen-title p',
).textContent = `Доставка: ${items.length} позиций, ${categories.length} категорий`;

const metricValues = document.querySelectorAll('.metrics strong');
metricValues[0].textContent = restaurant.deliveryEta;
metricValues[1].textContent = restaurant.pickupEta;
metricValues[2].textContent = restaurant.phone.replace('+7 (3462) ', '');

function renderCategories() {
  document.querySelector('#categories').innerHTML = categories
    .map(
      category => `
      <button class="category ${
        category.id === activeCategory ? 'is-active' : ''
      }" data-category="${category.id}">
        <strong>${escapeHtml(category.title)}</strong><span>${
        category.itemCount
      } поз.</span>
      </button>
    `,
    )
    .join('');
}

function renderSource() {
  const active =
    categories.find(category => category.id === activeCategory) ||
    categories[0];
  document.querySelector('#source').innerHTML = `
    <strong>${escapeHtml(active.title)}</strong>
    <div>Доставка из ресторана на Ленина, 17. В этой категории ${
      active.itemCount
    } позиций.</div>
    <a href="${
      restaurant.menuSource
    }" target="_blank" rel="noreferrer">Открыть доставку</a>
  `;
}

function renderProducts() {
  const query = document.querySelector('#search').value.trim().toLowerCase();
  const filtered = items.filter(
    item =>
      item.category === activeCategory &&
      `${item.title} ${item.subtitle}`.toLowerCase().includes(query),
  );

  document.querySelector('#products').className = `products ${mode}`;
  document.querySelector('#products').innerHTML = filtered.length
    ? filtered
        .map(
          item => `
    <article class="product">
      <img src="${item.img}" alt="${escapeHtml(item.title)}" />
      <div class="product__body">
        <h3>${escapeHtml(item.title)}</h3>
        ${
          item.subtitle
            ? `<p class="product__subtitle">${escapeHtml(item.subtitle)}</p>`
            : ''
        }
        ${
          item.weight
            ? `<div class="weight">${escapeHtml(item.weight)}</div>`
            : ''
        }
        ${
          item.badge
            ? `<span class="badge">${escapeHtml(item.badge)}</span>`
            : ''
        }
        <div class="product__footer">
          <span class="price">${rub(item.price)}</span>
          <button class="add" data-add="${item.id}">${
            cart[item.id] ? `В корзине ${cart[item.id]}` : 'Добавить'
          }</button>
        </div>
      </div>
    </article>
  `,
        )
        .join('')
    : '<p class="empty">В этой категории ничего не найдено</p>';
}

function renderCart() {
  const cartItems = Object.entries(cart)
    .map(([id, quantity]) => ({
      item: items.find(entry => entry.id === id),
      quantity,
    }))
    .filter(entry => entry.item);
  const subtotal = cartItems.reduce(
    (sum, { item, quantity }) => sum + item.price * quantity,
    0,
  );
  const delivery = orderMode === 'pickup' || subtotal >= 1500 ? 0 : 199;
  const service = subtotal > 0 ? 39 : 0;
  const total = subtotal + delivery + service;

  document.querySelector('#cart-count').textContent = Object.values(
    cart,
  ).reduce((sum, qty) => sum + qty, 0);
  document.querySelector('#cart-list').innerHTML = cartItems.length
    ? cartItems
        .map(
          ({ item, quantity }) => `
      <div class="cart-row">
        <div><strong>${escapeHtml(item.title)}</strong><small>${rub(
            item.price,
          )} за порцию</small></div>
        <div class="stepper">
          <button data-remove="${item.id}">-</button>
          <strong>${quantity}</strong>
          <button data-add="${item.id}">+</button>
        </div>
      </div>
    `,
        )
        .join('')
    : '<p>Корзина пуста</p>';

  document.querySelector('#summary').innerHTML = `
    <div class="summary-row"><span>Меню</span><strong>${rub(
      subtotal,
    )}</strong></div>
    <div class="summary-row"><span>Сервис</span><strong>${rub(
      service,
    )}</strong></div>
    <div class="summary-row"><span>Доставка</span><strong>${rub(
      delivery,
    )}</strong></div>
    <div class="summary-total"><span>Итого</span><strong>${rub(
      total,
    )}</strong></div>
    <button class="pay">Оплатить онлайн</button>
  `;

  const upsells = items.filter(
    item => !cart[item.id] && upsellItemIds.includes(item.id),
  );
  document.querySelector('#upsells').innerHTML = upsells
    .map(
      item => `
    <button class="upsell" data-add="${item.id}">
      <img src="${item.img}" alt="${escapeHtml(item.title)}" />
      <strong>${escapeHtml(item.title)}</strong>
      <span>${rub(item.price)}</span>
    </button>
  `,
    )
    .join('');
}

function render() {
  renderCategories();
  renderSource();
  renderProducts();
  renderCart();
}

document.addEventListener('click', event => {
  const tab = event.target.closest('[data-screen]');
  const category = event.target.closest('[data-category]');
  const add = event.target.closest('[data-add]');
  const remove = event.target.closest('[data-remove]');
  const modeButton = event.target.closest('[data-mode]');
  const orderButton = event.target.closest('[data-order]');

  if (tab) {
    document
      .querySelectorAll('.tab')
      .forEach(node => node.classList.remove('is-active'));
    tab.classList.add('is-active');
    document
      .querySelectorAll('.screen')
      .forEach(node => node.classList.remove('is-active'));
    document
      .querySelector(`#screen-${tab.dataset.screen}`)
      .classList.add('is-active');
  }

  if (category) activeCategory = category.dataset.category;
  if (add) cart[add.dataset.add] = (cart[add.dataset.add] || 0) + 1;
  if (remove) {
    cart[remove.dataset.remove] = (cart[remove.dataset.remove] || 0) - 1;
    if (cart[remove.dataset.remove] <= 0) delete cart[remove.dataset.remove];
  }
  if (modeButton) {
    mode = modeButton.dataset.mode;
    document
      .querySelectorAll('[data-mode]')
      .forEach(node => node.classList.toggle('is-active', node === modeButton));
  }
  if (orderButton) {
    orderMode = orderButton.dataset.order;
    document
      .querySelectorAll('[data-order]')
      .forEach(node =>
        node.classList.toggle('is-active', node === orderButton),
      );
  }

  render();
});

document.querySelector('#search').addEventListener('input', renderProducts);
render();
